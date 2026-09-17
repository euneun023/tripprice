/**
 * Regression guard for the Phase 1-C identifier/model-number coverage
 * analysis against the Phase 0 baseline (commit 5c88042,
 * src/scripts/candidate-data/matching-baseline.json). No test runner is
 * configured in this repo (see src/domain/searchAliases.test.ts for the same
 * plain-assertion convention) - run directly:
 *   npx tsx src/scripts/analyze-identifier-coverage.test.ts
 * Exits non-zero on any failure. Read-only: reads candidate-data/*.json,
 * writes nothing.
 */
import { analyzeIdentifierCoverage } from "./analyze-identifier-coverage";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const r = analyzeIdentifierCoverage();

check("covers the full Phase 0 baseline (429 candidates)", r.totalCandidates, 429);

// JAN/UPC/EAN: coverage is expected to stay negligible - this is the whole
// reason Phase 1-C did not build an identifier-matching signal for barcodes.
check("JAN/UPC/EAN-like text coverage stays negligible (<10 candidates)", r.barcodeCandidateCount < 10, true);

// modelSkuHint coverage, pinned against the fixed baseline.
check("modelSkuHint present on 70 candidates", r.hasModelSkuHint, 70);
check("SKU-like modelSkuHint (isSkuLikeModelSku=true) on 49 candidates", r.skuLikeModelSkuHint, 49);
check("hasModelSkuHint = skuLike + notSkuLike", r.skuLikeModelSkuHint + r.notSkuLike, r.hasModelSkuHint);
check("rows.length matches skuLikeModelSkuHint count", r.rows.length, r.skuLikeModelSkuHint);

// Safety property this whole phase is built around: for the categories where
// an incorrect match would be dangerous (ambiguous/variant_mismatch), a
// token match must never silently conflate two different products. This is
// the same safety bar Phase 1-A/1-B enforced for the negative filter.
const protectedRows = r.rows.filter((x) => x.category === "ambiguous" || x.category === "variant_mismatch");
check("exactly 3 ambiguous/variant_mismatch candidates carry a SKU-like modelSkuHint", protectedRows.length, 3);

const panasonic = protectedRows.find((x) => x.productName === "Panasonic LUMIX S5II");
check(
  "Panasonic LUMIX S5II: base code 'DC-S5M2' matches nothing (every real listing is a kit-suffixed variant) - zero false positive by construction",
  panasonic && { rakuten: panasonic.rakutenMatches, coupang: panasonic.coupangMatches },
  { rakuten: 0, coupang: 0 },
);

const masterDynamic = protectedRows.find((x) => x.productName === "Master & Dynamic MW75");
check(
  "Master & Dynamic MW75: code matches exactly its own listings, not any of the unrelated noise",
  masterDynamic && { rakuten: masterDynamic.rakutenMatches, coupang: masterDynamic.coupangMatches },
  { rakuten: 1, coupang: 1 },
);

const tusa = protectedRows.find((x) => x.productName === "TUSA Liberator");
check(
  "TUSA Liberator: code (BC0103B) matches its own listings only, never the confusingly-named LIBERATOR X fin SKU (SF0113)",
  tusa && { rakuten: tusa.rakutenMatches, coupang: tusa.coupangMatches },
  { rakuten: 1, coupang: 1 },
);

// Precision against the exact category's human-recorded selection - this is
// the evidence base for treating modelSkuHint as a usable benchmark signal.
const exactRows = r.rows.filter((x) => x.category === "exact");
const rakutenChecked = exactRows.filter((x) => x.rakutenSelectedMatched !== null);
const rakutenAgree = rakutenChecked.filter((x) => x.rakutenSelectedMatched === true).length;
const coupangChecked = exactRows.filter((x) => x.coupangSelectedMatched !== null);
const coupangAgree = coupangChecked.filter((x) => x.coupangSelectedMatched === true).length;

check("exact candidates with SKU-like modelSkuHint: 40", exactRows.length, 40);
check("Rakuten selected-listing agreement: 35/37", `${rakutenAgree}/${rakutenChecked.length}`, "35/37");
check("Coupang selected-listing agreement: 25/30", `${coupangAgree}/${coupangChecked.length}`, "25/30");
check("Rakuten agreement rate stays above 90%", rakutenAgree / rakutenChecked.length > 0.9, true);
check("Coupang agreement rate stays above 75%", coupangAgree / coupangChecked.length > 0.75, true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
