/**
 * Boundary/behavior checks for searchAliases.ts's pure functions. No test
 * runner is configured in this repo (see web/app/admin/lib/priceGrade.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/domain/searchAliases.test.ts
 * Exits non-zero on any failure.
 */
import { resolveBrandAlias, resolveProductTypeAlias, isProductType, PRODUCT_TYPES } from "./searchAliases";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

// --- brand alias exact match ---
check('brand alias exact match: "걸" -> GULL', resolveBrandAlias("걸"), "GULL");
check('brand alias exact match: "가민" -> Garmin', resolveBrandAlias("가민"), "Garmin");
check('brand alias exact match: "소니" -> Sony', resolveBrandAlias("소니"), "Sony");
check('brand alias exact match: "탐론" -> Tamron', resolveBrandAlias("탐론"), "Tamron");
check('brand alias exact match: "시그마" -> SIGMA', resolveBrandAlias("시그마"), "SIGMA");

// --- product type alias exact match ---
check('product type alias: "렌즈" -> camera_lens', resolveProductTypeAlias("렌즈"), "camera_lens");
check('product type alias: "마스크" -> diving_mask', resolveProductTypeAlias("마스크"), "diving_mask");
check('product type alias: "이어폰" -> earbuds', resolveProductTypeAlias("이어폰"), "earbuds");
check('product type alias: "헤드폰" -> headphones', resolveProductTypeAlias("헤드폰"), "headphones");
check('product type alias: "스마트워치" -> smartwatch', resolveProductTypeAlias("스마트워치"), "smartwatch");

// --- 핀 / 오리발 -> 동일 fins ---
check('"핀" -> fins', resolveProductTypeAlias("핀"), "fins");
check('"오리발" -> fins', resolveProductTypeAlias("오리발"), "fins");
check("핀 and 오리발 resolve to the same slug", resolveProductTypeAlias("핀") === resolveProductTypeAlias("오리발"), true);

// --- trim ---
check('trim: " 시그마 " -> SIGMA', resolveBrandAlias(" 시그마 "), "SIGMA");
check('trim: "  마스크  " -> diving_mask', resolveProductTypeAlias("  마스크  "), "diving_mask");

// --- 비매칭 (no alias for this token) ---
check('no match: "SIGMA" (already English) -> null', resolveBrandAlias("SIGMA"), null);
check('no match: "물안경" (not in dictionary) -> null', resolveProductTypeAlias("물안경"), null);
check('no match: empty string -> null', resolveBrandAlias(""), null);
check('no match: whitespace-only -> null', resolveProductTypeAlias("   "), null);

// --- 부분문자열 비매칭: "시그" must NOT resolve to SIGMA (exact match only) ---
check('substring must NOT match: "시그" -> null (not SIGMA)', resolveBrandAlias("시그"), null);
check('substring must NOT match: "마스" -> null (not diving_mask)', resolveProductTypeAlias("마스"), null);
check('substring must NOT match: "핀셋" -> null (not fins)', resolveProductTypeAlias("핀셋"), null);

// --- 기존 영문 query가 alias 없이 그대로 유지: alias resolvers must be inert on
// English/other queries that aren't Korean alias keys, so the caller's
// existing 3-way English search path is never short-circuited or altered ---
check('English brand query untouched by alias layer: "Garmin" -> null', resolveBrandAlias("Garmin"), null);
check('English/model query untouched: "WF-1000XM5" -> null', resolveBrandAlias("WF-1000XM5"), null);
check('English query untouched by product-type alias layer: "lens" -> null', resolveProductTypeAlias("lens"), null);

// --- invalid product_type rejected at the code-level validation used by CLI/admin route ---
check("isProductType rejects unknown slug", isProductType("not_a_real_type"), false);
check("isProductType rejects empty string", isProductType(""), false);
check("isProductType accepts every declared PRODUCT_TYPES entry", PRODUCT_TYPES.every((t) => isProductType(t)), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
