/**
 * Korean-query search intent parsing - purely additive to searchProducts()'s
 * existing English substring match (brand/official_name/model_sku), never a
 * replacement for it: any token this parser doesn't recognize as an alias
 * falls through to that same 3-way ilike search, unchanged.
 *
 * Three independent, exact-match-only dictionaries, each its own axis:
 *   BRAND_ALIASES         한글 브랜드 표기 -> canonical_products.brand의 실제 값
 *   PRODUCT_TYPE_ALIASES   한글 상품유형 표기 -> canonical_products.product_type 배열
 *                          (한 alias가 여러 type을 가리킬 수 있음 - 같은 축 내부 OR)
 *   CATEGORY_ALIASES       한글 카테고리 표기 -> canonical_products.category의 실제 값
 *
 * Search semantics (see CanonicalProductRepository.searchProducts()):
 *   - 같은 축 내부에서 여러 값이 매칭되면 OR (예: 마스크 -> [diving_mask, future face_mask])
 *   - 서로 다른 축(브랜드/유형/카테고리/자유텍스트 토큰 각각)은 전부 AND
 *   - 자유텍스트는 leftover 문자열 하나로 합치지 않고 토큰별로 독립된 축이 됨
 *
 * Deliberately NOT substring matching ("시그" must NOT resolve to SIGMA, "핀셋"
 * must NOT resolve to fins) - these are short, ambiguous Korean tokens where
 * partial matching would false-positive constantly. Exact-match-after-normalize
 * only, phrase keys (e.g. "다이빙 컴퓨터") matched longest-first before falling
 * back to single-token matching - see parseSearchIntent().
 */

export const PRODUCT_TYPES = [
  "camera",
  "camera_lens",
  "earbuds",
  "headphones",
  "smartwatch",
  "dive_computer",
  "diving_mask",
  "fins",
  "wetsuit",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

/** 한글 브랜드 표기 -> canonical_products.brand의 실제 값. */
export const BRAND_ALIASES: Record<string, string> = {
  걸: "GULL",
  가민: "Garmin",
  소니: "Sony",
  탐론: "Tamron",
  시그마: "SIGMA",
};

/**
 * 한글 상품유형 표기 -> product_type 배열. 배열인 이유: 하나의 한글 표기가
 * 여러 product_type을 가리켜야 하는 경우를 대비한 구조(예: 향후 "마스크"가
 * diving_mask 외에 face_mask도 의미하게 될 수 있음) - 지금은 전부 단일 원소
 * 배열이며 의미는 V1과 완전히 동일하다. 여러 한글 표기가 같은 slug로 모이는
 * 것도 가능(핀/오리발 -> fins).
 *
 * "다이빙 컴퓨터"는 공백이 있는 2-token phrase 키 - "다이빙"(카테고리)과
 * "컴퓨터"(어떤 사전에도 없는 단어)로 쪼개면 절대 복원되지 않으므로, 이렇게
 * 명시적 phrase로 등록해야만 "다이빙컴퓨터"(공백 없음)와 동일하게 동작한다.
 * parseSearchIntent()가 긴 phrase부터 먼저 시도하므로 이 키가 우선 매칭된다.
 */
export const PRODUCT_TYPE_ALIASES: Record<string, ProductType[]> = {
  렌즈: ["camera_lens"],
  마스크: ["diving_mask"],
  핀: ["fins"],
  오리발: ["fins"],
  이어폰: ["earbuds"],
  헤드폰: ["headphones"],
  스마트워치: ["smartwatch"],
  카메라: ["camera"],
  다이브컴퓨터: ["dive_computer"],
  다이빙컴퓨터: ["dive_computer"],
  "다이빙 컴퓨터": ["dive_computer"],
  웻슈트: ["wetsuit"],
  슈트: ["wetsuit"],
};

/** 한글 카테고리 표기 -> canonical_products.category의 실제 값. product_type과
 * 완전히 별도 축 - "마스크"를 여기 넣거나 "렌즈"를 여기 넣지 말 것(그건
 * PRODUCT_TYPE_ALIASES의 몫). */
export const CATEGORY_ALIASES: Record<string, string> = {
  다이빙: "diving",
  전자제품: "electronics",
  전자기기: "electronics",
};

/**
 * Unicode NFC + trim + 연속 공백 1칸으로 collapse. SKU의 `-`/숫자/영문 등은
 * 공백이 아니므로 훼손되지 않는다("A063", "WH-1000XM6" 그대로 유지).
 */
export function normalize(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/g, " ");
}

function tokenize(input: string): string[] {
  const normalized = normalize(input);
  return normalized === "" ? [] : normalized.split(" ");
}

/** 등록된 phrase 키 중 최장 토큰 길이. 사전이 커져도 하드코딩된 매직넘버 없이
 * 자동으로 늘어난다. */
function maxPhraseTokenLength(): number {
  let max = 1;
  for (const dict of [BRAND_ALIASES, PRODUCT_TYPE_ALIASES, CATEGORY_ALIASES]) {
    for (const key of Object.keys(dict)) {
      const len = key.split(" ").length;
      if (len > max) max = len;
    }
  }
  return max;
}

/**
 * 비정상적으로 긴 검색어에서 free-text 토큰마다 최대 3개 쿼리가 발생하는
 * query explosion을 막기 위한 상한. 초과 시 parseSearchIntent()는 아무 것도
 * 파싱하지 않고 tokenLimitExceeded=true만 반환 - 호출자(searchProducts())는
 * 이 경우 원본 쿼리를 자르지 않고 그대로 V1 방식(전체 문자열 3-way ilike)으로
 * 처리한다. 6 토큰이면 실제 사용자 검색어(대개 1~4단어)를 전혀 제약하지
 * 않으면서 최악의 경우 쿼리 수(브랜드/유형/카테고리 축 최대 3개 + free-text
 * 토큰당 3개 = 최대 6*3+3=21)를 합리적인 범위로 묶는다.
 */
const MAX_SEARCH_TOKENS = 6;

export interface ParsedSearchIntent {
  /** brand 축 - 매칭된 값들의 OR (canonical_products.brand의 실제 값) */
  brands: string[];
  /** product_type 축 - 매칭된 값들의 OR */
  productTypes: ProductType[];
  /** category 축 - 매칭된 값들의 OR */
  categories: string[];
  /** 어떤 사전에도 매칭 안 된 토큰들 - 각각 독립된 자유텍스트 축(서로 AND) */
  freeTextTokens: string[];
  /** true면 토큰 수가 MAX_SEARCH_TOKENS를 넘어 파싱을 시도하지 않았음 - 다른
   * 필드는 전부 빈 배열이며, 호출자는 normalizedQuery로 legacy 검색을 수행해야 함. */
  tokenLimitExceeded: boolean;
  /** normalize()를 거친 전체 쿼리(NFC+trim+공백collapse) - tokenLimitExceeded일 때
   * 호출자가 legacy 3-way 검색에 쓸 대상. 원본을 자르지 않고 정규화만 적용한 값. */
  normalizedQuery: string;
}

/**
 * 공백 토큰화 후, 각 위치에서 등록된 phrase 중 가장 긴 것부터 먼저 시도해
 * exact match만으로 브랜드/유형/카테고리 축에 배정하고, 매칭 안 된 토큰은
 * 자유텍스트로 남긴다. substring/prefix 매칭은 절대 하지 않는다.
 */
export function parseSearchIntent(query: string): ParsedSearchIntent {
  const normalizedQuery = normalize(query);
  const empty = (): ParsedSearchIntent => ({
    brands: [],
    productTypes: [],
    categories: [],
    freeTextTokens: [],
    tokenLimitExceeded: false,
    normalizedQuery,
  });

  const tokens = tokenize(query);
  if (tokens.length === 0) return empty();
  if (tokens.length > MAX_SEARCH_TOKENS) return { ...empty(), tokenLimitExceeded: true };

  const maxPhraseLen = maxPhraseTokenLength();
  const brands: string[] = [];
  const productTypes: ProductType[] = [];
  const categories: string[] = [];
  const freeTextTokens: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    const longest = Math.min(maxPhraseLen, tokens.length - i);
    for (let len = longest; len >= 1; len--) {
      const span = tokens.slice(i, i + len).join(" ");
      if (span in BRAND_ALIASES) {
        brands.push(BRAND_ALIASES[span]);
        i += len;
        matched = true;
        break;
      }
      if (span in PRODUCT_TYPE_ALIASES) {
        productTypes.push(...PRODUCT_TYPE_ALIASES[span]);
        i += len;
        matched = true;
        break;
      }
      if (span in CATEGORY_ALIASES) {
        categories.push(CATEGORY_ALIASES[span]);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      freeTextTokens.push(tokens[i]);
      i += 1;
    }
  }

  return {
    brands: [...new Set(brands)],
    productTypes: [...new Set(productTypes)],
    categories: [...new Set(categories)],
    freeTextTokens,
    tokenLimitExceeded: false,
    normalizedQuery,
  };
}

/**
 * BRAND_ALIASES / PRODUCT_TYPE_ALIASES / CATEGORY_ALIASES 사이에 같은 key가
 * 두 개 이상의 축에 동시 등록돼 있으면 parser 우선순위(브랜드 -> 유형 -> 카테고리
 * 순으로 먼저 매칭되는 축이 이김)에 따라 조용히 다른 축으로 오해석될 수 있다.
 * 이 함수는 그런 "같은 key가 여러 사전에 존재"만 충돌로 본다 - 같은 사전
 * 내부에서 서로 다른 key가 같은 value를 가리키는 것(핀/오리발 -> 둘 다 fins)은
 * 정상이며 여기서 절대 걸리지 않는다. 기본 인자 없이 호출하면 실제 세 사전을
 * 검사하고, 테스트에서는 합성 dict를 넘겨 탐지 로직 자체를 검증할 수 있다.
 */
export function findAliasKeyCollisions(
  dicts: Record<string, unknown>[] = [BRAND_ALIASES, PRODUCT_TYPE_ALIASES, CATEGORY_ALIASES],
): string[] {
  const dictCountForKey = new Map<string, number>();
  for (const dict of dicts) {
    for (const key of new Set(Object.keys(dict))) {
      dictCountForKey.set(key, (dictCountForKey.get(key) ?? 0) + 1);
    }
  }
  return [...dictCountForKey.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}
