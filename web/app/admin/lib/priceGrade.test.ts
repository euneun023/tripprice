/**
 * Boundary-value checks for gradeFromGap() / computeActionable(). No test
 * runner is configured in this repo (see src/scripts/verify-*.ts for the
 * existing plain-assertion convention this follows) - run directly:
 *   npx tsx web/app/admin/lib/priceGrade.test.ts
 * Exits non-zero on any failure.
 */
import { gradeFromGap, computeActionable } from "./priceGrade";
import type { RiskFlag } from "@core/domain/riskFlags";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

// --- rawPriceGrade boundary cases (all from the approved spec) ---
check("49,999원 / 15% -> B", gradeFromGap(49_999, 15).grade, "B");
check("50,000원 / 9.99% -> B", gradeFromGap(50_000, 9.99).grade, "B");
check("50,000원 / 10% -> A", gradeFromGap(50_000, 10).grade, "A");
check("JP >= KR (gapKrw = 0) -> C", gradeFromGap(0, 0).grade, "C");
check("JP > KR (음수 gap) -> C", gradeFromGap(-1_000, -0.5).grade, "C");
check("한쪽 가격 없음 -> N/A", gradeFromGap(null, null).grade, "N/A");

// --- actionable layering: rawPriceGrade must stay A in every case below ---
const noRisk: RiskFlag[] = [];
const blockingRisk: RiskFlag[] = [{ type: "region_lock" }];
const warrantyOnly: RiskFlag[] = [{ type: "warranty_warning" }];

check("A + fresh + no risk -> actionable true", computeActionable("A", "fresh", noRisk), true);
check("A + stale -> raw A / actionable false", computeActionable("A", "stale", noRisk), false);
check("A + blocking risk -> raw A / actionable false", computeActionable("A", "fresh", blockingRisk), false);
check("A + warranty warning only -> raw A / actionable true", computeActionable("A", "fresh", warrantyOnly), true);

// --- actionable never true off an A ---
check("B is never actionable", computeActionable("B", "fresh", noRisk), false);
check("C is never actionable", computeActionable("C", "fresh", noRisk), false);
check("N/A is never actionable", computeActionable("N/A", null, noRisk), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${13} checks passed.`);
