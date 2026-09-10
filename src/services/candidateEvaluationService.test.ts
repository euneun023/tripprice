/**
 * Boundary/behavior checks for the Candidate Evaluator v0. No test runner is
 * configured in this repo (see src/domain/searchAliases.test.ts for the same
 * plain-assertion convention) - run directly:
 *   npx tsx src/services/candidateEvaluationService.test.ts
 * Exits non-zero on any failure. Never touches the real fx adapter, DB, or
 * any approve/seed-product path - every case uses a fake convertFn and
 * plain in-memory objects.
 */
import {
  evaluateCandidate,
  selectCandidates,
  priceGapPercentScore,
  absoluteSavingScore,
  nameMatchScore,
  tokenOverlapRatio,
  confidenceScore,
  coverageGapScore,
  computeCoverageScore,
  ADD_SCORE_THRESHOLD,
  REVIEW_SCORE_THRESHOLD,
  type CandidateEvaluationInput,
  type ConvertToKrwFn,
  type CandidateEvaluationResult,
} from "./candidateEvaluationService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

/** rate=1 identity conversion - keeps expected KRW numbers exactly equal to the input price, for easy hand-checked arithmetic. */
const IDENTITY_CONVERT: ConvertToKrwFn = async (price) => ({ krwPrice: price, fxRateUsed: 1, fxAsOf: "2026-01-01T00:00:00Z" });

const FAILING_JPY_CONVERT: ConvertToKrwFn = async (price, currency) => {
  if (currency === "JPY") throw new Error("fx adapter unreachable (simulated)");
  return { krwPrice: price, fxRateUsed: 1, fxAsOf: null };
};

function baseInput(overrides: Partial<CandidateEvaluationInput> = {}): CandidateEvaluationInput {
  return {
    productName: "Test Product",
    productType: "camera",
    rakuten: { itemName: "Test Item Rakuten", itemPrice: 100_000, itemUrl: "https://item.rakuten.co.jp/x/y" },
    coupang: { productName: "Test Item Coupang", productPrice: 90_000, productUrl: "https://coupang.com/x" },
    ...overrides,
  };
}

async function main() {
  // ============================================================
  // A1/A2 pure tier boundaries
  // ============================================================
  check("A1 >=30%", priceGapPercentScore(30), 25);
  check("A1 29.9%", priceGapPercentScore(29.9), 20);
  check("A1 >=20%", priceGapPercentScore(20), 20);
  check("A1 19.9%", priceGapPercentScore(19.9), 15);
  check("A1 >=12%", priceGapPercentScore(12), 15);
  check("A1 11.9%", priceGapPercentScore(11.9), 10);
  check("A1 >=7%", priceGapPercentScore(7), 10);
  check("A1 6.9%", priceGapPercentScore(6.9), 5);
  check("A1 >=3%", priceGapPercentScore(3), 5);
  check("A1 2.9% -> 0", priceGapPercentScore(2.9), 0);

  check("A2 >=300000", absoluteSavingScore(300_000), 25);
  check("A2 299999", absoluteSavingScore(299_999), 20);
  check("A2 >=150000", absoluteSavingScore(150_000), 20);
  check("A2 149999", absoluteSavingScore(149_999), 15);
  check("A2 >=80000", absoluteSavingScore(80_000), 15);
  check("A2 79999", absoluteSavingScore(79_999), 10);
  check("A2 >=30000", absoluteSavingScore(30_000), 10);
  check("A2 29999", absoluteSavingScore(29_999), 5);
  check("A2 >=10000", absoluteSavingScore(10_000), 5);
  check("A2 9999 -> 0", absoluteSavingScore(9_999), 0);

  // ============================================================
  // 큰 % 가격차 -> 높은 price score
  // ============================================================
  {
    const input = baseInput({
      rakuten: { itemName: "Camera A", itemPrice: 100_000, itemUrl: "https://x" },
      coupang: { productName: "Camera A", productPrice: 50_000, productUrl: "https://y" },
    });
    // savingKrw=50000 (50%), savingPercent=50 -> A1=25, A2 tier(50000)=10 -> priceScore=35
    const result = await evaluateCandidate(input, { camera: 0 }, IDENTITY_CONVERT);
    check("big % gap: savingPercent", result.savingPercent, 50);
    check("big % gap: priceScore", result.priceScore, 35);
  }

  // ============================================================
  // 고가 상품의 낮은 %지만 큰 절대 절감액 반영
  // ============================================================
  {
    const input = baseInput({
      rakuten: { itemName: "Expensive Lens", itemPrice: 5_000_000, itemUrl: "https://x" },
      coupang: { productName: "Expensive Lens", productPrice: 4_700_000, productUrl: "https://y" },
    });
    // savingKrw=300000, savingPercent=6% -> A1(6%)=5, A2(300000)=25 -> priceScore=30
    const result = await evaluateCandidate(input, { camera: 0 }, IDENTITY_CONVERT);
    check("low % but big absolute saving: savingPercent", result.savingPercent, 6);
    check("low % but big absolute saving: priceScore", result.priceScore, 30);
    check("low % alone would only score 5 - absolute saving lifts it well above that", result.priceScore > 5, true);
  }

  // ============================================================
  // B1: modelSkuHint 양쪽 exact match
  // ============================================================
  {
    const score = nameMatchScore(
      "Sony WH-1000XM6 ワイヤレスノイズキャンセリングヘッドホン ブラック",
      "소니 WH-1000XM6 노이즈캔슬링 헤드폰 블랙",
      "WH-1000XM6",
    );
    check("modelSkuHint exact match (case-insensitive) on both titles -> 15", score, 15);
  }
  {
    // hint present but only on one side -> falls through to token overlap, not an automatic 15
    const score = nameMatchScore("Sony WH-1000XM6 Black", "완전히 다른 상품명", "WH-1000XM6");
    check("modelSkuHint present but only matches one side -> not 15", score, 0);
  }

  // ============================================================
  // token overlap 구간별 점수
  // ============================================================
  check("token overlap ratio 1.0 (>=0.6)", nameMatchScore("apple watch series 10", "apple watch series 10 titanium", null), 12);
  check("token overlap ratio 0.5 (>=0.4)", nameMatchScore("a b c d", "a b x y", null), 8);
  check("token overlap ratio 0.333 (>=0.2)", nameMatchScore("a b c", "a x y", null), 4);
  check("token overlap ratio 0 (<0.2)", nameMatchScore("a b c d e", "x y z", null), 0);
  check("tokenOverlapRatio raw value", tokenOverlapRatio("a b c d", "a b x y"), 0.5);

  // B2
  check("confidenceScore verified", confidenceScore("verified"), 15);
  check("confidenceScore estimated", confidenceScore("estimated"), 7);
  check("confidenceScore undefined", confidenceScore(undefined), 0);
  check("confidenceScore null", confidenceScore(null), 0);

  // ============================================================
  // coverage gap 점수 검증
  // ============================================================
  check("coverageGapScore gap 0", coverageGapScore(0), 20);
  check("coverageGapScore gap negative (below min, still full)", coverageGapScore(-1), 20);
  check("coverageGapScore gap 1", coverageGapScore(1), 15);
  check("coverageGapScore gap 2", coverageGapScore(2), 10);
  check("coverageGapScore gap 3", coverageGapScore(3), 5);
  check("coverageGapScore gap 4", coverageGapScore(4), 0);
  check("coverageGapScore gap 10", coverageGapScore(10), 0);
  check(
    "computeCoverageScore: wetsuit is already the minimum (gap 0)",
    computeCoverageScore("wetsuit", { wetsuit: 1, camera: 4, earbuds: 3 }),
    20,
  );
  check(
    "computeCoverageScore: camera is 3 above the minimum (gap 3)",
    computeCoverageScore("camera", { wetsuit: 1, camera: 4, earbuds: 3 }),
    5,
  );

  // ============================================================
  // estimated가 70점 이상이어도 REVIEW ; verified + 70 이상 -> ADD
  // ============================================================
  {
    const strongInput = baseInput({
      productType: "wetsuit",
      rakuten: { itemName: "Mares Reef 3mm Wetsuit MODEL-X", itemPrice: 500_000, itemUrl: "https://x" },
      coupang: { productName: "마레스 리프 3mm 웨트슈트 MODEL-X", productPrice: 300_000, productUrl: "https://y" },
      modelSkuHint: "MODEL-X",
      matchConfidence: "estimated",
    });
    // savingKrw=200000 (40%) -> A1=25, A2(200000)=20 -> priceScore=45
    // matchScore = B1(15, modelSkuHint both sides) + B2(estimated=7) = 22
    // coverageScore(gap0)=20 -> total=87 >= 70, but confidence is "estimated"
    const result = await evaluateCandidate(strongInput, { wetsuit: 0 }, IDENTITY_CONVERT);
    check("estimated, high score: totalScore >= ADD_SCORE_THRESHOLD", result.totalScore >= ADD_SCORE_THRESHOLD, true);
    check("estimated, high score: decision capped at REVIEW", result.decision, "REVIEW");

    const verifiedInput = { ...strongInput, matchConfidence: "verified" as const };
    const verifiedResult = await evaluateCandidate(verifiedInput, { wetsuit: 0 }, IDENTITY_CONVERT);
    check("verified, high score: decision", verifiedResult.decision, "ADD");
    check("verified, high score: totalScore", verifiedResult.totalScore, 45 + 15 + 15 + 20); // priceScore + B1 + B2(verified=15) + coverage
  }

  // ============================================================
  // 40 미만 -> SKIP (score-based, not gate/risk-based)
  // ============================================================
  {
    // priceScore: savingPercent=1% -> A1=0, savingKrw=1000 -> A2=0 -> priceScore=0
    // matchScore: 1/4 token overlap (ratio 0.25, tier 0.2-0.4) -> B1=4, no matchConfidence -> B2=0 -> matchScore=4
    //   (deliberately nonzero B1 so this does NOT trip the separate match-uncertain REVIEW gate)
    // coverageScore: camera is far from the minimum (wetsuit=0) -> gap=10 -> coverageScore=0
    // total = 0 + 4 + 0 = 4, comfortably under REVIEW_SCORE_THRESHOLD
    const input = baseInput({
      productType: "camera",
      rakuten: { itemName: "alpha beta gamma delta", itemPrice: 100_000, itemUrl: "https://x" },
      coupang: { productName: "alpha epsilon zeta eta", productPrice: 99_000, productUrl: "https://y" },
      matchConfidence: undefined,
    });
    const result = await evaluateCandidate(input, { camera: 10, wetsuit: 0 }, IDENTITY_CONVERT);
    check("low score: matchScore > 0 (avoids the match-uncertain gate)", result.matchScore, 4);
    check("low score: priceScore", result.priceScore, 0);
    check("low score: coverageScore", result.coverageScore, 0);
    check("low score: totalScore < REVIEW_SCORE_THRESHOLD", result.totalScore < REVIEW_SCORE_THRESHOLD, true);
    check("low score: decision", result.decision, "SKIP");
  }

  // ============================================================
  // single source -> SKIP
  // ============================================================
  {
    const noRakuten = await evaluateCandidate(baseInput({ rakuten: null }), { camera: 0 }, IDENTITY_CONVERT);
    check("single source (no rakuten): decision", noRakuten.decision, "SKIP");
    check("single source (no rakuten): has a reason", noRakuten.reasons.length > 0, true);

    const noCoupang = await evaluateCandidate(baseInput({ coupang: null }), { camera: 0 }, IDENTITY_CONVERT);
    check("single source (no coupang): decision", noCoupang.decision, "SKIP");
  }

  // ============================================================
  // invalid price -> SKIP
  // ============================================================
  {
    const zeroPrice = await evaluateCandidate(
      baseInput({ rakuten: { itemName: "x", itemPrice: 0, itemUrl: "https://x" } }),
      { camera: 0 },
      IDENTITY_CONVERT,
    );
    check("zero rakuten price: decision", zeroPrice.decision, "SKIP");

    const negativePrice = await evaluateCandidate(
      baseInput({ coupang: { productName: "x", productPrice: -100, productUrl: "https://y" } }),
      { camera: 0 },
      IDENTITY_CONVERT,
    );
    check("negative coupang price: decision", negativePrice.decision, "SKIP");
  }

  // ============================================================
  // 허용되지 않은 product_type -> SKIP
  // ============================================================
  {
    const result = await evaluateCandidate(baseInput({ productType: "not_a_real_type" }), { camera: 0 }, IDENTITY_CONVERT);
    check("invalid product_type: decision", result.decision, "SKIP");
  }

  // ============================================================
  // FX conversion failure -> REVIEW
  // ============================================================
  {
    const input = baseInput({ matchConfidence: "verified", modelSkuHint: "TESTSKU", rakuten: { itemName: "TESTSKU item", itemPrice: 100_000, itemUrl: "https://x" }, coupang: { productName: "TESTSKU item", productPrice: 90_000, productUrl: "https://y" } });
    const result = await evaluateCandidate(input, { camera: 0 }, FAILING_JPY_CONVERT);
    check("fx failure: decision", result.decision, "REVIEW");
    check("fx failure: rakutenKrw is null", result.rakutenKrw, null);
    check("fx failure: savingKrw is null", result.savingKrw, null);
    check("fx failure: priceScore is 0", result.priceScore, 0);
    check("fx failure: reason mentions KRW", result.reasons.some((r) => r.includes("KRW 환산")), true);
  }

  // ============================================================
  // Risk: language_limitation / warranty_warning -> REVIEW (regardless of score)
  // ============================================================
  {
    const strongInput = baseInput({
      productType: "wetsuit",
      rakuten: { itemName: "Mares Reef 3mm Wetsuit MODEL-X", itemPrice: 500_000, itemUrl: "https://x" },
      coupang: { productName: "마레스 리프 3mm 웨트슈트 MODEL-X", productPrice: 300_000, productUrl: "https://y" },
      modelSkuHint: "MODEL-X",
      matchConfidence: "verified",
    });

    const langResult = await evaluateCandidate(
      { ...strongInput, riskFlags: [{ type: "language_limitation" }] },
      { wetsuit: 0 },
      IDENTITY_CONVERT,
    );
    check("language_limitation: decision is REVIEW even with a strong score", langResult.decision, "REVIEW");
    check("language_limitation: score was actually high (ADD-worthy otherwise)", langResult.totalScore >= ADD_SCORE_THRESHOLD, true);

    const warrantyResult = await evaluateCandidate(
      { ...strongInput, riskFlags: [{ type: "warranty_warning" }] },
      { wetsuit: 0 },
      IDENTITY_CONVERT,
    );
    check("warranty_warning: decision is REVIEW even with a strong score", warrantyResult.decision, "REVIEW");
  }

  // ============================================================
  // Risk: region_lock / voltage_issue / variant_mismatch / discontinued -> SKIP
  // ============================================================
  {
    const strongInput = baseInput({
      matchConfidence: "verified",
      modelSkuHint: "MODEL-X",
      rakuten: { itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x" },
      coupang: { productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y" },
    });
    for (const riskType of ["region_lock", "voltage_issue", "variant_mismatch", "discontinued"] as const) {
      const result = await evaluateCandidate({ ...strongInput, riskFlags: [{ type: riskType }] }, { camera: 0 }, IDENTITY_CONVERT);
      check(`blocking risk ${riskType}: decision`, result.decision, "SKIP");
    }
  }

  // ============================================================
  // Mount gate (camera_lens only) - never inferred from text, only from
  // targetMount/rakutenMount/coupangMount supplied on the input.
  // ============================================================
  {
    // Strong enough (verified, modelSkuHint match, big price gap) to reach
    // ADD on score alone - every REVIEW/SKIP below must be the mount gate's
    // doing, not a coincidentally-low score.
    const strongLensInput = baseInput({
      productType: "camera_lens",
      matchConfidence: "verified",
      modelSkuHint: "SEL2470GM2",
      rakuten: { itemName: "Sony FE 24-70mm F2.8 GM II SEL2470GM2", itemPrice: 500_000, itemUrl: "https://x" },
      coupang: { productName: "소니 SEL2470GM2 FE 24-70mm F2.8 GM II", productPrice: 300_000, productUrl: "https://y" },
    });

    // 1. camera_lens + no targetMount at all -> REVIEW, ADD 불가
    const noTarget = await evaluateCandidate(strongLensInput, { camera_lens: 0 }, IDENTITY_CONVERT);
    check("mount gate: camera_lens, no targetMount -> REVIEW", noTarget.decision, "REVIEW");
    check("mount gate: camera_lens, no targetMount -> score was ADD-worthy otherwise", noTarget.totalScore >= ADD_SCORE_THRESHOLD, true);

    // 2. camera_lens + targetMount "unknown" -> REVIEW, ADD 불가
    const targetUnknown = await evaluateCandidate({ ...strongLensInput, targetMount: "unknown" }, { camera_lens: 0 }, IDENTITY_CONVERT);
    check("mount gate: targetMount unknown -> REVIEW", targetUnknown.decision, "REVIEW");

    // 3. target sony_e + R sony_e + C sony_e -> gate passes, reaches ADD
    const allMatch = await evaluateCandidate(
      { ...strongLensInput, targetMount: "sony_e", rakutenMount: "sony_e", coupangMount: "sony_e" },
      { camera_lens: 0 },
      IDENTITY_CONVERT,
    );
    check("mount gate: target/rakuten/coupang all sony_e -> ADD", allMatch.decision, "ADD");

    // 4. target sony_e + R sony_e + C nikon_z -> hard-gate SKIP via a derived
    // variant_mismatch flag, and FX/price scoring must never run (never
    // compare prices across different mounts).
    let convertCalls = 0;
    const COUNTING_CONVERT: ConvertToKrwFn = async (price) => {
      convertCalls++;
      return { krwPrice: price, fxRateUsed: 1, fxAsOf: null };
    };
    const mismatchInput = { ...strongLensInput, riskFlags: [], targetMount: "sony_e" as const, rakutenMount: "sony_e" as const, coupangMount: "nikon_z" as const };
    const mismatch = await evaluateCandidate(mismatchInput, { camera_lens: 0 }, COUNTING_CONVERT);
    check("mount gate: R sony_e / C nikon_z vs target sony_e -> SKIP", mismatch.decision, "SKIP");
    check("mount gate: mismatch derives a variant_mismatch risk flag in the result", mismatch.riskFlags.some((f) => f.type === "variant_mismatch"), true);
    check("mount gate: input.riskFlags itself was not mutated (still [])", mismatchInput.riskFlags, []);
    check("mount gate: mismatch never calls the FX converter", convertCalls, 0);
    check("mount gate: mismatch -> rakutenKrw/coupangKrw/priceScore untouched", { rakutenKrw: mismatch.rakutenKrw, coupangKrw: mismatch.coupangKrw, priceScore: mismatch.priceScore }, { rakutenKrw: null, coupangKrw: null, priceScore: 0 });

    // sanity control: the exact same COUNTING_CONVERT DOES get called (twice,
    // once per source) when mounts actually match - proves convertCalls===0
    // above is the gate working, not a broken counter.
    convertCalls = 0;
    await evaluateCandidate({ ...strongLensInput, targetMount: "sony_e", rakutenMount: "sony_e", coupangMount: "sony_e" }, { camera_lens: 0 }, COUNTING_CONVERT);
    check("mount gate: sanity control - matching mounts DO call the FX converter", convertCalls, 2);

    // 5. target sony_e + R unknown (C sony_e) -> REVIEW, ADD 불가
    const rakutenUnknown = await evaluateCandidate(
      { ...strongLensInput, targetMount: "sony_e", rakutenMount: "unknown", coupangMount: "sony_e" },
      { camera_lens: 0 },
      IDENTITY_CONVERT,
    );
    check("mount gate: rakutenMount unknown -> REVIEW", rakutenUnknown.decision, "REVIEW");

    // 6. target sony_e + C null/missing (R sony_e) -> REVIEW, ADD 불가
    const coupangMissing = await evaluateCandidate(
      { ...strongLensInput, targetMount: "sony_e", rakutenMount: "sony_e", coupangMount: null },
      { camera_lens: 0 },
      IDENTITY_CONVERT,
    );
    check("mount gate: coupangMount missing -> REVIEW", coupangMissing.decision, "REVIEW");

    // 7. non-camera_lens regression: identical inputs with/without the new
    // mount fields (all absent -> targetMount undefined) must produce byte-
    // identical results for every existing productType.
    const nonLensBase = baseInput({
      productType: "camera",
      matchConfidence: "verified",
      modelSkuHint: "MODEL-X",
      rakuten: { itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x" },
      coupang: { productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y" },
    });
    const withoutMountFields = await evaluateCandidate(nonLensBase, { camera: 0 }, IDENTITY_CONVERT);
    const withMountFieldsButNonLens = await evaluateCandidate(
      { ...nonLensBase, targetMount: "sony_e", rakutenMount: "nikon_z", coupangMount: "canon_rf" }, // deliberately all-mismatched
      { camera: 0 },
      IDENTITY_CONVERT,
    );
    check("mount gate: non-camera_lens is unaffected even with mismatched mount fields set", withMountFieldsButNonLens, withoutMountFields);
    check("mount gate: non-camera_lens control reaches ADD (proves the gate really is a no-op, not accidentally passing)", withoutMountFields.decision, "ADD");
  }

  // ============================================================
  // selectCandidates(): live coverage recompute across rounds
  // ============================================================
  {
    const w1: CandidateEvaluationResult = {
      productName: "W1",
      productType: "wetsuit",
      rakuten: null,
      coupang: null,
      rakutenKrw: null,
      coupangKrw: null,
      savingKrw: null,
      savingPercent: null,
      priceScore: 20,
      matchScore: 20,
      coverageScore: 0, // stale value - selectCandidates must recompute this, not trust it
      riskFlags: [],
      totalScore: 0, // stale value - selectCandidates must recompute this too
      decision: "ADD",
      reasons: [],
    };
    const w2: CandidateEvaluationResult = { ...w1, productName: "W2" };
    const c1: CandidateEvaluationResult = { ...w1, productName: "C1", productType: "camera" };

    const initialCountByType = { wetsuit: 0, camera: 3 };
    const { selected, remaining } = selectCandidates([w1, w2, c1], 3, initialCountByType);

    check("selectCandidates: picks all 3 when targetCount=3", selected.length, 3);
    check("selectCandidates: nothing left remaining", remaining.length, 0);
    check(
      "selectCandidates: order driven by live coverage (both wetsuit candidates before camera)",
      selected.map((r) => r.productName),
      ["W1", "W2", "C1"],
    );
    check("selectCandidates: round1 W1 coverageScore (gap 0 vs camera)", selected[0].coverageScore, 20);
    check("selectCandidates: round1 W1 totalScore", selected[0].totalScore, 60);
    check("selectCandidates: round2 W2 coverageScore (wetsuit count caught up to 1, min also 1 -> gap still 0)", selected[1].coverageScore, 20);
    check("selectCandidates: round3 C1 coverageScore (camera gap now 1 vs wetsuit=2)", selected[2].coverageScore, 15);
    check("selectCandidates: round3 C1 totalScore", selected[2].totalScore, 55);
    check("selectCandidates: does not mutate caller's initialCountByType", initialCountByType, { wetsuit: 0, camera: 3 });

    const { selected: selectedTwo } = selectCandidates([w1, w2, c1], 2, initialCountByType);
    check("selectCandidates: respects targetCount < pool size", selectedTwo.length, 2);
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
