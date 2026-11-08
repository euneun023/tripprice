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
  {
    const item = itemByN(12); // Fitbit Sense 2
    const review = classifyCandidate(item, product("핏빗 Sense 2 중고"));
    const exact = classifyCandidate(item, product("핏빗 Sense 2 정품"));
    const best = pickBestCandidate([review, exact]);
    check("EXACT_CANDIDATE picked even when NEEDS_REVIEW came first in the array", best?.classification, "EXACT_CANDIDATE");
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
