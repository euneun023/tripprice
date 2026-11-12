/**
 * Offline regression tests for supply-11st-sample10.ts's classifier - no
 * network, no API key. Run directly:
 *   npx tsx src/scripts/supply-11st-sample10.test.ts
 * Exits non-zero on any failure.
 *
 * Fixture product names below are hand-written to match the real,
 * confirmed 11st response shape (ProductName/ProductCode/etc. - see
 * src/adapters/elevenst.test.ts) and to exercise the exact collision
 * risks called out in each SelectedItem's comment in the source file
 * (X-H2 vs X-H2S, Mark II variants, bundle/used exclusion).
 */
import {
  SELECTED_ITEMS,
  MAX_LIVE_CALLS,
  classifyCandidate,
  pickBestCandidate,
  toKrResultEntry,
  type SelectedItem,
  type RunLiveResult,
} from "./supply-11st-sample10";
import type { ElevenstProduct } from "../adapters/elevenst";

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

function product(productName: string, extra: Partial<ElevenstProduct> = {}): ElevenstProduct {
  return { productName, ...extra };
}

function itemByN(n: number): SelectedItem {
  const item = SELECTED_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no SELECTED_ITEMS entry for n=${n}`);
  return item;
}

function main() {
  check("exactly 10 selected items, matching MAX_LIVE_CALLS", SELECTED_ITEMS.length, MAX_LIVE_CALLS);
  check("all 6 camera/camera_lens entries prioritized (n 1-6)", SELECTED_ITEMS.slice(0, 6).map((i) => i.n), [1, 2, 3, 4, 5, 6]);

  // ---- FUJIFILM X-H2 vs X-H2S collision (item n=2) ----
  {
    const item = itemByN(2);
    const same = classifyCandidate(item, product("후지필름 X-H2 미러리스 카메라 바디"));
    check("X-H2 real match -> EXACT_CANDIDATE", same.classification, "EXACT_CANDIDATE");

    const wrongGen = classifyCandidate(item, product("후지필름 X-H2S 미러리스 카메라 바디"));
    check("X-H2S must NOT be accepted as X-H2 (substring collision guard)", wrongGen.classification, "NEEDS_REVIEW");
  }

  // ---- Canon EOS R6 Mark II generation variants (item n=3) ----
  {
    const item = itemByN(3);
    const english = classifyCandidate(item, product("캐논 EOS R6 Mark II 바디"));
    check("Canon R6 'Mark II' (English) -> EXACT_CANDIDATE", english.classification, "EXACT_CANDIDATE");

    const korean = classifyCandidate(item, product("캐논 EOS R6 마크2 바디"));
    check("Canon R6 '마크2' (Korean generation variant) -> EXACT_CANDIDATE", korean.classification, "EXACT_CANDIDATE");

    const noGen = classifyCandidate(item, product("캐논 EOS R6 바디"));
    check("Canon R6 with NO generation marker at all -> NEEDS_REVIEW (could be gen 1)", noGen.classification, "NEEDS_REVIEW");

    const kit = classifyCandidate(item, product("캐논 EOS R6 Mark II 24-105 렌즈 키트"));
    check("Canon R6 Mark II as a lens KIT -> NEEDS_REVIEW (구성 다름, not silently EXACT)", kit.classification, "NEEDS_REVIEW");
  }

  // ---- Sony FE 24mm F1.4 GM - the already-confirmed live case (n=4) ----
  {
    const item = itemByN(4);
    const match = classifyCandidate(item, product("소니 FE 24mm F1.4 GM SEL24F14GM 정품"));
    check("Sony FE 24mm F1.4 GM, Korean brand name -> EXACT_CANDIDATE", match.classification, "EXACT_CANDIDATE");

    const wrongBrand = classifyCandidate(item, product("시그마 24mm F1.4 GM 호환 렌즈"));
    check(
      "same spec but a different (non-Sony) brand word, no Sony/소니 anywhere -> NEEDS_REVIEW",
      wrongBrand.classification,
      "NEEDS_REVIEW",
    );
  }

  // ---- used/bundle exclude flagging (generic, item n=1) ----
  {
    const item = itemByN(1);
    const used = classifyCandidate(item, product("후지필름 X-T50 중고 A급"));
    check("중고(used) listing -> NEEDS_REVIEW, not silently EXACT", used.classification, "NEEDS_REVIEW");
    check("중고 term captured in matchedExcludeTerms", used.matchedExcludeTerms.includes("중고"), true);
  }

  // ---- no products at all -> MISMATCH via pickBestCandidate ----
  {
    const best = pickBestCandidate([]);
    check("no candidates at all -> pickBestCandidate returns undefined (reported as MISMATCH)", best, undefined);
  }

  // ---- pickBestCandidate prefers EXACT over NEEDS_REVIEW regardless of order ----
  // (n=4, Sony FE 24mm F1.4 GM - no hardOptionGroups, unlike n=12/Fitbit
  // Sense 2 below, so EXACT_CANDIDATE is actually reachable here)
  {
    const item = itemByN(4);
    const review = classifyCandidate(item, product("소니 FE 24mm F1.4 GM 중고"));
    const exact = classifyCandidate(item, product("소니 FE 24mm F1.4 GM 정품"));
    const best = pickBestCandidate([review, exact]);
    check("EXACT_CANDIDATE picked even when NEEDS_REVIEW came first in the array", best?.classification, "EXACT_CANDIDATE");
  }

  // ============================================================
  // Regression tests for the real false positives this review found
  // ============================================================

  // ---- #7 OnePlus Buds Pro 3: a replacement eartip listing, not the
  // earbuds themselves - must NOT classify EXACT. (Superseded the exact
  // eartip phrasing is now REJECTED_ACCESSORY, not NEEDS_REVIEW - see the
  // dedicated "REJECTED_ACCESSORY" section further below for that and the
  // explicit anti-false-positive check; kept here only for the plain
  // "no accessory wording -> still EXACT" baseline.) ----
  {
    const item = itemByN(7);
    const real = classifyCandidate(item, product("원플러스 OnePlus Buds Pro 3 무선이어폰 정품"));
    check("the actual earbuds (no accessory wording) still classify EXACT", real.classification, "EXACT_CANDIDATE");
  }

  // ---- #5 Tamron 12-20mm F2.8: mount is a hard-required, unresolved
  // axis - must cap at NEEDS_REVIEW even with a clean name match ----
  {
    const item = itemByN(5);
    const nikonZ = classifyCandidate(item, product("탐론 12-20mm F2.8 Di III-A RXD Z마운트 (A084Z)"));
    check("Tamron 12-20mm F2.8, mount stated (Nikon Z) -> still NEEDS_REVIEW (unresolved vs KR side)", nikonZ.classification, "NEEDS_REVIEW");
    checkTrue("mount hint detected and reported", nikonZ.detectedOptionHints.some((h) => h.startsWith("mount:")));

    const noMountStated = classifyCandidate(item, product("탐론 12-20mm F2.8 Di III-A RXD"));
    check("Tamron 12-20mm F2.8, no mount stated at all -> also NEEDS_REVIEW (never silently EXACT)", noMountStated.classification, "NEEDS_REVIEW");
    check("no mount hint detected when none is stated", noMountStated.detectedOptionHints, []);
  }

  // ---- #1 FUJIFILM X-T50: color is a hard-required, unresolved axis ----
  {
    const item = itemByN(1);
    const silver = classifyCandidate(item, product("후지필름 X-T50 실버 미러리스 카메라"));
    check("X-T50 with color stated (실버) -> still NEEDS_REVIEW (color not cross-checked)", silver.classification, "NEEDS_REVIEW");
    check("color hint detected and reported", silver.detectedOptionHints, ["color:실버"]);
  }

  // ---- #4 Sony FE 24mm F1.4 GM: delivery/stock-uncertain wording is
  // reported separately and does NOT downgrade classification ----
  {
    const item = itemByN(4);
    const backorder = classifyCandidate(item, product("소니 FE 24mm F1.4 GM 정품 (입고대기)"));
    check("delivery-uncertain wording does not change identity classification", backorder.classification, "EXACT_CANDIDATE");
    checkTrue("but IS surfaced separately for the purchasability caveat", backorder.matchedDeliveryUncertaintyTerms.includes("입고대기"));

    const clean = classifyCandidate(item, product("소니 FE 24mm F1.4 GM 정품"));
    check("no delivery-uncertain wording -> empty list (never inferred as 'confirmed in stock')", clean.matchedDeliveryUncertaintyTerms, []);
  }

  // ============================================================
  // REJECTED_ACCESSORY: a clear accessory-only phrase rejects the
  // candidate outright, but a MERE word appearance (the real product
  // bundling/mentioning that same word) must NOT be wrongly excluded -
  // this is the explicit anti-false-positive guarantee asked for.
  // ============================================================
  {
    const item = itemByN(7); // OnePlus Buds Pro 3

    const accessory = classifyCandidate(item, product("OnePlus Buds Pro 3 교체용 폼 이어팁 (실리콘, 3쌍)"));
    check("standalone replacement-eartip phrase -> REJECTED_ACCESSORY", accessory.classification, "REJECTED_ACCESSORY");
    check(
      "rejectedAccessoryPhrase reports the modifier+noun pair even though '폼' sits between them in the real wording",
      accessory.rejectedAccessoryPhrase,
      "교체용+이어팁",
    );

    // The exact anti-false-positive case: the REAL earbuds, whose listing
    // merely DISCLOSES that spare eartips are bundled in. Contains the
    // same bare word "이어팁" as the accessory listing above, but not the
    // "교체용이어팁"/"이어팁교체용"/etc. CONTIGUOUS phrase - must not be
    // rejected just because the word "이어팁" appears somewhere.
    const bundleNote = classifyCandidate(item, product("원플러스 OnePlus Buds Pro 3 무선이어폰 정품 (이어팁 3종 포함)"));
    checkTrue("bundle disclosure (이어팁 3종 포함) is NOT classified REJECTED_ACCESSORY", bundleNote.classification !== "REJECTED_ACCESSORY");
    check("the real earbuds (bundle note, not a standalone-accessory phrase) still classifies EXACT", bundleNote.classification, "EXACT_CANDIDATE");

    // Same check for a different item/phrase pair (lens hood/filter),
    // confirming this isn't a one-off coincidence of this specific item.
    const lensItem = itemByN(4); // Sony FE 24mm F1.4 GM
    const filterOnly = classifyCandidate(lensItem, product("소니 FE 24mm F1.4 GM 호환 렌즈필터 단품 판매"));
    check("a filter-only listing for this lens -> REJECTED_ACCESSORY", filterOnly.classification, "REJECTED_ACCESSORY");
    const lensWithFreeFilter = classifyCandidate(lensItem, product("소니 FE 24mm F1.4 GM 정품 (사은품 필터 증정)"));
    checkTrue("the real lens with a free-gift filter note is NOT REJECTED_ACCESSORY", lensWithFreeFilter.classification !== "REJECTED_ACCESSORY");
  }

  // ============================================================
  // toKrResultEntry() - the shape saved by runLive(), consumed by
  // compare-kr-jp-sample10.ts's KrResultEntry. Never includes the API
  // key or a raw HTTP response - only the fields listed in its own
  // return statement.
  // ============================================================
  {
    const item = itemByN(4); // Sony FE 24mm F1.4 GM
    const best = classifyCandidate(item, product("소니 FE 24mm F1.4 GM 정품", { productCode: "C001", seller: "11번가 공식스토어", productPrice: "2390000", salePrice: "2190000", detailPageUrl: "https://11st.co.kr/x" }));
    const result: RunLiveResult = { item, totalCount: 42, candidatesReturned: 1, best, classified: [best] };
    const entry = toKrResultEntry(result);

    check("n carried over", entry.n, 4);
    check("productName carried over", entry.productName, "소니 FE 24mm F1.4 GM 정품");
    check("productCode carried over", entry.productCode, "C001");
    check("priceKrw parsed as a number from productPrice", entry.priceKrw, 2390000);
    check("salePriceKrw parsed as a number from salePrice", entry.salePriceKrw, 2190000);
    check("classification carried over", entry.classification, "EXACT_CANDIDATE");
    check("humanVerified always starts false (never assumed true on save)", entry.humanVerified, false);
    checkTrue("no apiKey field anywhere in the saved entry", !("apiKey" in entry));
    checkTrue("no raw response field anywhere in the saved entry", !("rawResponseTextRedacted" in entry) && !("totalCount" in entry));
  }
  {
    // Full MISMATCH (no best, no classified candidates at all) must still
    // produce a valid, schema-shaped entry - never throw, never omit `n`.
    const item = itemByN(4);
    const result: RunLiveResult = { item, totalCount: 0, candidatesReturned: 0 };
    const entry = toKrResultEntry(result);
    check("n still present with zero candidates", entry.n, 4);
    check("classification defaults to MISMATCH with no candidates at all", entry.classification, "MISMATCH");
    check("productName is undefined, not a placeholder string", entry.productName, undefined);
  }

  // ============================================================
  // Config (body-only vs lens-kit) + mount-FE regression - real reported
  // false positive: #2 X-H2 KR="렌즈킷" vs JP="바디 단품" both classified
  // EXACT individually; #5 Tamron KR="Sony FE" mount wasn't recognized.
  // ============================================================
  {
    const item2 = itemByN(2); // FUJIFILM X-H2
    const kit = classifyCandidate(item2, product("후지필름 X-H2 + XF 16-80mm 렌즈킷"));
    check("#2 KR lens-kit wording ('렌즈킷') now downgrades its own classification (exclude-term gap fix)", kit.classification, "NEEDS_REVIEW");
    checkTrue("#2 KR lens-kit wording is captured in matchedExcludeTerms", kit.matchedExcludeTerms.includes("렌즈킷"));
    checkTrue("#2 KR candidate also reports a config:키트-family hint for cross-compare", kit.detectedOptionHints.some((h) => h.startsWith("config:")));

    const bodyOnly = classifyCandidate(item2, product("후지필름 X-H2 바디 단품"));
    check("#2 KR body-only wording alone -> still EXACT individually (soft axis doesn't cap on its own)", bodyOnly.classification, "EXACT_CANDIDATE");
    checkTrue("#2 KR body-only wording reports a config hint too", bodyOnly.detectedOptionHints.some((h) => h.startsWith("config:")));

    const plain = classifyCandidate(item2, product("후지필름 X-H2 미러리스 카메라"));
    check("#2 with NO kit/body wording at all -> EXACT, soft config axis never caps merely by existing", plain.classification, "EXACT_CANDIDATE");
    check("#2 with no kit/body wording -> no config hint detected", plain.detectedOptionHints, []);
  }
  {
    const item5 = itemByN(5); // Tamron 12-20mm F2.8
    const fe = classifyCandidate(item5, product("탐론 12-20mm F2.8 Di III-A RXD Sony FE용"));
    checkTrue("#5 'Sony FE' mount wording is now detected (previously only 'E마운트'/'Sony E' were)", fe.detectedOptionHints.includes("mount:Sony FE") || fe.detectedOptionHints.some((h) => h.toLowerCase().includes("fe")));
  }

  // ============================================================
  // Requirement 5 safety check: #3 Canon, #4 Sony 24mm, #6 Sony 70-200mm
  // must NOT be newly downgraded by this review's fixes when their real
  // text has no kit/body/mount conflict wording at all.
  // ============================================================
  {
    const item3 = itemByN(3);
    const canon = classifyCandidate(item3, product("캐논 EOS R6 Mark II 바디"));
    check("#3 Canon (바디, no kit wording) still classifies EXACT - config axis did not regress it", canon.classification, "EXACT_CANDIDATE");

    const item4 = itemByN(4);
    const sony24 = classifyCandidate(item4, product("소니 FE 24mm F1.4 GM SEL24F14GM 정품"));
    check("#4 Sony FE 24mm F1.4 GM still classifies EXACT - untouched by this review's fixes", sony24.classification, "EXACT_CANDIDATE");

    const item6 = itemByN(6);
    const sony70200 = classifyCandidate(item6, product("소니 FE 70-200mm F2.8 GM OSS II"));
    check("#6 Sony FE 70-200mm F2.8 GM OSS II still classifies EXACT - untouched by this review's fixes", sony70200.classification, "EXACT_CANDIDATE");
  }

  // ============================================================
  // #12 Fitbit accessory-noun broadening - the real reported case: a
  // "Wongeto 호환" listing whose own body/unit status was in doubt,
  // using an accessory noun (충전케이블) that wasn't covered before.
  // ============================================================
  {
    const item12 = itemByN(12);
    const accessory = classifyCandidate(item12, product("Wongeto Fitbit Sense 2 호환 충전케이블"));
    check("#12 'Wongeto ... 호환 충전케이블' -> REJECTED_ACCESSORY (충전케이블 newly added to ACCESSORY_NOUN_TERMS)", accessory.classification, "REJECTED_ACCESSORY");

    const real = classifyCandidate(item12, product("핏빗 Fitbit Sense 2 정품 블랙"));
    check("the real Fitbit Sense 2 watch (no accessory wording) is unaffected by the broadened noun list", real.classification, "NEEDS_REVIEW"); // color axis still caps it
    checkTrue("the real watch is NOT rejected as an accessory", real.classification !== "REJECTED_ACCESSORY");
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
