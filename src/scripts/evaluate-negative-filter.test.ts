/**
 * Regression guard for the Phase 1-A negative filter's safety property:
 * zero false rejects against the Phase 0 baseline's exact/ambiguous/
 * variant_mismatch candidates (commit a873520,
 * src/scripts/candidate-data/matching-baseline.json). No test runner is
 * configured in this repo (see src/domain/searchAliases.test.ts for the same
 * plain-assertion convention) - run directly:
 *   npx tsx src/scripts/evaluate-negative-filter.test.ts
 * Exits non-zero on any failure. Read-only: reads candidate-data/*.json,
 * writes nothing.
 */
import { computeEvals, TARGET_CATEGORIES, PROTECTED_CATEGORIES } from "./evaluate-negative-filter";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const evals = computeEvals();

check("computeEvals() covers the full Phase 0 baseline (429 candidates)", evals.length, 429);

// The core safety requirement this whole phase is built around: zero false
// rejects on every protected category.
for (const category of PROTECTED_CATEGORIES) {
  const inCategory = evals.filter((e) => e.category === category);
  check(`${category}: false reject count is 0 (${inCategory.length} candidates checked)`, inCategory.filter((e) => e.autoReject).length, 0);
}

// Stricter check specifically for exact: the individually-selected listing
// itself must never be misclassified as negative (a stronger bar than
// "not every listing was negative").
const exactWithSelectedIndex = evals.filter((e) => e.category === "exact" && e.selectedListingFalselyFlagged !== null);
check(
  "exact: no selected listing is individually misclassified as negative",
  exactWithSelectedIndex.filter((e) => e.selectedListingFalselyFlagged === true).length,
  0,
);
check("exact: selected-listing check actually ran against a non-trivial sample", exactWithSelectedIndex.length > 200, true);

// Recall sanity: the filter should catch at least *something* in the target
// categories (guards against a silent regression where every rule stops
// matching), without asserting a specific number that would make this test
// brittle against future keyword-list tuning.
const targetEvals = evals.filter((e) => TARGET_CATEGORIES.includes(e.category));
const caught = targetEvals.filter((e) => e.autoReject).length;
check("at least one target-category candidate is caught (recall > 0)", caught > 0, true);
check("recall never exceeds the target population size", caught <= targetEvals.length, true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed. (${caught}/${targetEvals.length} target candidates caught, 0 false rejects on protected categories)`);
