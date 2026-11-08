/**
 * Offline regression tests for supply-rakuten-sample10.ts - no network, no
 * applicationId/accessKey. Run directly:
 *   npx tsx src/scripts/supply-rakuten-sample10.test.ts
 */
import { JP_ITEMS } from "./supply-rakuten-sample10";
import { SELECTED_ITEMS, MAX_LIVE_CALLS, classifyCandidate } from "./supply-11st-sample10";
import { buildRakutenFallbackKeyword } from "../adapters/rakuten";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function main() {
  check("JP_ITEMS has one entry per SELECTED_ITEMS (10)", JP_ITEMS.length, MAX_LIVE_CALLS);
  check("JP_ITEMS n's match SELECTED_ITEMS n's, same order", JP_ITEMS.map((i) => i.n), SELECTED_ITEMS.map((i) => i.n));
  check(
    "baseModelRequiredTerms/generationVariants carried over unchanged from the KR config",
    JP_ITEMS.map((i) => i.baseModelRequiredTerms),
    SELECTED_ITEMS.map((i) => i.baseModelRequiredTerms),
  );

  // brand/exclude terms must actually have been overridden to Japanese, not
  // left as the Korean/English KR config (the whole point of JP_ITEMS).
  for (const jp of JP_ITEMS) {
    const kr = SELECTED_ITEMS.find((k) => k.n === jp.n)!;
    check(`#${jp.n} brandTerms differ from the KR config (JP-specific)`, JSON.stringify(jp.brandTerms) !== JSON.stringify(kr.brandTerms), true);
    check(`#${jp.n} excludeTerms differ from the KR config (JP-specific)`, JSON.stringify(jp.excludeTerms) !== JSON.stringify(kr.excludeTerms), true);
  }

  // classifyCandidate reuse: a Japanese-brand item name must classify
  // correctly through the JP config, same function as the KR side.
  {
    const sony = JP_ITEMS.find((i) => i.n === 4)!; // Sony FE 24mm F1.4 GM
    const jpMatch = classifyCandidate(sony, { productName: "ソニー SEL24F14GM FE 24mm F1.4 GM 単焦点レンズ" });
    check("JP item name with 'ソニー' (not 'Sony'/'소니') still classifies EXACT via JP brandTerms", jpMatch.classification, "EXACT_CANDIDATE");

    const used = classifyCandidate(sony, { productName: "ソニー FE 24mm F1.4 GM 中古美品" });
    check("JP '中古'(used) listing -> NEEDS_REVIEW, not silently EXACT", used.classification, "NEEDS_REVIEW");
  }

  // OnePlus Buds Pro 3's keyword is the one title in this sample with a
  // standalone-digit token Rakuten is documented to 400 on - confirm the
  // existing fallback helper actually produces a mergeable alternative, so
  // the live run's retry path has something to retry with.
  {
    const item = JP_ITEMS.find((i) => i.n === 7)!;
    const fallback = buildRakutenFallbackKeyword(item.title);
    check("OnePlus Buds Pro 3 -> fallback keyword exists (standalone '3')", fallback, "OnePlus Buds Pro3");
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
