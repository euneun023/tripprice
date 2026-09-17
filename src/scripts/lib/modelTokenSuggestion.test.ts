/**
 * Boundary/behavior checks for the Phase 1-D non-authoritative model-token
 * suggestion annotation. No test runner is configured in this repo (see
 * src/domain/searchAliases.test.ts for the same plain-assertion convention) -
 * run directly:
 *   npx tsx src/scripts/lib/modelTokenSuggestion.test.ts
 * Exits non-zero on any failure. Pure unit tests - no file I/O.
 */
import { buildModelTokenSuggestion, formatModelTokenSuggestionLine } from "./modelTokenSuggestion";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

check("no modelCode -> no suggestion", buildModelTokenSuggestion(["ILCE-1M2 body"], null), { hasMatch: false });
check("no modelCode (undefined) -> no suggestion", buildModelTokenSuggestion(["ILCE-1M2 body"], undefined), { hasMatch: false });
check("no texts match -> no suggestion", buildModelTokenSuggestion(["unrelated", "also unrelated"], "ILCE-1M2"), { hasMatch: false });

check(
  "exactly one matching listing -> hasMatch with listingCount 1 (never an index)",
  buildModelTokenSuggestion(["Sony ILCE-1M2 body", "unrelated"], "ILCE-1M2"),
  { hasMatch: true, listingCount: 1 },
);
check(
  "multiple matching listings -> hasMatch with the count, still no index",
  buildModelTokenSuggestion(["Sony ILCE-1M2 shop A", "Sony ILCE-1M2 shop B", "unrelated"], "ILCE-1M2"),
  { hasMatch: true, listingCount: 2 },
);

// The suggestion object itself must never carry a listing index - this is
// checked structurally, not just by value, since Phase 1-D's own precision
// measurement found unique match (count=1) is NOT reliable enough to point
// at a specific listing (real cross-mount/variant false match found on an
// exact-category candidate, plus systemic accessory-compat-mention false
// matches on Coupang).
check(
  "the suggestion type has no 'index'/'matchedIndex' field even when unique",
  Object.keys(buildModelTokenSuggestion(["ILCE-1M2"], "ILCE-1M2")).sort(),
  ["hasMatch", "listingCount"],
);

check(
  "formatModelTokenSuggestionLine returns null when there's no match",
  formatModelTokenSuggestionLine("Rakuten", "ILCE-1M2", { hasMatch: false }),
  null,
);
const line = formatModelTokenSuggestionLine("Rakuten", "ILCE-1M2", { hasMatch: true, listingCount: 1 });
check("the formatted line mentions the count", line?.includes("1건"), true);
check(
  "the formatted line never names a specific listing position (a bare 'index N' or '#N', as opposed to 'N건' meaning a count)",
  /(?:^|[^\w가-힣])(?:idx|index|#)\s*\d/i.test(line ?? ""),
  false,
);
check("the formatted line explicitly disclaims auto-selection", line?.includes("selectedIndex 자동 설정 없음"), true);
check("the formatted line explicitly disclaims evaluator influence", line?.includes("evaluator 판정에 영향 없음"), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
