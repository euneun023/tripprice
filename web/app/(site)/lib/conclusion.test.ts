/**
 * Regression test for legsByRegion()'s cheapest-per-region selection. No
 * test runner is configured in this repo (see web/app/admin/lib/priceGrade.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx "web/app/(site)/lib/conclusion.test.ts"
 * Exits non-zero on any failure.
 */
import { legsByRegion } from "./conclusion";
import type { ComparisonResult, ComparisonLeg } from "@core/services/comparisonService";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function leg(sourceListingId: string, sourceId: string, krwPrice: number): ComparisonLeg {
  return {
    sourceListingId,
    sourceId,
    price: krwPrice,
    currency: "KRW",
    krwPrice,
    availability: true,
    isWinner: false,
    diffFromWinnerKrw: 0,
    savingsVsHighestKrw: 0,
    fxRateUsed: null,
    fxAsOf: null,
  };
}

// mimics compareVariant()'s own contract: legs arrive sorted ascending by krwPrice
function comparisonOf(legs: ComparisonLeg[]): ComparisonResult {
  return { productVariantId: "test-variant", mode: legs.length > 1 ? "n-way" : "single", legCount: legs.length, legs };
}

const regionOf = (sourceId: string) => (sourceId.startsWith("coupang") ? "KR" : sourceId.startsWith("rakuten") ? "JP" : undefined);

// --- KR listing 2개 -> 더 싼 KR 선택 ---
{
  const comparison = comparisonOf([
    leg("kr-cheap", "coupang-a", 100_000),
    leg("kr-expensive", "coupang-b", 150_000),
  ]);
  const result = legsByRegion(comparison, regionOf);
  check("KR listing 2개 -> 더 싼 쪽(kr-cheap) 선택", result.KR?.sourceListingId, "kr-cheap");
}

// --- JP listing 2개 -> 더 싼 JP 선택 ---
{
  const comparison = comparisonOf([
    leg("jp-cheap", "rakuten-a", 80_000),
    leg("jp-expensive", "rakuten-b", 120_000),
  ]);
  const result = legsByRegion(comparison, regionOf);
  check("JP listing 2개 -> 더 싼 쪽(jp-cheap) 선택", result.JP?.sourceListingId, "jp-cheap");
}

// --- KR/JP 각각 1개 -> 기존 동작 유지 (단순 매핑) ---
{
  const comparison = comparisonOf([leg("jp-only", "rakuten-a", 90_000), leg("kr-only", "coupang-a", 130_000)]);
  const result = legsByRegion(comparison, regionOf);
  check("KR 1개/JP 1개 -> KR은 kr-only", result.KR?.sourceListingId, "kr-only");
  check("KR 1개/JP 1개 -> JP는 jp-only", result.JP?.sourceListingId, "jp-only");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
