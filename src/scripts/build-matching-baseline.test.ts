/**
 * Boundary/behavior checks for the Phase 0 matching baseline builder. No test
 * runner is configured in this repo (see src/domain/searchAliases.test.ts for
 * the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/build-matching-baseline.test.ts
 * Exits non-zero on any failure. Read-only: only reads candidate-data/*.json,
 * writes nothing.
 */
import { buildBaseline, summarize, type BaselineCategory } from "./build-matching-baseline";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const ALLOWED_CATEGORIES: BaselineCategory[] = [
  "exact",
  "accessory",
  "wrong_category",
  "variant_mismatch",
  "bundle_condition_mismatch",
  "missing_source",
  "ambiguous",
];

const items = buildBaseline();
const summary = summarize(items);

check("buildBaseline() produces at least one item", items.length > 0, true);

check(
  "every item's category is one of the 7 declared categories",
  items.every((i) => ALLOWED_CATEGORIES.includes(i.category)),
  true,
);

check(
  "no duplicate (file, index) pair - every candidate is a distinct item",
  new Set(items.map((i) => `${i.file}::${i.index}`)).size,
  items.length,
);
// productName alone is NOT expected to be unique within a file: e.g.
// phase2-camera-lens-candidates.review.json legitimately lists "Sigma 15mm
// F1.4 DG DN Diagonal Fisheye Art" twice (sony_e and leica_l mount variants).
check(
  "known cross-mount duplicate productName appears exactly twice",
  items.filter(
    (i) => i.file === "phase2-camera-lens-candidates.review.json" && i.productName === "Sigma 15mm F1.4 DG DN Diagonal Fisheye Art",
  ).length,
  2,
);

check(
  "summary.total equals items.length",
  summary.total,
  items.length,
);

check(
  "exact + obviousReject + ambiguous + missingSource == total",
  summary.exact + summary.obviousReject + summary.ambiguous + summary.missingSource,
  summary.total,
);

check(
  "byCategory counts sum to total",
  Object.values(summary.byCategory).reduce((a, b) => a + b, 0),
  summary.total,
);

check(
  "manualReviewNeeded never exceeds total",
  summary.manualReviewNeeded <= summary.total,
  true,
);

function findItem(file: string, productName: string) {
  return items.find((i) => i.file === file && i.productName === productName);
}

// Spot checks against known review-proposal.md verdicts (documented tier).
check(
  "bcd: Scubapro Hydros Pro is exact (mechanical - coupang selected)",
  findItem("bcd-candidates.review.json", "Scubapro Hydros Pro")?.category,
  "exact",
);
check(
  "bcd: Oceanic OceanPro is wrong_category (documented override)",
  findItem("bcd-candidates.review.json", "Oceanic OceanPro")?.category,
  "wrong_category",
);
check(
  "regulator: Scubapro MK25 EVO/S620Ti reclassified exact despite pending status (fitting-gate override)",
  findItem("regulator-candidates.review.json", "Scubapro MK25 EVO/S620Ti")?.category,
  "exact",
);
check(
  "regulator: Aqua Lung Leg3nd is ambiguous (documented override)",
  findItem("regulator-candidates.review.json", "Aqua Lung Leg3nd")?.category,
  "ambiguous",
);
check(
  "phase3-bcd (searched.json, no review.json): Genesis Origin is wrong_category",
  findItem("phase3-bcd-candidates.searched.json", "Genesis Origin")?.category,
  "wrong_category",
);
check(
  "phase3-bcd: Subgear Levo Travel BCD is missing_source (rakuten 0 results)",
  findItem("phase3-bcd-candidates.searched.json", "Subgear Levo Travel BCD")?.category,
  "missing_source",
);
check(
  "phase2-fins: Scubapro Jet Fin is wrong_category (documented override)",
  findItem("phase2-fins-candidates.review.json", "Scubapro Jet Fin")?.category,
  "wrong_category",
);

// Every documented-tier item must have reasoningRecorded=true.
const documentedItems = items.filter((i) => i.sourceDoc !== null);
check(
  "every item carrying a sourceDoc has reasoningRecorded=true",
  documentedItems.every((i) => i.reasoningRecorded),
  true,
);
check("at least one documented-tier item exists", documentedItems.length > 0, true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed. (${items.length} baseline items, ${documentedItems.length} documented)`);
