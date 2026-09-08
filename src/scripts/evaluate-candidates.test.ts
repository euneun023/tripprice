/**
 * Boundary/behavior checks for the Candidate Evaluator dry-run runner. No
 * test runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/evaluate-candidates.test.ts
 * Exits non-zero on any failure. Search mode uses fake searchRakuten/
 * searchCoupang functions (never the real adapters/real APIs); evaluate
 * mode uses a fake KRW-conversion function (never the real fx adapter).
 * Neither runSearchMode() nor runEvaluateMode() imports any repository,
 * approveListing(), or DB client - this file only exercises what's already
 * exported, so there is no code path here that could write to the DB.
 */
import { runSearchMode, runEvaluateMode, type CandidateSeed, type CandidateSearchOutput } from "./evaluate-candidates";
import type { RakutenItem } from "../adapters/rakuten";
import type { CoupangProduct } from "../adapters/coupang";
import type { ConvertToKrwFn } from "../services/candidateEvaluationService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const IDENTITY_CONVERT: ConvertToKrwFn = async (price) => ({ krwPrice: price, fxRateUsed: 1, fxAsOf: "2026-01-01T00:00:00Z" });

const FAKE_CREDS = {
  rakuten: { applicationId: "fake-app-id", accessKey: "fake-access-key" },
  coupang: { accessKey: "fake-coupang-access", secretKey: "fake-coupang-secret" },
};

function fakeRakutenItem(overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    itemName: "Fake Rakuten Item",
    itemPrice: 100_000,
    itemUrl: "https://item.rakuten.co.jp/fake/1",
    itemCode: "fakeshop:fake-1",
    shopName: "Fake Shop",
    shopCode: "fakeshop",
    availability: 1,
    ...overrides,
  };
}

function fakeCoupangProduct(overrides: Partial<CoupangProduct> = {}): CoupangProduct {
  return {
    keyword: "fake",
    rank: 1,
    isRocket: true,
    isFreeShipping: true,
    productId: 12345,
    productImage: "https://image.coupang.com/fake.jpg",
    productName: "Fake Coupang Product",
    productPrice: 90_000,
    productUrl: "https://coupang.com/re/fake",
    ...overrides,
  };
}

async function main() {
  // ============================================================
  // SEARCH MODE: preserves both source results, per candidate, independently
  // ============================================================
  {
    const seeds: CandidateSeed[] = [
      { productName: "Product A", productType: "camera" },
      { productName: "Product B", productType: "headphones", modelSkuHint: "SKU-B" },
    ];
    let rakutenCallCount = 0;
    let coupangCallCount = 0;
    const searchRakuten = async (keyword: string) => {
      rakutenCallCount++;
      return [fakeRakutenItem({ itemName: `${keyword} rakuten #1` }), fakeRakutenItem({ itemName: `${keyword} rakuten #2`, itemPrice: 200_000 })];
    };
    const searchCoupang = async (keyword: string) => {
      coupangCallCount++;
      return [fakeCoupangProduct({ productName: `${keyword} coupang #1` })];
    };

    const results = await runSearchMode(seeds, FAKE_CREDS, {
      searchRakuten: searchRakuten as any,
      searchCoupang: searchCoupang as any,
    });

    check("search mode: calls rakuten search once per candidate", rakutenCallCount, 2);
    check("search mode: calls coupang search once per candidate", coupangCallCount, 2);
    check("search mode: returns one output per seed", results.length, 2);
    check("search mode: preserves seed fields (productName)", results[1].productName, "Product B");
    check("search mode: preserves seed fields (modelSkuHint)", results[1].modelSkuHint, "SKU-B");
    check("search mode: rakutenResults preserved per candidate (A)", results[0].rakutenResults.map((r) => r.itemName), ["Product A rakuten #1", "Product A rakuten #2"]);
    check("search mode: rakutenResults preserved per candidate (B, not mixed with A)", results[1].rakutenResults.map((r) => r.itemName), ["Product B rakuten #1", "Product B rakuten #2"]);
    check("search mode: coupangResults preserved per candidate", results[0].coupangResults.map((r) => r.productName), ["Product A coupang #1"]);
    check("search mode: rakutenResults indices are 0-based sequential", results[0].rakutenResults.map((r) => r.index), [0, 1]);
    check("search mode: safe rakuten fields include price/currency/availability/externalId", {
      itemPrice: results[0].rakutenResults[1].itemPrice,
      currency: results[0].rakutenResults[1].currency,
      availability: results[0].rakutenResults[1].availability,
      externalId: results[0].rakutenResults[1].externalId,
    }, { itemPrice: 200_000, currency: "JPY", availability: true, externalId: "fakeshop:fake-1" });
    check("search mode: safe coupang fields include price/currency/externalId", {
      productPrice: results[0].coupangResults[0].productPrice,
      currency: results[0].coupangResults[0].currency,
      externalId: results[0].coupangResults[0].externalId,
    }, { productPrice: 90_000, currency: "KRW", externalId: "12345" });
    check("search mode: nothing pre-selected", results[0].rakutenSelectedIndex, null);
    check("search mode: no risk/confidence pre-filled", [results[0].coupangSelectedIndex, results[0].matchConfidence, results[0].riskFlags], [null, null, []]);
  }

  function candidateWithResults(overrides: Partial<CandidateSearchOutput> = {}): CandidateSearchOutput {
    return {
      productName: "Test Product",
      productType: "camera",
      rakutenResults: [
        { index: 0, itemName: "Rakuten Match", itemPrice: 100_000, itemUrl: "https://x", currency: "JPY", availability: true, externalId: "r1", shopName: "Shop" },
      ],
      coupangResults: [
        { index: 0, productName: "Coupang Match", productPrice: 90_000, productUrl: "https://y", currency: "KRW", externalId: "c1", isRocket: true },
      ],
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      matchConfidence: "verified",
      riskFlags: [],
      ...overrides,
    };
  }

  // ============================================================
  // EVALUATE MODE: unselected candidates are never evaluated
  // ============================================================
  {
    const unselected = candidateWithResults({ productName: "Unselected", rakutenSelectedIndex: null, coupangSelectedIndex: null });
    const partiallySelected = candidateWithResults({ productName: "PartiallySelected", coupangSelectedIndex: null });
    const selected = candidateWithResults({ productName: "Selected" });

    const outcome = await runEvaluateMode([unselected, partiallySelected, selected], { camera: 0 }, IDENTITY_CONVERT);

    check("unselected candidate: not evaluated", outcome.evaluated.map((r) => r.productName), ["Selected"]);
    check("unselected candidate: listed as skipped", outcome.skippedUnselected, ["Unselected", "PartiallySelected"]);
    check("unselected candidate: no invalid-selection entries", outcome.invalidSelections, []);
  }

  // ============================================================
  // EVALUATE MODE: selected index validation
  // ============================================================
  {
    const outOfRangeRakuten = candidateWithResults({ productName: "BadRakutenIndex", rakutenSelectedIndex: 5 });
    const outOfRangeCoupang = candidateWithResults({ productName: "BadCoupangIndex", coupangSelectedIndex: 5 });

    const outcome = await runEvaluateMode([outOfRangeRakuten, outOfRangeCoupang], { camera: 0 }, IDENTITY_CONVERT);

    check("out-of-range indices: nothing evaluated", outcome.evaluated, []);
    check("out-of-range indices: nothing marked unselected", outcome.skippedUnselected, []);
    check("out-of-range indices: two invalid-selection entries", outcome.invalidSelections.length, 2);
    check("out-of-range indices: rakuten reason mentions the index", outcome.invalidSelections[0].reason.includes("rakutenSelectedIndex 5"), true);
    check("out-of-range indices: coupang reason mentions the index", outcome.invalidSelections[1].reason.includes("coupangSelectedIndex 5"), true);
  }

  // ============================================================
  // EVALUATE MODE: verified/estimated/risk passed through to evaluateCandidate() correctly
  // ============================================================
  {
    // Same underlying candidate data, only matchConfidence differs -> verified must be able to
    // reach ADD, estimated at the exact same score must be capped at REVIEW (proves the field
    // actually reached evaluateCandidate(), not just accepted and ignored).
    const strong = {
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop" }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true }],
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      modelSkuHint: "MODEL-X",
      productType: "wetsuit",
    };
    const verifiedCandidate = candidateWithResults({ productName: "Verified", ...strong, matchConfidence: "verified" });
    const estimatedCandidate = candidateWithResults({ productName: "Estimated", ...strong, matchConfidence: "estimated" });

    const outcome = await runEvaluateMode([verifiedCandidate, estimatedCandidate], { wetsuit: 0 }, IDENTITY_CONVERT);
    const verifiedResult = outcome.evaluated.find((r) => r.productName === "Verified")!;
    const estimatedResult = outcome.evaluated.find((r) => r.productName === "Estimated")!;

    check("matchConfidence passthrough: verified -> ADD", verifiedResult.decision, "ADD");
    check("matchConfidence passthrough: estimated (same score) -> REVIEW", estimatedResult.decision, "REVIEW");
    check("matchConfidence passthrough: estimated score is lower by exactly the B2 gap (15 vs 7)", verifiedResult.totalScore - estimatedResult.totalScore, 8);

    const riskCandidate = candidateWithResults({ productName: "Risky", ...strong, matchConfidence: "verified", riskFlags: [{ type: "region_lock" }] });
    const riskOutcome = await runEvaluateMode([riskCandidate], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("riskFlags passthrough: region_lock -> SKIP", riskOutcome.evaluated[0].decision, "SKIP");
    check("riskFlags passthrough: riskFlags preserved on the result", riskOutcome.evaluated[0].riskFlags, [{ type: "region_lock" }]);
  }

  // ============================================================
  // Result JSON structure - the exact shape that gets JSON.stringify'd to the output file
  // ============================================================
  {
    const candidate = candidateWithResults();
    const outcome = await runEvaluateMode([candidate], { camera: 0 }, IDENTITY_CONVERT);
    const r = outcome.evaluated[0];
    const requiredKeys = [
      "productName",
      "productType",
      "rakuten",
      "coupang",
      "rakutenKrw",
      "coupangKrw",
      "savingKrw",
      "savingPercent",
      "priceScore",
      "matchScore",
      "coverageScore",
      "riskFlags",
      "totalScore",
      "decision",
      "reasons",
    ];
    check("result JSON: has every required field", requiredKeys.every((k) => k in r), true);
    check("result JSON: rakuten carries title+raw price", { title: r.rakuten?.itemName, price: r.rakuten?.itemPrice }, { title: "Rakuten Match", price: 100_000 });
    check("result JSON: coupang carries title+raw price", { title: r.coupang?.productName, price: r.coupang?.productPrice }, { title: "Coupang Match", price: 90_000 });
    check("result JSON: outcome top-level shape", Object.keys(outcome).sort(), ["evaluated", "invalidSelections", "skippedUnselected"]);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
