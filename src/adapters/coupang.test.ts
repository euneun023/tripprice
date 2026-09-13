/**
 * Boundary checks for deriveCoupangShippingStatus() - the only place
 * CoupangProduct.isFreeShipping is interpreted. No test runner is configured
 * in this repo (see src/domain/searchAliases.test.ts for the same
 * plain-assertion convention) - run directly:
 *   npx tsx src/adapters/coupang.test.ts
 * Exits non-zero on any failure. Never hits the real Coupang API.
 */
import { deriveCoupangShippingStatus } from "./coupang";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function main() {
  check("isFreeShipping=true -> included", deriveCoupangShippingStatus(true), "included");
  check("isFreeShipping=false -> separate", deriveCoupangShippingStatus(false), "separate");
  check("isFreeShipping missing (undefined) -> unknown, never assumed free", deriveCoupangShippingStatus(undefined), "unknown");

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}
main();
