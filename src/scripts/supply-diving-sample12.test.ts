/**
 * Offline regression tests for supply-diving-sample12.ts - no network, no
 * API key. Run directly:
 *   npx tsx src/scripts/supply-diving-sample12.test.ts
 */
import { classifyCandidate, pickBestCandidate } from "./supply-11st-sample10";
import { SELECTED_DIVING_ITEMS, MAX_LIVE_CALLS_DIVING, PRIOR_EVIDENCE, buildSearchKeyword, toKrResultEntry } from "./supply-diving-sample12";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}
function checkTrue(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

function itemByN(n: number) {
  const item = SELECTED_DIVING_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no SELECTED_DIVING_ITEMS entry for n=${n}`);
  return item;
}

function product(productName: string) {
  return { productName };
}

function main() {
  check("exactly 12 diving items", SELECTED_DIVING_ITEMS.length, MAX_LIVE_CALLS_DIVING);
  check("n values are the 12 diving n's from docs/supply-sample-products.json", SELECTED_DIVING_ITEMS.map((i) => i.n), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  check("PRIOR_EVIDENCE has exactly one entry per item", Object.keys(PRIOR_EVIDENCE).length, 12);

  // ============================================================
  // Three-way bucket split matches this review's own analysis
  // ============================================================
  const bucketOf = (n: number) => PRIOR_EVIDENCE[n].bucket;
  check("#16 Aqua Lung Leg3nd (ambiguous in prior review) -> 미확인", bucketOf(16), "미확인");
  check("#23 Fisheye dive light (missing_source, worst category match rate) -> 미확인", bucketOf(23), "미확인");
  check("#17 Oceanic Zeo/FDXi (wrong_category) -> 불일치 후보", bucketOf(17), "불일치 후보");
  check("#21 Molchanovs CP4 Fins (wrong_category) -> 불일치 후보", bucketOf(21), "불일치 후보");
  for (const n of [13, 14, 15, 18, 19, 20, 22, 24]) {
    check(`#${n} -> 동일 상품 후보`, bucketOf(n), "동일 상품 후보");
  }
  checkTrue("미확인/불일치 후보 items are marked NOT worth a live call", !PRIOR_EVIDENCE[16].liveCallWorthwhile && !PRIOR_EVIDENCE[17].liveCallWorthwhile && !PRIOR_EVIDENCE[21].liveCallWorthwhile && !PRIOR_EVIDENCE[23].liveCallWorthwhile);
  check("exactly 8 of 12 are worth a live call (the 동일 상품 후보 bucket)", SELECTED_DIVING_ITEMS.filter((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile).length, 8);

  // ============================================================
  // Category-specific identification axes actually work (reusing the
  // camera classifier unchanged - proves it's genuinely generic)
  // ============================================================
  {
    // #14 Garmin Mk3s vs Mk3i - same substring-collision risk as camera's X-H2/X-H2S
    const item = itemByN(14);
    const mk3s = classifyCandidate(item, product("가민 Garmin Descent Mk3s 다이빙 컴퓨터"));
    check("Garmin Mk3s matches its own model", mk3s.classification, "EXACT_CANDIDATE");
    const mk3i = classifyCandidate(item, product("가민 Garmin Descent Mk3i 티타늄 다이빙 컴퓨터"));
    checkTrue("Garmin Mk3i (titanium, different SKU) is excluded, not silently accepted as Mk3s", mk3i.matchedExcludeTerms.includes("Mk3i"));
  }
  {
    // #16 regulator - DIN vs 요크 connection hint detection
    const item = itemByN(16);
    const din = classifyCandidate(item, product("아쿠아렁 Leg3nd DIN 1단 레귤레이터"));
    checkTrue("regulator DIN connection detected", din.detectedOptionHints.some((h) => h === "connection:DIN"));
    checkTrue("regulator 1단(stage) config detected", din.detectedOptionHints.some((h) => h.startsWith("stage_config:")));
    const noConfigStated = classifyCandidate(item, product("아쿠아렁 Leg3nd 레귤레이터"));
    check("no connection/stage wording at all -> still EXACT (soft axis, no cap on its own)", noConfigStated.classification, "EXACT_CANDIDATE");
  }
  {
    // #24 wetsuit - size/gender soft axes never cap on their own
    const item = itemByN(24);
    const clean = classifyCandidate(item, product("마레스 Mares Reef 3mm 다이빙 슈트"));
    check("wetsuit with no size/gender wording -> still EXACT (soft axes)", clean.classification, "EXACT_CANDIDATE");
    const sized = classifyCandidate(item, product("마레스 Mares Reef 3mm 다이빙 슈트 여성용 사이즈M"));
    checkTrue("wetsuit gender hint detected when stated", sized.detectedOptionHints.some((h) => h.startsWith("gender:")));
    checkTrue("wetsuit size hint detected when stated", sized.detectedOptionHints.some((h) => h.startsWith("size:")));

    // The actual bug a bare "S"/"M"/"L" token would cause: a product name
    // that happens to contain the letter "S" for an unrelated reason
    // (here, the brand "Mares" itself contains "s") must NOT be read as a
    // size - this is why size tokens require the "사이즈" marker.
    check("brand name containing the bare letter 's' (Mare*s*) does not false-positive as a size hint", clean.detectedOptionHints.filter((h) => h.startsWith("size:")), []);
  }
  {
    // #23 dive light - generationVariants as a hard "exact model+gen" gate
    const item = itemByN(23);
    const withGen = classifyCandidate(item, product("피쉬아이 FIX NEO Premium 1000DX SWII 다이빙 라이트"));
    check("dive light WITH the SWII generation marker -> EXACT", withGen.classification, "EXACT_CANDIDATE");
    const noGen = classifyCandidate(item, product("피쉬아이 FIX NEO Premium 1000DX 다이빙 라이트"));
    check("dive light WITHOUT the SWII generation marker -> NEEDS_REVIEW (세대 불명확)", noGen.classification, "NEEDS_REVIEW");
  }
  {
    // Accessory co-occurrence works for diving-specific nouns too (호스/인플레이터)
    const item = itemByN(16); // regulator
    const hose = classifyCandidate(item, product("아쿠아렁 Leg3nd 호환 교체용 호스"));
    check("regulator 호환+교체용+호스(hose) accessory listing -> REJECTED_ACCESSORY", hose.classification, "REJECTED_ACCESSORY");
  }

  // ============================================================
  // Size-token boundary regression (requirement 2): S/SS, XS/S, XL/L,
  // XXL/XL, in BOTH marker orders ("사이즈X" and "X사이즈").
  // ============================================================
  {
    const item = itemByN(18); // bcd, STANDARD size patterns (no "SS" tier - that's fins-only, see item #20 below)

    // "XS사이즈" must NOT match "S사이즈" (suffix collision)
    const xs = classifyCandidate(item, product("지글 Zeagle Ranger XS사이즈 BCD"));
    checkTrue("XS사이즈 detected as XS", xs.detectedOptionHints.includes("size:XS사이즈"));
    checkTrue("XS사이즈 does NOT ALSO report a bare S사이즈 hit (suffix collision closed)", !xs.detectedOptionHints.includes("size:S사이즈"));

    // "XL사이즈" must NOT match "L사이즈" (suffix collision)
    const xl = classifyCandidate(item, product("지글 Zeagle Ranger XL사이즈 BCD"));
    checkTrue("XL사이즈 detected as XL", xl.detectedOptionHints.includes("size:XL사이즈"));
    checkTrue("XL사이즈 does NOT ALSO report a bare L사이즈 hit (suffix collision closed)", !xl.detectedOptionHints.includes("size:L사이즈"));

    // "XXL사이즈" must NOT match "XL사이즈" (suffix collision, transitively also not L사이즈)
    const xxl = classifyCandidate(item, product("지글 Zeagle Ranger XXL사이즈 BCD"));
    checkTrue("XXL사이즈 detected as XXL", xxl.detectedOptionHints.includes("size:XXL사이즈"));
    checkTrue("XXL사이즈 does NOT ALSO report XL사이즈 (suffix collision closed)", !xxl.detectedOptionHints.includes("size:XL사이즈"));

    // Genuinely distinct, correctly-isolated sizes must still each detect on their own
    const plainS = classifyCandidate(item, product("지글 Zeagle Ranger 사이즈S BCD"));
    checkTrue("사이즈S alone (no SS) detects cleanly", plainS.detectedOptionHints.includes("size:사이즈S"));
    const plainL = classifyCandidate(item, product("지글 Zeagle Ranger L사이즈 BCD"));
    checkTrue("L사이즈 alone (no XL) detects cleanly", plainL.detectedOptionHints.includes("size:L사이즈"));
  }
  {
    // Same boundary pairs again on the FIN size pattern set (S/SS/XL),
    // a different letters array than BCD/wetsuit's - not just testing
    // the same generated array twice.
    const item = itemByN(20); // fins
    const ss = classifyCandidate(item, product("투사 TUSA Solla 사이즈SS 핀"));
    checkTrue("fins 사이즈SS detected as SS", ss.detectedOptionHints.includes("size:사이즈SS"));
    checkTrue("fins 사이즈SS does not also report 사이즈S", !ss.detectedOptionHints.includes("size:사이즈S"));
    const xl = classifyCandidate(item, product("투사 TUSA Solla XL사이즈 핀"));
    checkTrue("fins XL사이즈 does not also report L사이즈", !xl.detectedOptionHints.includes("size:L사이즈"));
  }

  // ============================================================
  // #20 regional_spec axis - requirement 4: SF-22 vs SF0115 stays
  // detection-only, never asserted as same or different by this file.
  // ============================================================
  {
    const item = itemByN(20);
    const sf22 = classifyCandidate(item, product("투사 TUSA Solla SF-22 오픈힐 핀"));
    checkTrue("SF-22 regional_spec hint detected", sf22.detectedOptionHints.some((h) => h.startsWith("regional_spec:")));
    const noSpec = classifyCandidate(item, product("투사 TUSA Solla 오픈힐 핀"));
    check("no regional spec code stated at all -> EXACT still reachable (soft axis, no cap)", noSpec.classification, "EXACT_CANDIDATE");
    check("no regional spec code stated -> no regional_spec hint", noSpec.detectedOptionHints.filter((h) => h.startsWith("regional_spec:")), []);
  }

  // ============================================================
  // buildSearchKeyword - requirement 5 (keyword accuracy/normalization)
  // ============================================================
  check(
    "strips a trailing parenthetical descriptor entirely",
    buildSearchKeyword("Shearwater Peregrine (Original/Standard, Black)").keyword,
    "Shearwater Peregrine",
  );
  check(
    "strips a different parenthetical (Garmin case)",
    buildSearchKeyword("Garmin Descent Mk3s (Steel/Fog Gray, 43mm)").keyword,
    "Garmin Descent Mk3s",
  );
  check("strips a category-descriptor parenthetical (TUSA Solla)", buildSearchKeyword("TUSA Solla (Open Heel Diving Fins)").keyword, "TUSA Solla");
  {
    const result = buildSearchKeyword("Oceanic Zeo/FDXi");
    check("a '/' alternate-name title keeps only the first alternative", result.keyword, "Oceanic Zeo");
    check("the dropped alternative is surfaced, not silently discarded", result.droppedAlternative, "FDXi");
  }
  {
    const result = buildSearchKeyword("Aqua Lung i450T");
    check("a title with no parens/slash is left untouched", result.keyword, "Aqua Lung i450T");
    checkTrue("wasSimplified is false when nothing changed", !result.wasSimplified);
  }

  // ============================================================
  // toKrResultEntry - requirement 1: preserve up to 5 candidates, keep
  // `best`-mirroring top-level fields for backward compatibility, and
  // distinguish call_failed / no_results / all_candidates_rejected / ok.
  // ============================================================
  {
    const item = itemByN(14); // Garmin Mk3s
    const products = [
      { productName: "가민 Garmin Descent Mk3s 다이빙 컴퓨터", productCode: "A1", seller: "11번가 셀러1", productPrice: "950000" },
      { productName: "가민 Garmin Descent Mk3i 티타늄", productCode: "A2", seller: "셀러2", productPrice: "1200000" }, // excluded (Mk3i)
    ];
    const classified = products.map((p) => classifyCandidate(item, p));
    const entry = toKrResultEntry(item, { status: "ok", totalCount: 42, classified });

    check("callStatus is 'ok' when a best candidate exists", entry.callStatus, "ok");
    check("candidates array preserves ALL returned candidates (2 here), not just best", (entry.candidates as unknown[]).length, 2);
    checkTrue(
      "the EXCLUDED candidate (Mk3i) is still IN candidates, with its own classification visible",
      (entry.candidates as any[]).some((c) => c.productName.includes("Mk3i") && c.classification !== "EXACT_CANDIDATE"),
    );
    check("top-level productName mirrors the best candidate (backward compat)", entry.productName, "가민 Garmin Descent Mk3s 다이빙 컴퓨터");
    check("top-level priceKrw mirrors the best candidate, parsed as a number", entry.priceKrw, 950000);
    checkTrue("humanVerified always starts false", entry.humanVerified === false);
  }
  {
    // no_results: API succeeded, zero candidates returned
    const item = itemByN(15);
    const entry = toKrResultEntry(item, { status: "ok", totalCount: 0, classified: [] });
    check("callStatus is 'no_results' for an empty but successful response", entry.callStatus, "no_results");
    check("candidates is an empty array, not omitted", entry.candidates, []);
    check("productName is undefined, not a placeholder", entry.productName, undefined);
  }
  {
    // all_candidates_rejected: candidates came back, but none were EXACT/REVIEW
    const item = itemByN(14);
    const products = [{ productName: "완전히 다른 상품 - 모델명 없음", productCode: "X", seller: "s" }];
    const classified = products.map((p) => classifyCandidate(item, p));
    checkTrue("sanity: this fixture candidate really is MISMATCH (no base model match)", pickBestCandidate(classified) === undefined);
    const entry = toKrResultEntry(item, { status: "ok", totalCount: 1, classified });
    check("callStatus is 'all_candidates_rejected' (results existed, none usable) - distinct from no_results/call_failed", entry.callStatus, "all_candidates_rejected");
    check("the rejected candidate is still preserved for inspection", (entry.candidates as unknown[]).length, 1);
  }
  {
    // call_failed: API error - distinct from the above two
    const item = itemByN(13);
    const entry = toKrResultEntry(item, { status: "call_failed", errorMessage: "HTTP 500 server error" });
    check("callStatus is 'call_failed'", entry.callStatus, "call_failed");
    check("errorMessage is preserved", entry.errorMessage, "HTTP 500 server error");
    check("candidates is empty (never fabricated) on a call failure", entry.candidates, []);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
