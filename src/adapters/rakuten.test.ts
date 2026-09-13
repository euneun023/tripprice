/**
 * Boundary checks for deriveRakutenShippingStatus() - the only place
 * RakutenItem.postageFlag is interpreted. No test runner is configured in
 * this repo (see src/domain/searchAliases.test.ts for the same
 * plain-assertion convention) - run directly:
 *   npx tsx src/adapters/rakuten.test.ts
 * Exits non-zero on any failure. Never hits the real Rakuten API.
 */
import { deriveRakutenShippingStatus } from "./rakuten";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function main() {
  check("postageFlag=0 -> included (送料込み)", deriveRakutenShippingStatus(0), "included");
  check("postageFlag=1 -> separate (送料別)", deriveRakutenShippingStatus(1), "separate");
  check("postageFlag missing (undefined) -> unknown", deriveRakutenShippingStatus(undefined), "unknown");
  check("postageFlag unrecognized value -> unknown, never guessed", deriveRakutenShippingStatus(2), "unknown");

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}
main();
