/**
 * Boundary/behavior checks for searchAliases.ts's parser. No test runner is
 * configured in this repo (see web/app/admin/lib/priceGrade.test.ts for the
 * same plain-assertion convention) - run directly:
 *   npx tsx src/domain/searchAliases.test.ts
 * Exits non-zero on any failure.
 */
import {
  parseSearchIntent,
  isProductType,
  normalize,
  findAliasKeyCollisions,
  PRODUCT_TYPE_ALIASES,
  PRODUCT_TYPES,
  type ParsedSearchIntent,
} from "./searchAliases";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function intent(
  q: string,
  overrides: Partial<ParsedSearchIntent>,
): ParsedSearchIntent {
  return {
    brands: [],
    productTypes: [],
    categories: [],
    freeTextTokens: [],
    tokenLimitExceeded: false,
    normalizedQuery: normalize(q),
    ...overrides,
  };
}

// --- single-axis: brand ---
check('"소니" -> brand Sony only', parseSearchIntent("소니"), intent("소니", { brands: ["Sony"] }));
check('"걸" -> brand GULL only', parseSearchIntent("걸"), intent("걸", { brands: ["GULL"] }));

// --- single-axis: product type ---
check('"렌즈" -> productType camera_lens only', parseSearchIntent("렌즈"), intent("렌즈", { productTypes: ["camera_lens"] }));
check('"핀" -> fins', parseSearchIntent("핀"), intent("핀", { productTypes: ["fins"] }));
check('"오리발" -> fins (같은 slug)', parseSearchIntent("오리발"), intent("오리발", { productTypes: ["fins"] }));

// --- single-axis: category ---
check('"다이빙" -> category diving only', parseSearchIntent("다이빙"), intent("다이빙", { categories: ["diving"] }));
check('"전자제품" -> category electronics', parseSearchIntent("전자제품"), intent("전자제품", { categories: ["electronics"] }));
check('"전자기기" -> category electronics (동의어)', parseSearchIntent("전자기기"), intent("전자기기", { categories: ["electronics"] }));

// --- cross-axis AND: brand + product_type ---
check(
  '"탐론 렌즈" -> brand Tamron AND type camera_lens',
  parseSearchIntent("탐론 렌즈"),
  intent("탐론 렌즈", { brands: ["Tamron"], productTypes: ["camera_lens"] }),
);
check(
  '"소니 헤드폰" -> brand Sony AND type headphones',
  parseSearchIntent("소니 헤드폰"),
  intent("소니 헤드폰", { brands: ["Sony"], productTypes: ["headphones"] }),
);
check(
  '"소니 이어폰" -> brand Sony AND type earbuds',
  parseSearchIntent("소니 이어폰"),
  intent("소니 이어폰", { brands: ["Sony"], productTypes: ["earbuds"] }),
);
check(
  '"가민 스마트워치" -> brand Garmin AND type smartwatch',
  parseSearchIntent("가민 스마트워치"),
  intent("가민 스마트워치", { brands: ["Garmin"], productTypes: ["smartwatch"] }),
);

// --- cross-axis AND: category + product_type (compositional, no dedicated phrase needed) ---
check(
  '"다이빙 마스크" -> category diving AND type diving_mask (조합, phrase 아님)',
  parseSearchIntent("다이빙 마스크"),
  intent("다이빙 마스크", { categories: ["diving"], productTypes: ["diving_mask"] }),
);

// --- phrase (longest-match) must win over token-by-token composition ---
check(
  '"다이빙 컴퓨터" -> productType dive_computer 단일 phrase (다이빙이 category로 잘못 쪼개지면 안 됨)',
  parseSearchIntent("다이빙 컴퓨터"),
  intent("다이빙 컴퓨터", { productTypes: ["dive_computer"] }),
);
check(
  '"다이빙컴퓨터"(공백없음) -> 동일 결과',
  parseSearchIntent("다이빙컴퓨터"),
  intent("다이빙컴퓨터", { productTypes: ["dive_computer"] }),
);
check(
  '"다이브컴퓨터" -> 동일 결과',
  parseSearchIntent("다이브컴퓨터"),
  intent("다이브컴퓨터", { productTypes: ["dive_computer"] }),
);

// --- dive_light phrase aliases (2-token phrase 키, 다이빙 컴퓨터와 동일 패턴) ---
check(
  '"다이빙 라이트" -> productType dive_light 단일 phrase (다이빙이 category로 잘못 쪼개지면 안 됨)',
  parseSearchIntent("다이빙 라이트"),
  intent("다이빙 라이트", { productTypes: ["dive_light"] }),
);
check(
  '"수중 라이트" -> productType dive_light',
  parseSearchIntent("수중 라이트"),
  intent("수중 라이트", { productTypes: ["dive_light"] }),
);
check(
  '"다이빙 랜턴" -> productType dive_light',
  parseSearchIntent("다이빙 랜턴"),
  intent("다이빙 랜턴", { productTypes: ["dive_light"] }),
);
check(
  '"수중 랜턴" -> productType dive_light',
  parseSearchIntent("수중 랜턴"),
  intent("수중 랜턴", { productTypes: ["dive_light"] }),
);
check(
  '"라이트" 단독 -> dive_light 아님(너무 넓은 alias 의도적으로 미등록), freeText로만',
  parseSearchIntent("라이트"),
  intent("라이트", { freeTextTokens: ["라이트"] }),
);
check(
  '"랜턴" 단독 -> dive_light 아님(미등록), freeText로만',
  parseSearchIntent("랜턴"),
  intent("랜턴", { freeTextTokens: ["랜턴"] }),
);

// --- bcd aliases ---
check(
  '"BCD" -> productType bcd',
  parseSearchIntent("BCD"),
  intent("BCD", { productTypes: ["bcd"] }),
);
check(
  '"비씨디" -> productType bcd',
  parseSearchIntent("비씨디"),
  intent("비씨디", { productTypes: ["bcd"] }),
);
check(
  '"부력조절기" -> productType bcd',
  parseSearchIntent("부력조절기"),
  intent("부력조절기", { productTypes: ["bcd"] }),
);
check(
  '"부력 조절기" -> productType bcd (2-token phrase)',
  parseSearchIntent("부력 조절기"),
  intent("부력 조절기", { productTypes: ["bcd"] }),
);
check(
  '"조끼" 단독 -> bcd 아님(너무 넓은 alias 의도적으로 미등록), freeText로만',
  parseSearchIntent("조끼"),
  intent("조끼", { freeTextTokens: ["조끼"] }),
);

// --- regulator aliases ---
check(
  '"레귤레이터" -> productType regulator',
  parseSearchIntent("레귤레이터"),
  intent("레귤레이터", { productTypes: ["regulator"] }),
);
check(
  '"다이빙 레귤레이터" -> productType regulator 단일 phrase (다이빙이 category로 잘못 쪼개지면 안 됨)',
  parseSearchIntent("다이빙 레귤레이터"),
  intent("다이빙 레귤레이터", { productTypes: ["regulator"] }),
);
check(
  '"호흡기 세트" -> productType regulator (2-token phrase)',
  parseSearchIntent("호흡기 세트"),
  intent("호흡기 세트", { productTypes: ["regulator"] }),
);
check(
  '"호흡기" 단독 -> regulator 아님(너무 넓은 alias 의도적으로 미등록), freeText로만',
  parseSearchIntent("호흡기"),
  intent("호흡기", { freeTextTokens: ["호흡기"] }),
);

// --- brand + type + free text ---
check(
  '"시그마 85mm 렌즈" -> brand SIGMA AND type camera_lens AND freeText 85mm',
  parseSearchIntent("시그마 85mm 렌즈"),
  intent("시그마 85mm 렌즈", { brands: ["SIGMA"], productTypes: ["camera_lens"], freeTextTokens: ["85mm"] }),
);
check(
  '"탐론 A063" -> brand Tamron AND freeText A063',
  parseSearchIntent("탐론 A063"),
  intent("탐론 A063", { brands: ["Tamron"], freeTextTokens: ["A063"] }),
);

// --- pure English compound: no Korean alias, both tokens become free-text axes ---
check(
  '"Sony WH-1000XM6" -> 둘 다 freeText 토큰(한글 alias 아님)',
  parseSearchIntent("Sony WH-1000XM6"),
  intent("Sony WH-1000XM6", { freeTextTokens: ["Sony", "WH-1000XM6"] }),
);

// --- normalization: whitespace collapse ---
check(
  '"  소니   헤드폰 " -> trim/collapse 후 "소니 헤드폰"과 동일 파싱',
  parseSearchIntent("  소니   헤드폰 "),
  parseSearchIntent("소니 헤드폰"),
);

// --- normalization: NFC/NFD 동일 결과 ---
check(
  "NFC/NFD 정규화 형태가 달라도 동일 파싱 결과",
  parseSearchIntent("소니".normalize("NFD")),
  parseSearchIntent("소니".normalize("NFC")),
);

// --- 비매칭 / 부분문자열 오탐 방지 (토큰 단위에서도 exact match만) ---
check('"시그" -> SIGMA 아님, freeText로만', parseSearchIntent("시그"), intent("시그", { freeTextTokens: ["시그"] }));
check('"마스" -> diving_mask 아님, freeText로만', parseSearchIntent("마스"), intent("마스", { freeTextTokens: ["마스"] }));
check('"핀셋" -> fins 아님, freeText로만', parseSearchIntent("핀셋"), intent("핀셋", { freeTextTokens: ["핀셋"] }));

// --- 빈 입력 ---
check("빈 문자열 -> 전부 빈 배열", parseSearchIntent(""), intent("", {}));
check("공백만 -> 전부 빈 배열", parseSearchIntent("   "), intent("   ", {}));

// --- token 수 상한 (query explosion 방어) - 정확히 6/7 토큰 경계 ---
// 6개 토큰이 전부 서로 다른 축/값으로 인식되도록 구성해, 파서가 어느 것도
// 조용히 누락하지 않는지 deep-equal로 증명한다(중복값이 있으면 Set dedupe로
// 개수가 줄어들어 이 검증 자체가 무의미해지므로 전부 고유하게 골랐다).
const sixTokenQuery = "가민 렌즈 다이빙 시그마 헤드폰 XYZ123";
check(
  "정확히 6 tokens -> tokenLimitExceeded=false, 6개 전부 각자의 축에 반영(누락 없음)",
  parseSearchIntent(sixTokenQuery),
  intent(sixTokenQuery, {
    brands: ["Garmin", "SIGMA"],
    productTypes: ["camera_lens", "headphones"],
    categories: ["diving"],
    freeTextTokens: ["XYZ123"],
  }),
);

const sevenTokenQuery = "가민 렌즈 다이빙 시그마 헤드폰 XYZ123 ABC999"; // 6개 + 1개 = 7 tokens
const overLimit = parseSearchIntent(sevenTokenQuery);
check("7 tokens -> tokenLimitExceeded=true", overLimit.tokenLimitExceeded, true);
check("초과 시 나머지 파싱 필드는 전부 빈 배열", [overLimit.brands, overLimit.productTypes, overLimit.categories, overLimit.freeTextTokens], [[], [], [], []]);
check(
  "초과 시에도 normalizedQuery는 원본 7토큰 전체를 보존(자르지 않음)",
  overLimit.normalizedQuery,
  normalize(sevenTokenQuery),
);
check(
  "normalizedQuery는 whitespace만 정규화, 단어 자체는 그대로",
  overLimit.normalizedQuery,
  "가민 렌즈 다이빙 시그마 헤드폰 XYZ123 ABC999",
);

const atLimit = parseSearchIntent("가 나 다 라 마 바"); // 정확히 6 tokens, 전부 미등록 alias
check("MAX_SEARCH_TOKENS 이하(전부 미등록) -> tokenLimitExceeded=false", atLimit.tokenLimitExceeded, false);
check("6개 미등록 토큰 -> 전부 freeText로 보존(누락 없음)", atLimit.freeTextTokens, ["가", "나", "다", "라", "마", "바"]);

// --- alias dictionary cross-axis collision 방어 ---
check("실제 BRAND/PRODUCT_TYPE/CATEGORY 사전 간 key 충돌 0건", findAliasKeyCollisions(), []);
check(
  "탐지 로직 자체 검증: 같은 key가 두 사전에 있으면 충돌로 잡힘",
  findAliasKeyCollisions([{ 마스크: "x" }, { 마스크: "y" }]),
  ["마스크"],
);
check(
  "탐지 로직 자체 검증: 세 사전 모두 겹치지 않으면 충돌 없음",
  findAliasKeyCollisions([{ a: 1 }, { b: 2 }, { c: 3 }]),
  [],
);
check(
  "같은 사전 내부에서 서로 다른 key가 같은 value를 가리키는 것은 충돌 아님(핀/오리발 -> 둘 다 fins)",
  findAliasKeyCollisions([PRODUCT_TYPE_ALIASES]),
  [],
);
check("PRODUCT_TYPE_ALIASES 안에 핀/오리발이 실제로 공존(정상)", [PRODUCT_TYPE_ALIASES["핀"], PRODUCT_TYPE_ALIASES["오리발"]], [["fins"], ["fins"]]);

// --- isProductType (CLI/Admin 검증에서 계속 사용) ---
check("isProductType rejects unknown slug", isProductType("not_a_real_type"), false);
check("isProductType rejects empty string", isProductType(""), false);
check("isProductType accepts every declared PRODUCT_TYPES entry", PRODUCT_TYPES.every((t) => isProductType(t)), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
