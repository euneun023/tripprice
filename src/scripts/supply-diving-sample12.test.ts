/**
 * Offline regression tests for supply-diving-sample12.ts - no network, no
 * API key. Run directly:
 *   npx tsx src/scripts/supply-diving-sample12.test.ts
 */
import { classifyCandidate } from "./supply-11st-sample10";
import { SELECTED_DIVING_ITEMS, MAX_LIVE_CALLS_DIVING, PRIOR_EVIDENCE } from "./supply-diving-sample12";

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

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
