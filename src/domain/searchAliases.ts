/**
 * Korean-query aliasing for search - purely additive to searchProducts()'s
 * existing 3-way English substring match (brand/official_name/model_sku),
 * never a replacement for it. Two independent, exact-match-only dictionaries:
 *
 *   BRAND_ALIASES        한글 브랜드 표기 -> canonical_products.brand의 실제 값
 *   PRODUCT_TYPE_ALIASES  한글 상품유형 표기 -> canonical_products.product_type slug
 *
 * Deliberately NOT substring matching ("시그" must NOT resolve to SIGMA) -
 * these are short, ambiguous Korean tokens where partial matching would
 * false-positive constantly (e.g. "마" is a prefix of both "마스크" and
 * unrelated words). Exact-match-after-trim only; every non-match silently
 * falls through to the existing English search, which is untouched.
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

/** 한글 브랜드 표기 -> canonical_products.brand의 실제 값 (대소문자는 .ilike가 처리하므로 여기선 신경쓰지 않음). */
export const BRAND_ALIASES: Record<string, string> = {
  걸: "GULL",
  가민: "Garmin",
  소니: "Sony",
  탐론: "Tamron",
  시그마: "SIGMA",
};

/** 한글 상품유형 표기 -> product_type slug. 여러 한글 표기가 같은 slug로 모일 수 있음(핀/오리발 -> fins). */
export const PRODUCT_TYPE_ALIASES: Record<string, ProductType> = {
  렌즈: "camera_lens",
  마스크: "diving_mask",
  핀: "fins",
  오리발: "fins",
  이어폰: "earbuds",
  헤드폰: "headphones",
  스마트워치: "smartwatch",
  카메라: "camera",
  다이브컴퓨터: "dive_computer",
  다이빙컴퓨터: "dive_computer",
  웻슈트: "wetsuit",
  슈트: "wetsuit",
};

function normalize(input: string): string {
  return input.trim();
}

/** Exact match only (no substring) - " 시그마 " -> "SIGMA", "시그" -> null. */
export function resolveBrandAlias(query: string): string | null {
  const key = normalize(query);
  if (!key) return null;
  return BRAND_ALIASES[key] ?? null;
}

/** Exact match only (no substring) - "핀"/"오리발" both -> "fins", "핀셋" -> null. */
export function resolveProductTypeAlias(query: string): ProductType | null {
  const key = normalize(query);
  if (!key) return null;
  return PRODUCT_TYPE_ALIASES[key] ?? null;
}
