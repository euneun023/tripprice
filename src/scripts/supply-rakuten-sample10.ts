/**
 * JP-side counterpart to supply-11st-sample10.ts: same 10 selected items
 * (imported, not re-picked), checked against Rakuten Ichiba Item Search -
 * the existing, already-production adapter (src/adapters/rakuten.ts, used
 * by src/cli/index.ts search-rakuten and the live refresh job) - this file
 * adds NO new Rakuten integration, only a KR/JP-comparable offline plan +
 * classifier for this specific 10-item set.
 *
 * Two modes, same contract as supply-11st-sample10.ts:
 *
 *   npx tsx src/scripts/supply-rakuten-sample10.ts offline   (default)
 *     No network call, no applicationId/accessKey read. Prints the planned
 *     keyword per item (plus whether Rakuten's standalone-token 400
 *     workaround - buildRakutenFallbackKeyword - would even trigger) and
 *     the JP classifier config, for review before any live call.
 *
 *   npx tsx src/scripts/supply-rakuten-sample10.ts live
 *     Requires `live` AND applicationId+accessKey in the environment (the
 *     exact two names src/cli/index.ts already reads - see .env.example).
 *     Exactly 10 calls (MAX_LIVE_CALLS), hits=5, >=1.1s apart (Rakuten's
 *     app is registered at 1 QPS per adapters/rakuten.ts's own comment).
 *     Never reads/prints applicationId/accessKey themselves.
 *
 * Classification reuses classifyCandidate() from supply-11st-sample10.ts
 * unchanged (it only reads `.productName`) - only the brand/exclude word
 * lists differ here, because they have to be Japanese, not Korean/English
 * (Rakuten listings are in Japanese: "ソニー" not "Sony"/"소니", "中古" not
 * "중고", etc.) - see buildJpItem()'s comment.
 */
import "dotenv/config";
import {
  SELECTED_ITEMS,
  MAX_LIVE_CALLS,
  classifyCandidate,
  pickBestCandidate,
  type SelectedItem,
} from "./supply-11st-sample10";
import { searchRakutenItem, buildRakutenFallbackKeyword, RakutenApiError, type RakutenItem } from "../adapters/rakuten";

/** Japanese brand/exclude word lists per item (n). baseModelRequiredTerms
 * and generationVariants are reused as-is from SELECTED_ITEMS - model/spec
 * codes (XH2, 70200mm, F28, GM, MarkII...) are written the same way on
 * Japanese retail sites as Korean ones, only the brand word and
 * condition/bundle words need a JP-specific list. */
const JP_OVERRIDES: Record<number, { brandTerms: string[]; excludeTerms: string[] }> = {
  1: { brandTerms: ["FUJIFILM", "フジフイルム", "富士フイルム"], excludeTerms: ["中古", "訳あり", "セット", "キット", "展示品", "レンタル"] },
  2: { brandTerms: ["FUJIFILM", "フジフイルム", "富士フイルム"], excludeTerms: ["中古", "訳あり", "セット", "キット", "展示品", "レンタル"] },
  3: { brandTerms: ["Canon", "キヤノン", "キャノン"], excludeTerms: ["中古", "訳あり", "セット", "キット", "展示品", "レンタル"] },
  4: { brandTerms: ["Sony", "ソニー"], excludeTerms: ["中古", "訳あり", "セット", "フィルター", "フード"] },
  5: { brandTerms: ["Tamron", "タムロン"], excludeTerms: ["中古", "訳あり", "セット", "フィルター", "フード"] },
  6: { brandTerms: ["Sony", "ソニー"], excludeTerms: ["中古", "訳あり", "セット", "フィルター", "フード"] },
  7: { brandTerms: ["OnePlus", "ワンプラス"], excludeTerms: ["中古", "訳あり", "ケース", "カバー"] },
  9: { brandTerms: ["Bowers", "B&W", "バウアース"], excludeTerms: ["中古", "訳あり", "ケース", "カバー"] },
  12: { brandTerms: ["Fitbit", "フィットビット"], excludeTerms: ["中古", "訳あり", "ケース", "バンド"] },
  25: { brandTerms: ["SK-II", "SK2", "エスケーツー", "ピテラ"], excludeTerms: ["訳あり", "セット", "企画品", "詰め替え"] },
};

function buildJpItem(kr: SelectedItem): SelectedItem {
  const jp = JP_OVERRIDES[kr.n];
  if (!jp) throw new Error(`no JP_OVERRIDES entry for n=${kr.n} - every SELECTED_ITEMS entry must have one`);
  return { ...kr, brandTerms: jp.brandTerms, excludeTerms: jp.excludeTerms };
}

export const JP_ITEMS: SelectedItem[] = SELECTED_ITEMS.map(buildJpItem);

if (JP_ITEMS.length !== MAX_LIVE_CALLS) {
  throw new Error(`JP_ITEMS has ${JP_ITEMS.length} entries, expected ${MAX_LIVE_CALLS} (one per SELECTED_ITEMS entry)`);
}

function printOfflinePlan() {
  console.log("=== Rakuten Ichiba Item Search - JP-side plan for the SAME 10 items (no network call) ===\n");
  console.log(
    "Integration status: already production - src/adapters/rakuten.ts (searchRakutenItem), " +
      "used live by src/cli/index.ts search-rakuten and the running refresh job. No new Rakuten code needed here.\n",
  );
  for (const item of JP_ITEMS) {
    const fallback = buildRakutenFallbackKeyword(item.title);
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(`  Rakuten keyword (planned): "${item.title}"`);
    console.log(
      fallback
        ? `  WOULD need the standalone-token 400 fallback if rejected: "${fallback}" (see buildRakutenFallbackKeyword)`
        : `  no standalone-token issue expected`,
    );
    console.log(`  JP brandTerms=${JSON.stringify(item.brandTerms)}`);
    console.log(`  baseModelRequiredTerms=${JSON.stringify(item.baseModelRequiredTerms)} (reused from the 11st config - language-neutral model/spec codes)`);
    if (item.generationVariants) console.log(`  generationVariants=${JSON.stringify(item.generationVariants)}`);
    console.log(`  JP excludeTerms=${JSON.stringify(item.excludeTerms)}`);
    console.log("");
  }
  console.log(
    `Proposed live scope: exactly ${MAX_LIVE_CALLS} calls (one per item above), hits=5, >=1.1s apart - same count as the ` +
      `11st run, no more. Needs your explicit go-ahead + applicationId/accessKey already in your local .env:\n` +
      `  npx tsx src/scripts/supply-rakuten-sample10.ts live`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchWithFallback(keyword: string, creds: { applicationId: string; accessKey: string }, hits: number): Promise<RakutenItem[]> {
  try {
    const res = await searchRakutenItem({ ...creds, keyword, hits });
    return res.items;
  } catch (err) {
    if (!(err instanceof RakutenApiError) || err.status !== 400) throw err;
    const fallback = buildRakutenFallbackKeyword(keyword);
    if (!fallback) throw err;
    const res = await searchRakutenItem({ ...creds, keyword: fallback, hits });
    return res.items;
  }
}

async function runLive() {
  const applicationId = process.env.applicationId;
  const accessKey = process.env.accessKey;
  if (!applicationId || !accessKey) {
    console.error("Missing applicationId/accessKey (see .env.example) - not making any call.");
    process.exit(1);
  }
  const creds = { applicationId, accessKey };

  console.log(`=== Rakuten Ichiba Item Search - LIVE run: exactly ${MAX_LIVE_CALLS} calls ===\n`);

  interface BestCandidate {
    classification: ReturnType<typeof classifyCandidate>["classification"];
    matchedExcludeTerms: string[];
    source: RakutenItem;
  }
  const results: Array<{ item: SelectedItem; candidatesReturned: number; best?: BestCandidate }> = [];

  for (const [i, item] of JP_ITEMS.entries()) {
    console.log(`[${i + 1}/${MAX_LIVE_CALLS}] #${item.n} "${item.title}"`);
    try {
      const rakutenItems = await searchWithFallback(item.title, creds, 5);
      console.log(`  candidates returned=${rakutenItems.length}`);
      const withSource: BestCandidate[] = rakutenItems.map((ri) => {
        const c = classifyCandidate(item, { productName: ri.itemName });
        return { classification: c.classification, matchedExcludeTerms: c.matchedExcludeTerms, source: ri };
      });
      const best = withSource.find((c) => c.classification === "EXACT_CANDIDATE") ?? withSource.find((c) => c.classification === "NEEDS_REVIEW");
      if (best) {
        console.log(
          `  best candidate: ${best.classification} | itemName="${best.source.itemName}" | ` +
            `shop=${best.source.shopName} | price=${best.source.itemPrice} ${best.source.currencyCode ?? "JPY"} | ` +
            `availability=${best.source.availability} | url=${best.source.itemUrl}`,
        );
        if (best.matchedExcludeTerms.length > 0) console.log(`  (flagged terms: ${best.matchedExcludeTerms.join(", ")} - needs human check)`);
      } else {
        console.log("  no EXACT_CANDIDATE/NEEDS_REVIEW among returned items - MISMATCH");
      }
      results.push({ item, candidatesReturned: rakutenItems.length, best });
    } catch (err) {
      console.log(`  request failed: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ item, candidatesReturned: 0 });
    }
    if (i < JP_ITEMS.length - 1) await sleep(1100);
  }

  const exact = results.filter((r) => r.best?.classification === "EXACT_CANDIDATE");
  const review = results.filter((r) => r.best?.classification === "NEEDS_REVIEW");
  const mismatch = results.length - exact.length - review.length;
  const withPrice = exact.filter((r) => r.best?.source.itemPrice);

  console.log("\n=== FINAL TALLY (JP side) ===");
  console.log(`검색한 상품 수: ${results.length}`);
  console.log(`정확 매칭(EXACT_CANDIDATE) 수: ${exact.length}`);
  console.log(`검수 필요(NEEDS_REVIEW) 수: ${review.length}`);
  console.log(`불일치(MISMATCH/오류) 수: ${mismatch}`);
  console.log(`실제 판매자별 가격 확인 수 (EXACT 중 itemPrice 존재): ${withPrice.length}`);
}

async function main() {
  const mode = process.argv[2] ?? "offline";
  if (mode === "live") await runLive();
  else if (mode === "offline") printOfflinePlan();
  else {
    console.error(`Unknown mode "${mode}" - use "offline" (default) or "live".`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("supply-rakuten-sample10.ts")) {
  main().catch((err) => {
    console.error("supply-rakuten-sample10 FAILED:", err);
    process.exit(1);
  });
}
