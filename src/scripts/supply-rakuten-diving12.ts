/**
 * JP-side (Rakuten) counterpart to supply-diving-sample12.ts - the SAME
 * 12 diving items, checked against Rakuten Ichiba Item Search. Reuses
 * the camera script's generic safety mechanisms unchanged via import:
 * RequestBudget (hard HTTP-request cap, no adapter retry) and
 * normalizeKeyword (pre-normalizes known-400 keywords before the first
 * request) from supply-rakuten-sample10.ts, and classifyCandidate/
 * pickBestCandidate from supply-11st-sample10.ts. Neither of those files
 * is modified - this is purely additive, mirroring the existing
 * camera/diving split (supply-diving-sample12.ts does the same for 11st).
 *
 * Known real JP evidence already in this repo BEFORE any new call
 * (data/approved-mappings.json): Garmin Descent Mk3s (#14, JPY 187,000,
 * via Rakuten shop "mic21") and GULL Mantis5 (NOT one of these 12 items,
 * but notable: approved via Rakuten shop "find", a shop
 * poc_products_10.csv's manual research never found - evidence that
 * Rakuten's own marketplace aggregation can surface listings beyond what
 * a manual single-site check sees, which is exactly why the live-call
 * plan below still probes #14 instead of assuming it's "already done").
 *
 * Two modes, same contract as supply-rakuten-sample10.ts:
 *   npx tsx src/scripts/supply-rakuten-diving12.ts offline   (default)
 *     No network call, no applicationId/accessKey read. Prints the
 *     JP-language classifier config and pre-normalized keyword per item,
 *     plus which items this review's existing-data analysis says are
 *     even worth calling (see PRIOR_EVIDENCE in supply-diving-sample12.ts
 *     - #24's case is special: JP is CONFIRMED ABSENT for that exact SKU
 *     per poc_products_10.csv, so its live call is kept for completeness
 *     but is expected to return nothing).
 *   npx tsx src/scripts/supply-rakuten-diving12.ts live
 *     NOT RUN by this review - preparation only. Requires `live` +
 *     applicationId/accessKey. Hard-capped at MAX_HTTP_REQUESTS_DIVING
 *     real HTTP requests for the items PRIOR_EVIDENCE flags worthwhile
 *     (8 today) - never all 12, and never more than 1 request per item
 *     (RequestBudget + maxRetries=0, same guarantee as the camera script).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCandidate, type SelectedItem } from "./supply-11st-sample10";
import { SELECTED_DIVING_ITEMS, PRIOR_EVIDENCE, MAX_LIVE_CALLS_DIVING } from "./supply-diving-sample12";
import { RequestBudget, normalizeKeyword } from "./supply-rakuten-sample10";
import { searchRakutenItem, RakutenApiError, type RakutenItem } from "../adapters/rakuten";

const JP_BASE_EXCLUDE = ["中古", "訳あり", "整備済み", "リファービッシュ", "ジャンク", "アウトレット", "並行輸入", "海外版", "レンタル"];
const JP_ACCESSORY_MODIFIER_TERMS = ["交換用", "互換", "専用", "単品"];
const JP_ACCESSORY_NOUN_TERMS = [
  "イヤーピース",
  "ケース",
  "カバー",
  "ポーチ",
  "ストラップ",
  "ホース",
  "インフレーター",
  "マウスピース",
  "ネクシール",
];

/** JP equivalent of supply-diving-sample12.ts's sizeTokensKr() - same
 * reasoning: a bare "S"/"M"/"L" substring check is unsafe, always
 * require the "サイズ" marker adjacent to the letter. */
function sizeTokensJp(letters: string[]): string[] {
  return letters.flatMap((l) => [`サイズ${l}`, `${l}サイズ`]);
}
const STANDARD_SIZE_TOKENS_JP = sizeTokensJp(["XS", "S", "M", "L", "XL", "XXL"]);
const FIN_SIZE_TOKENS_JP = sizeTokensJp(["SS", "S", "M", "L", "XL"]);

/** JP-language brandTerms + hardOptionGroups overrides, mirroring
 * supply-rakuten-sample10.ts's buildJpItem() pattern. Every axis declared
 * on the KR side (supply-diving-sample12.ts) must have a JP-language
 * token list here too - asserted in buildJpDivingItem() below. */
const JP_OVERRIDES: Record<
  number,
  { brandTerms: string[]; extraExcludeTerms?: string[]; hardOptionGroups?: { label: string; anyOf: string[]; soft?: boolean }[] }
> = {
  13: { brandTerms: ["Shearwater", "シアウォーター"], hardOptionGroups: [{ label: "region", anyOf: ["国内正規品", "海外版", "並行輸入"], soft: true }] },
  14: {
    brandTerms: ["Garmin", "ガーミン"],
    extraExcludeTerms: ["Mk3i"],
    hardOptionGroups: [{ label: "case_size", anyOf: ["43mm", "51mm"], soft: true }],
  },
  15: { brandTerms: ["Aqua Lung", "アクアラング"] },
  16: {
    brandTerms: ["Aqua Lung", "アクアラング"],
    hardOptionGroups: [
      { label: "connection", anyOf: ["DIN", "Aタイプ", "ヨーク", "INT"], soft: true },
      { label: "stage_config", anyOf: ["1stステージ", "2ndステージ", "セット", "フルセット", "単体"], soft: true },
    ],
  },
  17: {
    brandTerms: ["Oceanic", "オシアニック"],
    hardOptionGroups: [
      { label: "connection", anyOf: ["DIN", "Aタイプ", "ヨーク", "INT"], soft: true },
      { label: "stage_config", anyOf: ["1stステージ", "2ndステージ", "セット", "フルセット", "単体"], soft: true },
    ],
  },
  18: { brandTerms: ["Zeagle", "ジーグル"], hardOptionGroups: [{ label: "size", anyOf: STANDARD_SIZE_TOKENS_JP, soft: true }] },
  19: { brandTerms: ["Mares", "マレス"], hardOptionGroups: [{ label: "size", anyOf: STANDARD_SIZE_TOKENS_JP, soft: true }] },
  20: {
    brandTerms: ["TUSA", "ツサ"],
    hardOptionGroups: [
      { label: "size", anyOf: FIN_SIZE_TOKENS_JP, soft: true },
      { label: "color", anyOf: ["ブラック", "Black", "ブルー", "Blue", "イエロー", "Yellow"], soft: true },
    ],
  },
  21: {
    brandTerms: ["Molchanovs", "モルチャノフ"],
    hardOptionGroups: [
      { label: "size", anyOf: FIN_SIZE_TOKENS_JP, soft: true },
      { label: "color", anyOf: ["ブラック", "Black", "ブルー", "Blue", "イエロー", "Yellow"], soft: true },
    ],
  },
  22: { brandTerms: ["TUSA", "ツサ"], hardOptionGroups: [{ label: "color", anyOf: ["ブラック", "Black", "クリア", "Clear", "ピンク", "Pink"], soft: true }] },
  23: { brandTerms: ["Fisheye", "フィッシュアイ"] },
  24: {
    brandTerms: ["Mares", "マレス"],
    hardOptionGroups: [
      { label: "size", anyOf: STANDARD_SIZE_TOKENS_JP, soft: true },
      { label: "gender", anyOf: ["メンズ", "Men", "レディース", "Women", "ユニセックス", "Unisex"], soft: true },
    ],
  },
};

function buildJpDivingItem(kr: SelectedItem): SelectedItem {
  const jp = JP_OVERRIDES[kr.n];
  if (!jp) throw new Error(`no JP_OVERRIDES entry for n=${kr.n}`);
  if (kr.hardOptionGroups?.length && !jp.hardOptionGroups) {
    throw new Error(`n=${kr.n} has KR hardOptionGroups but no JP hardOptionGroups override - add one`);
  }
  return {
    ...kr,
    brandTerms: jp.brandTerms,
    excludeTerms: [...new Set([...JP_BASE_EXCLUDE, ...(jp.extraExcludeTerms ?? [])])],
    hardOptionGroups: jp.hardOptionGroups,
    accessoryModifierTerms: JP_ACCESSORY_MODIFIER_TERMS,
    accessoryNounTerms: JP_ACCESSORY_NOUN_TERMS,
  };
}

export const JP_DIVING_ITEMS: SelectedItem[] = SELECTED_DIVING_ITEMS.map(buildJpDivingItem);

if (JP_DIVING_ITEMS.length !== MAX_LIVE_CALLS_DIVING) {
  throw new Error(`JP_DIVING_ITEMS has ${JP_DIVING_ITEMS.length} entries, expected ${MAX_LIVE_CALLS_DIVING}`);
}

export const WORTHWHILE_JP_DIVING_ITEMS = JP_DIVING_ITEMS.filter((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile);
export const MAX_HTTP_REQUESTS_DIVING = WORTHWHILE_JP_DIVING_ITEMS.length;

function printOfflinePlan() {
  console.log("=== Rakuten Ichiba Item Search - diving-sample(12) JP-side plan (no network call) ===\n");
  for (const item of JP_DIVING_ITEMS) {
    const ev = PRIOR_EVIDENCE[item.n];
    const normalized = normalizeKeyword(item.title);
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(`  Rakuten keyword: "${normalized}"${normalized !== item.title ? ` (normalized from "${item.title}")` : ""}`);
    console.log(`  JP brandTerms=${JSON.stringify(item.brandTerms)}`);
    if (item.hardOptionGroups?.length) console.log(`  hardOptionGroups=${JSON.stringify(item.hardOptionGroups)}`);
    console.log(`  실호출 가치 있음: ${ev.liveCallWorthwhile ? "예" : "아니오"} | 기존 실데이터: ${ev.existingRealEvidence}`);
    console.log("");
  }
  console.log(
    `Proposed live scope: ${MAX_HTTP_REQUESTS_DIVING} real HTTP requests TOTAL (only the items already flagged worthwhile - see ` +
      `supply-diving-sample12.ts's PRIOR_EVIDENCE), 1 request per item (RequestBudget + maxRetries=0), >=1.1s apart. NOT RUN by this review.\n` +
      `  npx tsx src/scripts/supply-rakuten-diving12.ts live`,
  );
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(SCRIPT_DIR, "..", "..", "local-results", "jp-rakuten-diving12.json");

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function toJpResultEntry(item: SelectedItem, best?: { itemName: string; shop: string; priceJpy: number; availability: number; url: string }): Record<string, unknown> {
  return {
    n: item.n,
    itemName: best?.itemName,
    shop: best?.shop,
    priceJpy: best?.priceJpy,
    availability: best?.availability,
    url: best?.url,
  };
}

/** NOT INVOKED by this review. Mirrors supply-rakuten-sample10.ts's
 * runLive() - same RequestBudget/maxRetries=0/pre-normalization
 * guarantees - scoped to the 8 items flagged worthwhile today. */
async function runLive() {
  const applicationId = process.env.applicationId;
  const accessKey = process.env.accessKey;
  if (!applicationId || !accessKey) {
    console.error("Missing applicationId/accessKey (see .env.example) - not making any call.");
    process.exit(1);
  }
  const creds = { applicationId, accessKey };
  const outPath = parseArg("out") ?? DEFAULT_OUT;
  const budget = new RequestBudget(MAX_HTTP_REQUESTS_DIVING);

  console.log(`=== Rakuten Ichiba Item Search - diving LIVE run: hard cap ${MAX_HTTP_REQUESTS_DIVING} HTTP requests ===\n`);
  const entries: Record<string, unknown>[] = [];

  for (const [i, item] of WORTHWHILE_JP_DIVING_ITEMS.entries()) {
    const keyword = normalizeKeyword(item.title);
    console.log(`[${i + 1}/${WORTHWHILE_JP_DIVING_ITEMS.length}] #${item.n} "${item.title}"`);
    if (budget.remaining <= 0) {
      console.log("  SKIPPED - budget exhausted");
      entries.push(toJpResultEntry(item));
      continue;
    }
    budget.record();
    try {
      const res = await searchRakutenItem({ ...creds, keyword, hits: 5 }, 0);
      console.log(`  candidates=${res.items.length}`);
      const classified = res.items.map((ri: RakutenItem) => ({ ri, c: classifyCandidate(item, { productName: ri.itemName }) }));
      const best = classified.find((x) => x.c.classification === "EXACT_CANDIDATE") ?? classified.find((x) => x.c.classification === "NEEDS_REVIEW");
      if (best) {
        console.log(`  best: ${best.c.classification} | ${best.ri.itemName} | ${best.ri.shopName} | ¥${best.ri.itemPrice}`);
        entries.push(toJpResultEntry(item, { itemName: best.ri.itemName, shop: best.ri.shopName, priceJpy: best.ri.itemPrice, availability: best.ri.availability, url: best.ri.itemUrl }));
      } else {
        console.log("  no EXACT/REVIEW candidate");
        entries.push(toJpResultEntry(item));
      }
    } catch (err) {
      console.log(`  failed: ${err instanceof RakutenApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err)}`);
      entries.push(toJpResultEntry(item));
    }
    if (i < WORTHWHILE_JP_DIVING_ITEMS.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");
  console.log(`\nSaved ${entries.length} entries to ${outPath} (실제 HTTP 요청 ${budget.spent}/${MAX_HTTP_REQUESTS_DIVING})`);
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
if (invokedPath && invokedPath.endsWith("supply-rakuten-diving12.ts")) {
  main().catch((err) => {
    console.error("supply-rakuten-diving12 FAILED:", err);
    process.exit(1);
  });
}
