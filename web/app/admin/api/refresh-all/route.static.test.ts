/**
 * Static source-text check: the admin "refresh-all" route must never pass
 * checkedBefore to refreshApprovedListings() - that parameter exists only
 * for a future scheduled Job, and admin's manual full-refresh semantics must
 * stay exactly as they were before it was added. No test runner is
 * configured in this repo (see web/app/admin/lib/priceGrade.test.ts for the
 * existing plain-assertion convention this follows) - run directly:
 *   npx tsx "web/app/admin/api/refresh-all/route.static.test.ts"
 * Exits non-zero on any failure.
 */
import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const source = readFileSync(join(__dirname, "route.ts"), "utf-8");

check("admin refresh-all never references checkedBefore", source.includes("checkedBefore"), false);
check(
  "rakuten call unchanged: { sourceId: \"rakuten\", limit: 50 }",
  source.includes('refreshApprovedListings(deps, { sourceId: "rakuten", limit: 50 })'),
  true,
);
check(
  "coupang call unchanged: { sourceId: \"coupang\", limit: 50 }",
  source.includes('refreshApprovedListings(deps, { sourceId: "coupang", limit: 50 })'),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
