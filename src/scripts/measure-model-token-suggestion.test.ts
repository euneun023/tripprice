/**
 * Regression guard for the Phase 1-D gate evaluation against the Phase 0
 * baseline (commit 5c88042, src/scripts/candidate-data/matching-baseline.json).
 * No test runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/measure-model-token-suggestion.test.ts
 * Exits non-zero on any failure. Read-only: reads candidate-data/*.json,
 * writes nothing.
 *
 * This file is intentionally re-importable for its computation, not just its
 * CLI output - see computeGateEvaluation() below - so the gate's numeric
 * conclusions ("Rakuten unique-match precision 66.7%, real cross-mount false
 * match found") stay pinned as a regression, not just printed once and
 * forgotten.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseline, REVIEW_BATCHES, SEARCHED_ONLY_BATCHES, CANDIDATE_DATA_DIR } from "./build-matching-baseline";
import { matchesModelToken } from "./lib/identifierMatch";
import { classifyListingText } from "./lib/negativeFilter";
import { analyzeIdentifierCoverage } from "./analyze-identifier-coverage";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

interface RawCandidate {
  productType: string;
  modelSkuHint?: string | null;
  rakutenResults?: { itemName?: string }[];
  coupangResults?: { productName?: string }[];
  rakutenSelectedIndex?: number | null;
  coupangSelectedIndex?: number | null;
}

const rawByFile = new Map<string, RawCandidate[]>();
for (const batch of [...REVIEW_BATCHES, ...SEARCHED_ONLY_BATCHES]) {
  rawByFile.set(batch.file, JSON.parse(readFileSync(join(CANDIDATE_DATA_DIR, batch.file), "utf8")));
}
const { rows: coverageRows } = analyzeIdentifierCoverage();

function evaluate(source: "rakuten" | "coupang") {
  const matchField = source === "rakuten" ? "rakutenMatches" : "coupangMatches";
  const unique = coverageRows.filter((r) => (r as any)[matchField] === 1);
  const evaluated = unique.map((r) => {
    const raw = rawByFile.get(r.file)![r.index];
    const texts = source === "rakuten" ? (raw.rakutenResults ?? []).map((x) => x.itemName ?? "") : (raw.coupangResults ?? []).map((x) => x.productName ?? "");
    const matchedIdx = texts.findIndex((t) => matchesModelToken(t, r.modelSkuHint));
    const selectedIndex = source === "rakuten" ? raw.rakutenSelectedIndex ?? null : raw.coupangSelectedIndex ?? null;
    const agrees = selectedIndex === null ? null : selectedIndex === matchedIdx;
    const matchedIsNegative = classifyListingText(texts[matchedIdx], raw.productType).negative;
    return { category: r.category, productName: r.productName, agrees, matchedIsNegative };
  });
  const checked = evaluated.filter((e) => e.agrees !== null);
  const agree = checked.filter((e) => e.agrees === true).length;
  return { count: unique.length, checked: checked.length, agree, evaluated };
}

const rakuten = evaluate("rakuten");
const coupang = evaluate("coupang");

check("Rakuten unique match count is 5", rakuten.count, 5);
check("Coupang unique match count is 15", coupang.count, 15);

check("Rakuten unique-match precision (ground-truth-checked): 2/3", `${rakuten.agree}/${rakuten.checked}`, "2/3");
check("Coupang unique-match precision (ground-truth-checked): 5/6", `${coupang.agree}/${coupang.checked}`, "5/6");

// The specific real failure this whole gate decision rests on: a
// cross-mount/variant false match on an *exact*-category candidate (Tamron
// 12-20mm F2.8: base code "A084" token-matched a Nikon Z listing while the
// actual selected listing was the Sony E variant "A084S"). If this ever
// stops reproducing, the precision numbers above will also have moved and
// the gate decision should be re-examined, not just this flag alone.
const tamron = rakuten.evaluated.find((e) => e.productName === "Tamron 12-20mm F2.8");
check("Tamron 12-20mm F2.8 (exact category) unique Rakuten match disagrees with the real selection", tamron?.agrees, false);

// Systemic accessory-compat-mention risk on Coupang: unique matches whose
// matched listing has no recorded ground truth (the candidate's real
// product simply doesn't exist on that source) split into two groups -
// ones negativeFilter already flags, and ones it doesn't. Both groups are
// exactly why this gate does not authorize index-level recommendations.
const coupangNoGroundTruth = coupang.evaluated.filter((e) => e.agrees === null);
const coupangNoGtNotFlagged = coupangNoGroundTruth.filter((e) => !e.matchedIsNegative).length;
check("Coupang: candidates with no ground truth for the matched listing", coupangNoGroundTruth.length, 9);
check("Coupang: of those, negativeFilter fails to flag the accessory/noise listing in at least half", coupangNoGtNotFlagged >= 4, true);

// The actual Gate decision this phase produced, pinned as a regression so a
// future change to the underlying data or matcher can't silently flip it
// without a human noticing.
const protectedCategories = ["ambiguous", "variant_mismatch"];
const protectedFalseSuggestion = [...rakuten.evaluated, ...coupang.evaluated].filter((e) => protectedCategories.includes(e.category) && e.agrees === false).length;
check("ambiguous/variant_mismatch categories: 0 confirmed false suggestions (ground-truth-checked)", protectedFalseSuggestion, 0);

const PRECISION_GATE_THRESHOLD = 0.9;
const gatePassesForIndexRecommendation =
  protectedFalseSuggestion === 0 && rakuten.agree / rakuten.checked >= PRECISION_GATE_THRESHOLD && coupang.agree / coupang.checked >= PRECISION_GATE_THRESHOLD && tamron?.agrees !== false;
check("Gate for index-level ('this specific listing') recommendation: FAILS", gatePassesForIndexRecommendation, false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed. Gate decision: index-level recommendation NOT authorized; count-only annotation (src/scripts/lib/modelTokenSuggestion.ts) is the safe fallback actually implemented.`);
