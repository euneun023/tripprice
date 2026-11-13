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
import { classifyCandidate, pickBestCandidate, type SelectedItem, type ClassifiedCandidate } from "./supply-11st-sample10";
import { SELECTED_DIVING_ITEMS, PRIOR_EVIDENCE, MAX_LIVE_CALLS_DIVING, buildSearchKeyword } from "./supply-diving-sample12";
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

/**
 * JP equivalent of supply-diving-sample12.ts's sizeTokenPatternsKr() -
 * same two-part fix (unsafe substring both against unrelated words AND
 * against other size codes - サイズS is a prefix of サイズSS; XSサイズ
 * contains Sサイズ as a suffix) AND the same boundary-preservation fix:
 * tested against the RAW product name (not normalize()'s space-stripped
 * form) with `\s*` allowing an optional space either side of the マーカー,
 * so "サイズSS 本体" and "サイズSS本体" are both recognized while
 * "サイズS" never falsely matches inside either. See that file's comment
 * for why rawName specifically, and the exact S/SS, XS/S, XL/L, XXL/XL
 * boundary cases this is tested against.
 */
function sizeTokenPatternsJp(letters: string[]): { token: string; regex: RegExp }[] {
  return letters.flatMap((letter) => [
    { token: `サイズ${letter}`, regex: new RegExp(`サイズ\\s*${letter}(?![A-Za-z])`, "i") },
    { token: `${letter}サイズ`, regex: new RegExp(`(?<![A-Za-z])${letter}\\s*サイズ`, "i") },
  ]);
}
const STANDARD_SIZE_PATTERNS_JP = sizeTokenPatternsJp(["XS", "S", "M", "L", "XL", "XXL"]);
const FIN_SIZE_PATTERNS_JP = sizeTokenPatternsJp(["SS", "S", "M", "L", "XL"]);

/** JP-language brandTerms + hardOptionGroups overrides, mirroring
 * supply-rakuten-sample10.ts's buildJpItem() pattern. Every axis declared
 * on the KR side (supply-diving-sample12.ts) must have a JP-language
 * token list here too - asserted in buildJpDivingItem() below. */
type JpHardOptionGroup = { label: string; anyOf: string[]; soft?: boolean; patterns?: { token: string; regex: RegExp }[] };

const JP_OVERRIDES: Record<number, { brandTerms: string[]; extraExcludeTerms?: string[]; hardOptionGroups?: JpHardOptionGroup[] }> = {
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
  18: { brandTerms: ["Zeagle", "ジーグル"], hardOptionGroups: [{ label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_JP, soft: true }] },
  19: { brandTerms: ["Mares", "マレス"], hardOptionGroups: [{ label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_JP, soft: true }] },
  20: {
    brandTerms: ["TUSA", "ツサ"],
    // regional_spec mirrors supply-diving-sample12.ts's #20 entry - left
    // genuinely 미확인(unresolved), never assumed either way, see that
    // file's comment on CAMERA_BODY_CONFIG_GROUP-style soft axes.
    hardOptionGroups: [
      { label: "size", anyOf: [], patterns: FIN_SIZE_PATTERNS_JP, soft: true },
      { label: "color", anyOf: ["ブラック", "Black", "ブルー", "Blue", "イエロー", "Yellow"], soft: true },
      { label: "regional_spec", anyOf: ["SF-22", "SF0115", "Jスペック", "J-spec", "海外仕様", "国内仕様"], soft: true },
    ],
  },
  21: {
    brandTerms: ["Molchanovs", "モルチャノフ"],
    hardOptionGroups: [
      { label: "size", anyOf: [], patterns: FIN_SIZE_PATTERNS_JP, soft: true },
      { label: "color", anyOf: ["ブラック", "Black", "ブルー", "Blue", "イエロー", "Yellow"], soft: true },
    ],
  },
  22: { brandTerms: ["TUSA", "ツサ"], hardOptionGroups: [{ label: "color", anyOf: ["ブラック", "Black", "クリア", "Clear", "ピンク", "Pink"], soft: true }] },
  23: { brandTerms: ["Fisheye", "フィッシュアイ"] },
  24: {
    brandTerms: ["Mares", "マレス"],
    hardOptionGroups: [
      { label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_JP, soft: true },
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

/**
 * Builds the actual Rakuten search string: supply-diving-sample12.ts's
 * buildSearchKeyword() strips the sample's own parenthetical/slash
 * curation artifacts first (same fix as the KR side), THEN
 * normalizeKeyword() (existing, from supply-rakuten-sample10.ts) applies
 * Rakuten's documented standalone-token 400 workaround - applying both,
 * in this order, on every JP call.
 */
export function buildJpSearchKeyword(title: string): { keyword: string; wasSimplified: boolean; droppedAlternative?: string } {
  const { keyword: simplified, droppedAlternative, wasSimplified } = buildSearchKeyword(title);
  const keyword = normalizeKeyword(simplified) ?? simplified;
  return { keyword, wasSimplified: wasSimplified || keyword !== simplified, droppedAlternative };
}

/**
 * Structural risk this review asked to be checked offline (5. "일본
 * 검색어가 영어만으로 구성되어 결과 누락을 일으킬 위험"): every keyword
 * above is built from the English sample title. classifyCandidate's
 * brandTerms DO include a katakana alternative, but that only scores a
 * RESULT Rakuten already returned - the outgoing search query itself is
 * English-only. If a real JP seller's listing title is katakana-only
 * with no Latin brand/model at all, Rakuten's search may simply never
 * return it, and no amount of post-hoc classification can recover a
 * result that was never in the response. This is NOT fixed here - it
 * can only actually be resolved by the live call itself (not made by
 * this review); guessing a katakana-only keyword with no way to verify
 * it before calling would be worse than being explicit about the gap.
 */
const JP_ENGLISH_ONLY_KEYWORD_RISK_NOTE =
  "주의 (요청 5): 위 검색어는 전부 영어 원문입니다 - 분류용 brandTerms에는 카타카나 대안이 있지만, " +
  "라쿠텐에 실제로 보내는 검색어 자체는 영어뿐입니다. 일본 판매자가 카타카나 전용으로만 제목을 쓴다면 " +
  "검색 결과 자체가 누락될 수 있고, 이는 분류 로직을 고쳐서 해결될 문제가 아니라 실호출로만 확인 가능합니다.";

function printOfflinePlan() {
  console.log("=== Rakuten Ichiba Item Search - diving-sample(12) JP-side plan (no network call) ===\n");
  for (const item of JP_DIVING_ITEMS) {
    const ev = PRIOR_EVIDENCE[item.n];
    const { keyword, wasSimplified, droppedAlternative } = buildJpSearchKeyword(item.title);
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(wasSimplified ? `  Rakuten keyword (정규화됨): "${keyword}" (원본: "${item.title}")` : `  Rakuten keyword (원본 그대로): "${keyword}"`);
    if (droppedAlternative) console.log(`    (검색에서 제외된 대안명: "${droppedAlternative}")`);
    console.log(`  JP brandTerms=${JSON.stringify(item.brandTerms)}`);
    if (item.hardOptionGroups?.length) console.log(`  hardOptionGroups=${JSON.stringify(item.hardOptionGroups)}`);
    console.log(`  실호출 가치 있음: ${ev.liveCallWorthwhile ? "예" : "아니오"} | 기존 실데이터: ${ev.existingRealEvidence}`);
    console.log("");
  }
  console.log(JP_ENGLISH_ONLY_KEYWORD_RISK_NOTE);
  console.log("");
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

/** One preserved JP candidate - kept even for MISMATCH/REJECTED_
 * ACCESSORY so a human can see why it was excluded. Mirrors supply-
 * diving-sample12.ts's DivingCandidateEntry shape for the JP fields. */
export interface JpDivingCandidateEntry {
  itemName?: string;
  shop?: string;
  priceJpy?: number;
  availability?: number;
  url?: string;
  classification: string;
  detectedOptionHints: string[];
  deliveryUncertain: string[];
  reviewReason: string[];
}

export type DivingCallStatus = "ok" | "no_results" | "call_failed" | "all_candidates_rejected";

function toJpCandidateEntry(ri: RakutenItem, c: ClassifiedCandidate): JpDivingCandidateEntry {
  return {
    itemName: ri.itemName,
    shop: ri.shopName,
    priceJpy: ri.itemPrice,
    availability: ri.availability,
    url: ri.itemUrl,
    classification: c.classification,
    detectedOptionHints: c.detectedOptionHints,
    deliveryUncertain: c.matchedDeliveryUncertaintyTerms,
    reviewReason: [...c.matchedExcludeTerms, ...(c.rejectedAccessoryPhrase ? [`accessory:${c.rejectedAccessoryPhrase}`] : [])],
  };
}

/** Saves ALL returned candidates (up to 5 - hits is already capped at 5
 * below) as `candidates`, keeping every existing top-level field for
 * backward compatibility with compare-kr-jp-sample10.ts's JpResultEntry
 * schema. `callStatus` distinguishes API error / zero results / "results
 * came back but none were plausible" - same three-way split as the KR
 * side's toKrResultEntry. */
export function toJpResultEntry(
  item: SelectedItem,
  outcome: { status: "ok"; items: RakutenItem[] } | { status: "call_failed"; errorMessage: string },
): Record<string, unknown> {
  if (outcome.status === "call_failed") {
    return { n: item.n, callStatus: "call_failed" as DivingCallStatus, errorMessage: outcome.errorMessage, candidates: [], humanVerified: false };
  }
  const classified = outcome.items.map((ri) => classifyCandidate(item, { productName: ri.itemName }));
  const candidates = outcome.items.map((ri, idx) => toJpCandidateEntry(ri, classified[idx]));
  const best = pickBestCandidate(classified);
  const bestIndex = best ? classified.indexOf(best) : -1;
  const bestEntry = bestIndex >= 0 ? candidates[bestIndex] : undefined;
  const callStatus: DivingCallStatus = candidates.length === 0 ? "no_results" : bestEntry ? "ok" : "all_candidates_rejected";
  return {
    n: item.n,
    callStatus,
    itemName: bestEntry?.itemName,
    shop: bestEntry?.shop,
    priceJpy: bestEntry?.priceJpy,
    availability: bestEntry?.availability,
    url: bestEntry?.url,
    classification: bestEntry?.classification,
    detectedOptionHints: bestEntry?.detectedOptionHints ?? [],
    deliveryUncertain: bestEntry?.deliveryUncertain ?? [],
    reviewReason: bestEntry?.reviewReason ?? [],
    candidates,
    humanVerified: false,
  };
}

/** NOT INVOKED by this review. Mirrors supply-rakuten-sample10.ts's
 * runLive() - same RequestBudget/maxRetries=0/pre-normalization
 * guarantees - scoped to the 8 items flagged worthwhile today. Uses
 * buildJpSearchKeyword() (see above) for the actual search string. */
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
    const { keyword } = buildJpSearchKeyword(item.title);
    console.log(`[${i + 1}/${WORTHWHILE_JP_DIVING_ITEMS.length}] #${item.n} "${item.title}"${keyword !== item.title ? ` (검색어: "${keyword}")` : ""}`);
    if (budget.remaining <= 0) {
      console.log("  SKIPPED - budget exhausted");
      entries.push(toJpResultEntry(item, { status: "call_failed", errorMessage: "budget_exhausted" }));
      continue;
    }
    budget.record();
    try {
      const res = await searchRakutenItem({ ...creds, keyword, hits: 5 }, 0);
      console.log(`  candidates=${res.items.length}`);
      entries.push(toJpResultEntry(item, { status: "ok", items: res.items }));
    } catch (err) {
      const errorMessage = err instanceof RakutenApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
      console.log(`  failed: ${errorMessage}`);
      entries.push(toJpResultEntry(item, { status: "call_failed", errorMessage }));
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
