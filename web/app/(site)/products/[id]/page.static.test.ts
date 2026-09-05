/**
 * Static source-text check: the public product page's price-check "확인"
 * timestamp must read from lastSuccessAt (last successful price fetch), not
 * lastCheckedAt (last attempt, which can be stale price + fresh timestamp on
 * a NOT_FOUND soft failure). No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx "web/app/(site)/products/[id]/page.static.test.ts"
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

const source = readFileSync(join(__dirname, "page.tsx"), "utf-8");

check("price-check timestamp reads lastSuccessAt", source.includes("formatCheckedDateTime(l.lastSuccessAt)"), true);
check("price-check timestamp no longer reads lastCheckedAt", source.includes("formatCheckedDateTime(l.lastCheckedAt)"), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
