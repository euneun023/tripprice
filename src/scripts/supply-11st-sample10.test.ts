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
import { SELECTED_ITEMS, MAX_LIVE_CALLS, classifyCandidate, pickBestCandidate, type SelectedItem } from "./supply-11st-sample10";
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
  // earbuds themselves - must NOT classify EXACT ----
  {
    const item = itemByN(7);
    const eartip = classifyCandidate(item, product("OnePlus Buds Pro 3 교체용 폼 이어팁 (실리콘)"));
    check("replacement eartip listing for Buds Pro 3 -> NEEDS_REVIEW, not EXACT", eartip.classification, "NEEDS_REVIEW");
    checkTrue("이어팁 term captured in matchedExcludeTerms", eartip.matchedExcludeTerms.includes("이어팁"));

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

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
