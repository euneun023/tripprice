/**
 * JP-side counterpart to supply-11st-sample10.ts: same 10 selected items
 * (imported, not re-picked), checked against Rakuten Ichiba Item Search -
 * the existing, already-production adapter (src/adapters/rakuten.ts, used
 * by src/cli/index.ts search-rakuten and the live refresh job). This file
 * adds NO new Rakuten integration and does NOT touch adapters/rakuten.ts -
 * every safeguard below (request cap, pre-normalization) lives here, in
 * the measurement script only.
 *
 * Two modes, same contract as supply-11st-sample10.ts:
 *
 *   npx tsx src/scripts/supply-rakuten-sample10.ts offline   (default)
 *     No network call, no applicationId/accessKey read. Prints the
 *     PRE-NORMALIZED keyword per item (see normalizeKeyword() below) and
 *     the JP classifier config, for review before any live call.
 *
 *   npx tsx src/scripts/supply-rakuten-sample10.ts live
 *     Requires `live` AND applicationId+accessKey in the environment.
 *     HARD CAP: at most MAX_HTTP_REQUESTS (=10) real HTTP requests for the
 *     entire run, enforced by REQUEST_BUDGET below - see its own comment
 *     for exactly how that number is guaranteed, including adapter-
 *     internal retries. >=1.1s between items (Rakuten's app is registered
 *     at 1 QPS per adapters/rakuten.ts's own comment). Never reads/prints
 *     applicationId/accessKey themselves.
 *
 * Classification reuses classifyCandidate() from supply-11st-sample10.ts
 * unchanged (it only reads `.productName`) - only the brand/exclude word
 * lists differ here, because they have to be Japanese, not Korean/English
 * (Rakuten listings are in Japanese: "ソニー" not "Sony"/"소니", "中古" not
 * "중고", etc.) - see buildJpItem()'s comment.
 */
import "dotenv/config";
import { SELECTED_ITEMS, MAX_LIVE_CALLS, classifyCandidate, type SelectedItem } from "./supply-11st-sample10";
import { searchRakutenItem, buildRakutenFallbackKeyword, RakutenApiError, type RakutenItem } from "../adapters/rakuten";

/** Common JP condition/bundle words that apply across every item type -
 * JP equivalent of supply-11st-sample10.ts's BASE_EXCLUDE (Korean). Added
 * per item 3's review request: 整備済み/リファービッシュ/ジャンク cover
 * refurb/for-parts wording "리퍼" alone didn't, and 並行輸入/海外版 flag
 * parallel-import/overseas-spec listings for human review (same real
 * product, but possibly different warranty/region - not a silent EXACT). */
// Condition/rental words only - NOT a place for single accessory nouns
// (same reasoning as supply-11st-sample10.ts's BASE_EXCLUDE: a bare-word
// check on 交換用/イヤーピース/etc. would needlessly downgrade a real
// product listing that merely discloses a bundled accessory. The precise
// JP accessory check lives in JP_ACCESSORY_MODIFIER_TERMS/
// JP_ACCESSORY_NOUN_TERMS below (co-occurrence -> REJECTED_ACCESSORY).
const JP_BASE_EXCLUDE = ["中古", "訳あり", "整備済み", "リファービッシュ", "ジャンク", "アウトレット", "並行輸入", "海外版"];

/** JP equivalents of supply-11st-sample10.ts's ACCESSORY_MODIFIER_TERMS/
 * ACCESSORY_NOUN_TERMS - see that file's comment for why co-occurrence
 * (not a single word) is required before rejecting as accessory-only. */
const JP_ACCESSORY_MODIFIER_TERMS = ["交換用", "互換", "専用", "単品"];
const JP_ACCESSORY_NOUN_TERMS = ["イヤーピース", "イヤホンチップ", "フィルター", "フード", "ケース", "保護フィルム", "ポーチ", "バンド", "ストラップ"];

/** JP wording that signals delivery/stock is NOT confirmed - JP
 * equivalent of supply-11st-sample10.ts's KR_DELIVERY_UNCERTAIN, applied
 * to every JP_ITEMS entry (see buildJpItem). */
const JP_DELIVERY_UNCERTAIN = ["納期未定", "入荷未定", "予約", "取り寄せ", "入荷待ち", "メーカー取り寄せ"];

/**
 * Regex variants of JP delivery-uncertain wording, for a variable
 * number+unit lead time a fixed string list can't enumerate - e.g.
 * "納期約3ヶ月"/"納期2週間"/"納期10日" all mean "not confirmed", only the
 * number/unit changes. Matched against the RAW (non-normalized)
 * itemName - see SelectedItem.deliveryUncertaintyPatterns.
 */
const JP_DELIVERY_UNCERTAIN_PATTERNS = [
  /納期[^、。\n]{0,8}?(未定|約?\d+\s*(?:ヶ月|か月|カ月|週間?|日))/,
  /入荷[^、。\n]{0,4}?(未定|待ち)/,
];

/** JP-language hardOptionGroups overrides for the items that have one on
 * the KR side (color/mount axes) - the KR anyOf tokens (실버/E마운트/...)
 * would never match a Japanese listing, so this is NOT optional the way
 * extraExcludeTerms additions are; every n with a KR hardOptionGroups
 * entry must have one here too (asserted below). */
const JP_HARD_OPTION_GROUPS: Record<number, { label: string; anyOf: string[] }[]> = {
  1: [{ label: "color", anyOf: ["シルバー", "Silver", "ブラック", "Black", "チャコール", "Charcoal"] }],
  5: [
    {
      label: "mount",
      anyOf: ["Eマウント", "ソニーE", "Sony E", "Zマウント", "ニコンZ", "Nikon Z", "Xマウント", "フジX", "Fuji X", "RFマウント", "Canon RF"],
    },
  ],
  9: [{ label: "color", anyOf: ["ブラック", "Black", "グレー", "Grey", "Gray", "ホワイト", "White"] }],
  12: [{ label: "color", anyOf: ["ブラック", "Black", "グレー", "Grey", "Gray", "ホワイト", "White"] }],
};

/**
 * Per-item overrides for the Rakuten/JP side. brandTerms/extraExcludeTerms
 * only - baseModelRequiredTerms/generationVariants are reused unchanged
 * from SELECTED_ITEMS (language-neutral model/spec codes).
 */
const JP_OVERRIDES: Record<number, { brandTerms: string[]; extraExcludeTerms: string[] }> = {
  1: { brandTerms: ["FUJIFILM", "Fuji", "フジフイルム", "フジフィルム", "富士フイルム"], extraExcludeTerms: ["セット", "キット", "展示品", "レンタル"] },
  2: { brandTerms: ["FUJIFILM", "Fuji", "フジフイルム", "フジフィルム", "富士フイルム"], extraExcludeTerms: ["セット", "キット", "展示品", "レンタル"] },
  3: { brandTerms: ["Canon", "キヤノン", "キャノン"], extraExcludeTerms: ["セット", "キット", "展示品", "レンタル"] },
  4: { brandTerms: ["Sony", "ソニー"], extraExcludeTerms: ["セット", "フィルター", "フード"] },
  5: { brandTerms: ["Tamron", "タムロン"], extraExcludeTerms: ["セット", "フィルター", "フード"] },
  6: { brandTerms: ["Sony", "ソニー"], extraExcludeTerms: ["セット", "フィルター", "フード"] },
  7: { brandTerms: ["OnePlus", "ワンプラス"], extraExcludeTerms: ["ケース", "カバー"] },
  9: { brandTerms: ["Bowers", "B&W", "バウアース"], extraExcludeTerms: ["ケース", "カバー"] },
  12: { brandTerms: ["Fitbit", "フィットビット"], extraExcludeTerms: ["ケース", "バンド"] },
  25: { brandTerms: ["SK-II", "SK2", "エスケーツー", "ピテラ"], extraExcludeTerms: ["セット", "企画品", "詰め替え"] },
};

/**
 * Model/spec-code collision guards that are language-neutral (alphanumeric,
 * not Korean words) and must therefore survive into the JP config too -
 * otherwise rebuilding excludeTerms for JP (below) silently drops them.
 * Today: X-H2 vs X-H2S (item #2) - same risk as the KR side, see
 * supply-11st-sample10.ts's own comment on item #2.
 */
const MODEL_CODE_COLLISION_GUARDS: Record<number, string[]> = { 2: ["XH2S"] };

function buildJpItem(kr: SelectedItem): SelectedItem {
  const jp = JP_OVERRIDES[kr.n];
  if (!jp) throw new Error(`no JP_OVERRIDES entry for n=${kr.n} - every SELECTED_ITEMS entry must have one`);
  if (kr.hardOptionGroups?.length && !JP_HARD_OPTION_GROUPS[kr.n]) {
    // Defensive: the KR config declared a hard-required option axis (e.g.
    // color/mount) but this file has no JP-language token list for it -
    // silently carrying over the KR (Korean/English) anyOf tokens would
    // make detectedOptionHints always empty against Japanese listings,
    // which is a worse failure than refusing to build at all.
    throw new Error(`n=${kr.n} has KR hardOptionGroups but no JP_HARD_OPTION_GROUPS override - add one`);
  }
  const excludeTerms = [...new Set([...JP_BASE_EXCLUDE, ...jp.extraExcludeTerms, ...(MODEL_CODE_COLLISION_GUARDS[kr.n] ?? [])])];
  return {
    ...kr,
    brandTerms: jp.brandTerms,
    excludeTerms,
    hardOptionGroups: JP_HARD_OPTION_GROUPS[kr.n],
    deliveryUncertaintyTerms: JP_DELIVERY_UNCERTAIN,
    deliveryUncertaintyPatterns: JP_DELIVERY_UNCERTAIN_PATTERNS,
    accessoryModifierTerms: JP_ACCESSORY_MODIFIER_TERMS,
    accessoryNounTerms: JP_ACCESSORY_NOUN_TERMS,
  };
}

export const JP_ITEMS: SelectedItem[] = SELECTED_ITEMS.map(buildJpItem);

if (JP_ITEMS.length !== MAX_LIVE_CALLS) {
  throw new Error(`JP_ITEMS has ${JP_ITEMS.length} entries, expected ${MAX_LIVE_CALLS} (one per SELECTED_ITEMS entry)`);
}

/**
 * Pre-normalizes a keyword BEFORE the first request, instead of trying the
 * raw title and only falling back after a 400 - the fallback-after-400
 * approach (this file's previous version) could cost a second real HTTP
 * request per item, which combined with the adapter's own 429 retries
 * could push the run's total request count past 10. buildRakutenFallbackKeyword
 * is pure/offline (no network) and returns null when nothing needs
 * changing, so this never alters a keyword that was already going to work.
 */
export function normalizeKeyword(title: string): string {
  return buildRakutenFallbackKeyword(title) ?? title;
}

function printOfflinePlan() {
  console.log("=== Rakuten Ichiba Item Search - JP-side plan for the SAME 10 items (no network call) ===\n");
  console.log(
    "Integration status: already production - src/adapters/rakuten.ts (searchRakutenItem), " +
      "used live by src/cli/index.ts search-rakuten and the running refresh job. No new Rakuten code needed here.\n",
  );
  for (const item of JP_ITEMS) {
    const normalized = normalizeKeyword(item.title);
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(
      normalized === item.title
        ? `  Rakuten keyword (planned, unchanged): "${item.title}"`
        : `  Rakuten keyword (PRE-NORMALIZED to avoid a known 400 - see buildRakutenFallbackKeyword): "${normalized}" (raw title: "${item.title}")`,
    );
    console.log(`  JP brandTerms=${JSON.stringify(item.brandTerms)}`);
    console.log(`  baseModelRequiredTerms=${JSON.stringify(item.baseModelRequiredTerms)} (reused from the 11st config - language-neutral model/spec codes)`);
    if (item.generationVariants) console.log(`  generationVariants=${JSON.stringify(item.generationVariants)}`);
    console.log(`  JP excludeTerms=${JSON.stringify(item.excludeTerms)}`);
    if (item.hardOptionGroups?.length) console.log(`  hardOptionGroups=${JSON.stringify(item.hardOptionGroups)} (caps at NEEDS_REVIEW)`);
    console.log(`  JP deliveryUncertaintyTerms=${JSON.stringify(item.deliveryUncertaintyTerms)}`);
    console.log("");
  }
  console.log(
    `Proposed live scope: exactly ${MAX_LIVE_CALLS} real HTTP requests TOTAL for the whole run (one pre-normalized request ` +
      `per item above, adapter-internal 429 retries disabled - see REQUEST_BUDGET) - same count as the 11st run, no more. ` +
      `Needs your explicit go-ahead + applicationId/accessKey already in your local .env:\n` +
      `  npx tsx src/scripts/supply-rakuten-sample10.ts live`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MAX_HTTP_REQUESTS = MAX_LIVE_CALLS;

/**
 * Hard global cap on real HTTP requests for the whole run, counting every
 * call this script makes to searchRakutenItem() - including what would
 * otherwise be the adapter's own internal 429 retries. Two things make
 * each item cost exactly 1 request, so 10 items == 10 requests, no more:
 *   1. maxRetries=0 is always passed to searchRakutenItem() below, which
 *      disables the adapter's internal 429-retry loop entirely for this
 *      script (the adapter's own default/production behavior - its
 *      maxRetries=3 default - is untouched; this is a caller-supplied
 *      override, not an adapter code change).
 *   2. normalizeKeyword() pre-normalizes before the first request (see its
 *      own comment), so there is no runtime fallback-and-retry-on-400 path
 *      left to spend a second request on.
 * recordRequest() is still called immediately before every actual
 * searchRakutenItem() call and throws if the budget is already exhausted,
 * as a defensive backstop against a future edit accidentally reintroducing
 * a second call path - it should never actually trigger given (1) and (2).
 */
export class RequestBudget {
  private used = 0;
  constructor(private readonly max: number) {}
  record(): void {
    this.used++;
    if (this.used > this.max) {
      throw new Error(`RequestBudget exceeded: ${this.used} requests attempted, max is ${this.max}`);
    }
  }
  get remaining(): number {
    return this.max - this.used;
  }
  get spent(): number {
    return this.used;
  }
}

type ItemOutcome =
  | { status: "ok"; items: RakutenItem[] }
  | { status: "call_failed"; errorMessage: string }
  | { status: "budget_exhausted" };

async function searchOnce(
  budget: RequestBudget,
  keyword: string,
  creds: { applicationId: string; accessKey: string },
  hits: number,
): Promise<ItemOutcome> {
  if (budget.remaining <= 0) return { status: "budget_exhausted" };
  budget.record();
  try {
    const res = await searchRakutenItem({ ...creds, keyword, hits }, /* maxRetries */ 0);
    return { status: "ok", items: res.items };
  } catch (err) {
    const message =
      err instanceof RakutenApiError ? `HTTP ${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err);
    return { status: "call_failed", errorMessage: message };
  }
}

interface BestCandidate {
  classification: ReturnType<typeof classifyCandidate>["classification"];
  matchedExcludeTerms: string[];
  detectedOptionHints: string[];
  matchedDeliveryUncertaintyTerms: string[];
  rejectedAccessoryPhrase?: string;
  source: RakutenItem;
}

/** Distinguishes call failure / no results / model mismatch / match, per
 * the task's requirement that these never be lumped together. */
type ResultStatus = "call_failed" | "budget_exhausted" | "no_results" | "model_mismatch" | "rejected_accessory" | "needs_review" | "exact_match";

interface ItemResult {
  item: SelectedItem;
  status: ResultStatus;
  candidatesReturned: number;
  best?: BestCandidate;
  errorMessage?: string;
}

export async function runLive(delayMs = 1100) {
  const applicationId = process.env.applicationId;
  const accessKey = process.env.accessKey;
  if (!applicationId || !accessKey) {
    console.error("Missing applicationId/accessKey (see .env.example) - not making any call.");
    process.exit(1);
  }
  const creds = { applicationId, accessKey };
  const budget = new RequestBudget(MAX_HTTP_REQUESTS);

  console.log(`=== Rakuten Ichiba Item Search - LIVE run: hard cap ${MAX_HTTP_REQUESTS} HTTP requests total ===\n`);

  const results: ItemResult[] = [];

  for (const [i, item] of JP_ITEMS.entries()) {
    const keyword = normalizeKeyword(item.title);
    console.log(`[${i + 1}/${JP_ITEMS.length}] #${item.n} "${item.title}"${keyword !== item.title ? ` (normalized: "${keyword}")` : ""}`);

    const outcome = await searchOnce(budget, keyword, creds, 5);

    if (outcome.status === "budget_exhausted") {
      console.log(`  SKIPPED - request budget exhausted (${budget.spent}/${MAX_HTTP_REQUESTS} already used)`);
      results.push({ item, status: "budget_exhausted", candidatesReturned: 0 });
    } else if (outcome.status === "call_failed") {
      console.log(`  call failed: ${outcome.errorMessage}`);
      results.push({ item, status: "call_failed", candidatesReturned: 0, errorMessage: outcome.errorMessage });
    } else if (outcome.items.length === 0) {
      console.log("  0 candidates returned (no results, not an error)");
      results.push({ item, status: "no_results", candidatesReturned: 0 });
    } else {
      const classified: BestCandidate[] = outcome.items.map((ri) => {
        const c = classifyCandidate(item, { productName: ri.itemName });
        return {
          classification: c.classification,
          matchedExcludeTerms: c.matchedExcludeTerms,
          detectedOptionHints: c.detectedOptionHints,
          matchedDeliveryUncertaintyTerms: c.matchedDeliveryUncertaintyTerms,
          rejectedAccessoryPhrase: c.rejectedAccessoryPhrase,
          source: ri,
        };
      });
      const best = classified.find((c) => c.classification === "EXACT_CANDIDATE") ?? classified.find((c) => c.classification === "NEEDS_REVIEW");
      if (best) {
        console.log(
          `  best candidate: ${best.classification} | itemName="${best.source.itemName}" | ` +
            `shop=${best.source.shopName} | price=${best.source.itemPrice} ${best.source.currencyCode ?? "JPY"} | ` +
            `availability=${best.source.availability} | url=${best.source.itemUrl}`,
        );
        if (best.matchedExcludeTerms.length > 0) console.log(`  (flagged terms: ${best.matchedExcludeTerms.join(", ")} - needs human check)`);
        if (item.hardOptionGroups?.length) {
          console.log(
            `  (option axes requiring cross-check against the KR counterpart: ${item.hardOptionGroups.map((g) => g.label).join(", ")}` +
              `${best.detectedOptionHints.length ? ` | detected: ${best.detectedOptionHints.join(", ")}` : " | none detected in name"})`,
          );
        }
        if (best.matchedDeliveryUncertaintyTerms.length > 0) {
          console.log(
            `  (delivery/stock wording found: ${best.matchedDeliveryUncertaintyTerms.join(", ")} - purchasability NOT confirmed even if classified EXACT, even if availability=1)`,
          );
        }
        if (best.source.availability === 0) {
          console.log(`  (Rakuten availability flag=0 - API itself reports out of stock)`);
        }
        results.push({
          item,
          status: best.classification === "EXACT_CANDIDATE" ? "exact_match" : "needs_review",
          candidatesReturned: outcome.items.length,
          best,
        });
      } else if (classified.every((c) => c.classification === "REJECTED_ACCESSORY")) {
        console.log(
          `  all ${classified.length} candidate(s) were accessory-only listings (e.g. "${classified[0].rejectedAccessoryPhrase}") - REJECTED_ACCESSORY, not model mismatch`,
        );
        results.push({ item, status: "rejected_accessory", candidatesReturned: outcome.items.length });
      } else {
        console.log(`  ${outcome.items.length} candidate(s) returned, none matched the model identity - model mismatch`);
        results.push({ item, status: "model_mismatch", candidatesReturned: outcome.items.length });
      }
    }

    if (i < JP_ITEMS.length - 1) await sleep(delayMs);
  }

  const by = (status: ResultStatus) => results.filter((r) => r.status === status);
  const exact = by("exact_match");
  const review = by("needs_review");
  const mismatch = by("model_mismatch");
  const rejectedAccessory = by("rejected_accessory");
  const noResults = by("no_results");
  const failed = by("call_failed");
  const skipped = by("budget_exhausted");
  const withPrice = exact.filter((r) => r.best?.source.itemPrice);
  const forcedReviewByOption = results.filter((r) => r.item.hardOptionGroups?.length && r.best?.classification === "NEEDS_REVIEW");
  const deliveryUncertain = results.filter((r) => (r.best?.matchedDeliveryUncertaintyTerms.length ?? 0) > 0);
  const flaggedOutOfStock = results.filter((r) => r.best?.source.availability === 0);

  console.log("\n=== FINAL TALLY (JP side) ===");
  console.log(`실제 HTTP 요청 수: ${budget.spent}/${MAX_HTTP_REQUESTS}`);
  console.log(`검색 시도 상품 수: ${results.length}`);
  console.log(`정확 매칭(EXACT_CANDIDATE) 수: ${exact.length}`);
  console.log(`검수 필요(NEEDS_REVIEW) 수: ${review.length}`);
  console.log(`  - 그중 옵션(마운트/색상 등) 미확인으로 REVIEW 강제된 수: ${forcedReviewByOption.length}`);
  console.log(`액세서리 단독으로 제외(REJECTED_ACCESSORY) 수: ${rejectedAccessory.length}`);
  console.log(`모델 불일치(candidates 있으나 미매칭) 수: ${mismatch.length}`);
  console.log(`검색 결과 없음(0건, 오류 아님) 수: ${noResults.length}`);
  console.log(`호출 실패(네트워크/HTTP 오류) 수: ${failed.length}`);
  console.log(`예산 소진으로 스킵된 수: ${skipped.length}`);
  console.log(`실제 판매자별 가격 확인 수 (EXACT 중 itemPrice 존재): ${withPrice.length}`);
  console.log(`납기/재고 문구 감지 수 (classification과 별개, 구매가능 미확정): ${deliveryUncertain.length}`);
  console.log(`availability=0 (API 자체가 품절 표시) 수: ${flaggedOutOfStock.length}`);
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
