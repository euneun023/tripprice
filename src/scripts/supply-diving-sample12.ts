/**
 * Diving-gear feasibility check for 11st ProductSearch - the 12 diving
 * items in docs/supply-sample-products.json (n=13,14,15,16,17,18,19,20,
 * 21,22,23,24), kept as a SEPARATE test target from the 10-item camera
 * sample (supply-11st-sample10.ts, untouched by this file) per this
 * review's explicit instruction not to treat camera's success as proof
 * of diving's feasibility.
 *
 * Reuses the camera script's generic classifier (classifyCandidate,
 * pickBestCandidate, the accessory co-occurrence check) unchanged via
 * import - none of that logic is camera-specific, only SELECTED_ITEMS
 * (10 camera items) was. SELECTED_DIVING_ITEMS below is a new, separate
 * 12-item array; supply-11st-sample10.ts is not modified.
 *
 * Per-category identification axes (hardOptionGroups), from this
 * review's own instructions:
 *   dive_computer: 세대(generation) + 지역 사양(region/certification variant)
 *   regulator:     연결방식(DIN vs 요크/INT) + 구성(1단/2단/세트)
 *   bcd:           사이즈
 *   fins:          사이즈 + 색상
 *   diving_mask:   색상
 *   wetsuit:       두께 + 사이즈 + 성별
 *   dive_light:    모델/세대/구성 전부 - 식별 근거가 가장 약한 카테고리라
 *                  (전체 풀에서 exact 9%, 2/22) 사실상 항상 검수 필요로
 *                  취급한다.
 * All axes are DETECTION-only (see supply-11st-sample10.ts's own
 * hardOptionGroups doc) - no "correct" value is asserted, only whether
 * two sides' listings agree.
 *
 * Two modes, same contract as supply-11st-sample10.ts:
 *   npx tsx src/scripts/supply-diving-sample12.ts offline   (default)
 *     No network call, no API key read. Prints the 12-item selection,
 *     classifier config, and - for each item - whether existing repo
 *     data (docs/supply-sample-products.json, data/approved-mappings.json,
 *     poc_products_10.csv) already answers the question, so a live call
 *     is skipped where it would be redundant (see
 *     ALREADY_ANSWERED_BY_EXISTING_DATA below).
 *   npx tsx src/scripts/supply-diving-sample12.ts live
 *     Requires ELEVENST_API_KEY + the explicit `live` argument. NOT RUN
 *     by this review - preparation only. Hard-capped at
 *     MAX_LIVE_CALLS_DIVING (=12, one per item still needing a live
 *     check - see shouldSkipLiveCall()). Saves results in the same
 *     schema as supply-11st-sample10.ts's toKrResultEntry (no API
 *     key/raw response).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCandidate,
  pickBestCandidate,
  KR_DELIVERY_UNCERTAIN,
  ACCESSORY_NOUN_TERMS,
  type SelectedItem,
  type ClassifiedCandidate,
} from "./supply-11st-sample10";
import { searchElevenstProduct, ElevenstApiError } from "../adapters/elevenst";

const DIVING_BASE_EXCLUDE = ["중고", "리퍼비시", "리퍼", "전시상품", "전시품", "대여", "렌탈", "구매대행"];
// Dive-gear-specific accessory nouns beyond the camera/earbuds set
// (호스=regulator hose, 인플레이터=BCD inflator, 넥실=mask strap cover) -
// kept local to this file rather than widening the shared camera list.
const DIVING_ACCESSORY_NOUN_TERMS = [...ACCESSORY_NOUN_TERMS, "호스", "인플레이터", "넥실", "마우스피스"];

/**
 * Size tokens ALWAYS require the "사이즈" marker adjacent to the letter
 * (either order) - a bare single letter like "S"/"M"/"L" as a substring
 * check would false-positive constantly (e.g. "GPS", "Lens", or any
 * Korean word whose romanization happens to contain that letter). This
 * is a correctness fix, not a style choice - caught in this file's own
 * test.
 */
function sizeTokensKr(letters: string[]): string[] {
  return letters.flatMap((l) => [`사이즈${l}`, `${l}사이즈`]);
}
const STANDARD_SIZE_TOKENS_KR = sizeTokensKr(["XS", "S", "M", "L", "XL", "XXL"]);
const FIN_SIZE_TOKENS_KR = sizeTokensKr(["SS", "S", "M", "L", "XL"]);

/**
 * The 12 diving items, n=13..24 from docs/supply-sample-products.json,
 * cross-referenced against:
 *   - poc_products_10.csv (Phase0 PoC - real KR/JP/직구 seller URLs for
 *     some of these, and for 2 OTHER diving products outside this
 *     12-item list, already-verified 3-way real prices)
 *   - data/approved-mappings.json (2 existing APPROVED JP/Rakuten
 *     listings - Garmin Descent Mk3s, GULL Mantis5 - neither of which is
 *     in csvSellerUrls/approvedListingInRepo with a KR side)
 *   - matching-baseline.json / its priorHumanReview_eitherSide field
 * identifierReadiness/priorHumanReview copied from that cross-reference,
 * NOT re-derived here - see this file's own report for the full
 * reasoning per item.
 */
export const SELECTED_DIVING_ITEMS: SelectedItem[] = [
  {
    n: 13,
    type: "dive_computer",
    title: "Shearwater Peregrine (Original/Standard, Black)",
    brandTerms: ["Shearwater", "쉬어워터"],
    baseModelRequiredTerms: ["Peregrine"],
    excludeTerms: [...DIVING_BASE_EXCLUDE, "세트", "번들"],
    // region/cert variant - generic, detection-only, soft (see file header)
    hardOptionGroups: [{ label: "region", anyOf: ["국내용", "해외용", "글로벌", "Global", "정식수입"], soft: true }],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 14,
    type: "dive_computer",
    title: "Garmin Descent Mk3s (Steel/Fog Gray, 43mm)",
    brandTerms: ["Garmin", "가민"],
    baseModelRequiredTerms: ["Mk3s"],
    // Mk3i (titanium) is a DIFFERENT real SKU from Mk3s (steel) - same
    // substring-collision risk as camera's X-H2/X-H2S.
    excludeTerms: [...DIVING_BASE_EXCLUDE, "Mk3i", "세트", "번들"],
    // Case size (43mm here) is a real distinguishing spec for this line
    // (Garmin also sells larger cases) - soft/detection-only.
    hardOptionGroups: [{ label: "case_size", anyOf: ["43mm", "51mm"], soft: true }],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 15,
    type: "dive_computer",
    title: "Aqua Lung i450T",
    brandTerms: ["Aqua Lung", "아쿠아렁"],
    baseModelRequiredTerms: ["i450T"],
    excludeTerms: [...DIVING_BASE_EXCLUDE, "세트", "번들"],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 16,
    type: "regulator",
    title: "Aqua Lung Leg3nd",
    brandTerms: ["Aqua Lung", "아쿠아렁"],
    baseModelRequiredTerms: ["Leg3nd"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    // Connection (DIN vs 요크/INT) and stage configuration (1단 only /
    // 2단 only / 세트) are both REQUIRED identity facts for a regulator -
    // a 1st-stage-only listing and a full set are not comparable prices.
    // soft: a real conflict (DIN vs 요크, or 1단 vs 세트) forces MISMATCH;
    // absence on one side alone doesn't cap this item (see compare-side
    // handling, same mechanism as camera's config axis).
    hardOptionGroups: [
      { label: "connection", anyOf: ["DIN", "요크", "INT", "Yoke"], soft: true },
      { label: "stage_config", anyOf: ["1단", "2단", "세트", "풀세트", "단품"], soft: true },
    ],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 17,
    type: "regulator",
    title: "Oceanic Zeo/FDXi",
    brandTerms: ["Oceanic", "오셔닉"],
    baseModelRequiredTerms: ["Zeo"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [
      { label: "connection", anyOf: ["DIN", "요크", "INT", "Yoke"], soft: true },
      { label: "stage_config", anyOf: ["1단", "2단", "세트", "풀세트", "단품"], soft: true },
    ],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 18,
    type: "bcd",
    title: "Zeagle Ranger",
    brandTerms: ["Zeagle", "지글"],
    baseModelRequiredTerms: ["Ranger"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [{ label: "size", anyOf: STANDARD_SIZE_TOKENS_KR, soft: true }],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 19,
    type: "bcd",
    title: "Mares Prestige SLS",
    brandTerms: ["Mares", "마레스"],
    baseModelRequiredTerms: ["Prestige", "SLS"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [{ label: "size", anyOf: STANDARD_SIZE_TOKENS_KR, soft: true }],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 20,
    type: "fins",
    title: "TUSA Solla (Open Heel Diving Fins)",
    brandTerms: ["TUSA", "투사"],
    baseModelRequiredTerms: ["Solla"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    // Known real risk (from poc_products_10.csv row10): the JP side is
    // mic21's own "J-spec" (SF0115), a DIFFERENT regional spec code from
    // the KR standard SF-22 - size AND color both matter, soft/detection.
    hardOptionGroups: [
      { label: "size", anyOf: FIN_SIZE_TOKENS_KR, soft: true },
      { label: "color", anyOf: ["블랙", "Black", "블루", "Blue", "옐로우", "Yellow"], soft: true },
    ],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 21,
    type: "fins",
    title: "Molchanovs CP4 Fins",
    brandTerms: ["Molchanovs", "몰차노프"],
    baseModelRequiredTerms: ["CP4"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [
      { label: "size", anyOf: FIN_SIZE_TOKENS_KR, soft: true },
      { label: "color", anyOf: ["블랙", "Black", "블루", "Blue", "옐로우", "Yellow"], soft: true },
    ],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 22,
    type: "diving_mask",
    title: "TUSA Freedom HD Mask",
    brandTerms: ["TUSA", "투사"],
    baseModelRequiredTerms: ["Freedom HD"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [{ label: "color", anyOf: ["블랙", "Black", "클리어", "Clear", "핑크", "Pink"], soft: true }],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 23,
    type: "dive_light",
    title: "Fisheye FIX NEO Premium 1000DX SWII",
    brandTerms: ["Fisheye", "피쉬아이"],
    baseModelRequiredTerms: ["1000DX"],
    // generationVariants used as a HARD requirement surrogate: "SWII" is
    // part of the exact model string the task calls for ("정확한 모델·
    // 세대·구성") - if a candidate doesn't say SWII at all, that's exactly
    // the kind of generation ambiguity this category can't currently
    // resolve automatically (whole-pool baseline: only 2/22 dive_light
    // candidates were ever exact-matched).
    generationVariants: ["SWII", "SW2", "SW-II"],
    excludeTerms: [...DIVING_BASE_EXCLUDE, "세트", "번들"],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
  {
    n: 24,
    type: "wetsuit",
    title: "Mares Reef 3mm Diving Wetsuit",
    brandTerms: ["Mares", "마레스"],
    baseModelRequiredTerms: ["Reef", "3mm"],
    excludeTerms: [...DIVING_BASE_EXCLUDE],
    hardOptionGroups: [
      { label: "size", anyOf: STANDARD_SIZE_TOKENS_KR, soft: true },
      { label: "gender", anyOf: ["남성용", "Men", "여성용", "Women", "Lady", "유니섹스", "Unisex"], soft: true },
    ],
    deliveryUncertaintyTerms: KR_DELIVERY_UNCERTAIN,
    accessoryNounTerms: DIVING_ACCESSORY_NOUN_TERMS,
  },
];

export const MAX_LIVE_CALLS_DIVING = 12;
if (SELECTED_DIVING_ITEMS.length !== MAX_LIVE_CALLS_DIVING) {
  throw new Error(`SELECTED_DIVING_ITEMS has ${SELECTED_DIVING_ITEMS.length} entries, expected ${MAX_LIVE_CALLS_DIVING}`);
}

/**
 * Three-way classification of each item using ONLY existing repo data
 * (docs/supply-sample-products.json's priorHumanReview_eitherSide +
 * csvSellerUrls/approvedListingInRepo, poc_products_10.csv, data/
 * approved-mappings.json) - no new judgment, no API call. This is
 * "1. 기존 자료 분석" / "2. 불일치·미확인·동일 상품 후보 분리", answered
 * BEFORE any live-call planning.
 */
export type PriorEvidenceBucket = "동일 상품 후보" | "미확인" | "불일치 후보";

export interface PriorEvidenceEntry {
  n: number;
  bucket: PriorEvidenceBucket;
  reason: string;
  /** Whether a live 11st/Rakuten call is even worth making - false when
   * existing data already answers the question, or already flags the
   * item as not worth pursuing (불일치 후보). */
  liveCallWorthwhile: boolean;
  /** "KR"/"JP"/"both"/"neither" - which side(s) already have a REAL
   * verified seller URL or an approved price mapping in this repo. */
  existingRealEvidence: string;
}

export const PRIOR_EVIDENCE: Record<number, PriorEvidenceEntry> = {
  13: {
    n: 13,
    bucket: "동일 상품 후보",
    reason: "priorHumanReview=none(미검토), but poc_products_10.csv row3 confirms KR(hellodiving)+JP(mic21) seller URLs with '확신도 상' - real evidence exists even though the internal baseline review never covered it.",
    liveCallWorthwhile: true,
    existingRealEvidence: "both (CSV seller URLs, no live price yet)",
  },
  14: {
    n: 14,
    bucket: "동일 상품 후보",
    reason: "JP side ALREADY APPROVED in data/approved-mappings.json (map-rakuten-garmin, JPY 187,000, via Rakuten shop 'mic21') - a real, live-verified price exists today. KR side has no approved mapping; poc_products_10.csv flags Rakuten's Garmin official store (item.rakuten.co.jp/garmin/...) as the single best Rakuten API candidate in the whole 30-item PoC, though the APPROVED mapping actually used a different shop (mic21) - worth re-confirming which shop's price is current.",
    liveCallWorthwhile: true,
    existingRealEvidence: "JP (approved mapping) + KR unconfirmed",
  },
  15: {
    n: 15,
    bucket: "동일 상품 후보",
    reason: "priorHumanReview=exact, but NAME_ONLY (no model number recorded) and no CSV seller URL on either side - the 'exact' judgment has no model-number backing, so this is a weaker 후보 than #13/#14/#20/#22/#24.",
    liveCallWorthwhile: true,
    existingRealEvidence: "neither",
  },
  16: {
    n: 16,
    bucket: "미확인",
    reason: "priorHumanReview=ambiguous (already flagged by a human as unclear which candidate matches) - DIN/Yoke + stage config ambiguity is likely the exact cause. A live call without resolving the config question first would likely reproduce the same ambiguity.",
    liveCallWorthwhile: false,
    existingRealEvidence: "neither",
  },
  17: {
    n: 17,
    bucket: "불일치 후보",
    reason: "priorHumanReview=wrong_category - a human already determined the search candidates found for this title were the WRONG product category entirely. Pursuing this further without a different search strategy would likely repeat the same miss.",
    liveCallWorthwhile: false,
    existingRealEvidence: "neither",
  },
  18: {
    n: 18,
    bucket: "동일 상품 후보",
    reason: "priorHumanReview=exact, but NAME_ONLY and no CSV seller URL - same caveat as #15.",
    liveCallWorthwhile: true,
    existingRealEvidence: "neither",
  },
  19: {
    n: 19,
    bucket: "동일 상품 후보",
    reason: "priorHumanReview=exact, but NAME_ONLY and no CSV seller URL - same caveat as #15/#18.",
    liveCallWorthwhile: true,
    existingRealEvidence: "neither",
  },
  20: {
    n: 20,
    bucket: "동일 상품 후보",
    reason: "poc_products_10.csv row10: KR(elfdive, SF-22 standard) and JP(mic21, SF0115 'J-spec') seller URLs both confirmed, but the CSV ITSELF flags a real regional-spec difference ('표준형과 사양 차이 가능성') - good candidate, but the size/color axes genuinely matter here, not just a formality.",
    liveCallWorthwhile: true,
    existingRealEvidence: "both (CSV seller URLs, known spec-variant risk)",
  },
  21: {
    n: 21,
    bucket: "불일치 후보",
    reason: "priorHumanReview=wrong_category, same reasoning as #17.",
    liveCallWorthwhile: false,
    existingRealEvidence: "neither",
  },
  22: {
    n: 22,
    bucket: "동일 상품 후보",
    reason: "poc_products_10.csv row6: KR(elfdive) confirmed with exact SKU M-1001; JP side NOT confirmed (CSV notes mic21 likely only carries a successor model, not M-1001 itself) - KR-only evidence, JP is a genuine open question for the live call.",
    liveCallWorthwhile: true,
    existingRealEvidence: "KR only",
  },
  23: {
    n: 23,
    bucket: "미확인",
    reason: "priorHumanReview=missing_source (no Rakuten/search result was ever found for this title in the whole-pool review) AND this category has the worst match rate in the entire 429-item baseline (dive_light: 2/22 exact, 9%) - very low expected value for a live call without a better search keyword first.",
    liveCallWorthwhile: false,
    existingRealEvidence: "neither",
  },
  24: {
    n: 24,
    bucket: "동일 상품 후보",
    reason: "poc_products_10.csv row4: KR(swimnara) + US-direct(TradeInn) confirmed with the SAME official SKU 412382 across BOTH - the single highest-confidence SKU match in the whole 30-item PoC pool. BUT the JP leg is CONFIRMED ABSENT (mic21 shows this exact model as discontinued/廃盤) - a real JP price for THIS SKU may not exist at all, independent of any search skill.",
    liveCallWorthwhile: true,
    existingRealEvidence: "KR + US-direct (JP confirmed absent, not just unconfirmed)",
  },
};

if (Object.keys(PRIOR_EVIDENCE).length !== MAX_LIVE_CALLS_DIVING) {
  throw new Error("PRIOR_EVIDENCE must have exactly one entry per SELECTED_DIVING_ITEMS item");
}

function printOfflinePlan() {
  console.log("=== 11st ProductSearch diving-sample(12) - OFFLINE plan (no network call) ===\n");
  const byBucket = { "동일 상품 후보": 0, 미확인: 0, "불일치 후보": 0 } as Record<PriorEvidenceBucket, number>;
  for (const item of SELECTED_DIVING_ITEMS) {
    const ev = PRIOR_EVIDENCE[item.n];
    byBucket[ev.bucket]++;
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(`  기존 자료 분류: ${ev.bucket} | 기존 실데이터: ${ev.existingRealEvidence}`);
    console.log(`  근거: ${ev.reason}`);
    console.log(`  11st 검색 키워드(안): "${item.title}"`);
    console.log(`  classifier: brandTerms=${JSON.stringify(item.brandTerms)} baseModelRequiredTerms=${JSON.stringify(item.baseModelRequiredTerms)}`);
    if (item.hardOptionGroups?.length) console.log(`  hardOptionGroups=${JSON.stringify(item.hardOptionGroups)}`);
    console.log(`  실호출 가치 있음: ${ev.liveCallWorthwhile ? "예" : "아니오 - 기존 자료로 이미 판단 가능"}`);
    console.log("");
  }
  console.log(`집계: 동일 상품 후보 ${byBucket["동일 상품 후보"]} / 미확인 ${byBucket["미확인"]} / 불일치 후보 ${byBucket["불일치 후보"]}`);
  const worthwhile = SELECTED_DIVING_ITEMS.filter((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile);
  console.log(`실호출 가치 있는 품목: ${worthwhile.length}/${MAX_LIVE_CALLS_DIVING} (나머지는 기존 자료로 이미 결론 - 재호출 안 함)`);
  console.log(
    `\n이 스크립트는 아직 아무 호출도 하지 않았습니다. 승인 후 로컬에서:\n` +
      `  ELEVENST_API_KEY=... npx tsx src/scripts/supply-diving-sample12.ts live`,
  );
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(SCRIPT_DIR, "..", "..", "local-results", "kr-11st-diving12.json");

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function toKrResultEntry(item: SelectedItem, best: ClassifiedCandidate | undefined): Record<string, unknown> {
  const reviewReason = best ? [...best.matchedExcludeTerms, ...(best.rejectedAccessoryPhrase ? [`accessory:${best.rejectedAccessoryPhrase}`] : [])] : [];
  return {
    n: item.n,
    productName: best?.product.productName,
    productCode: best?.product.productCode,
    seller: best?.product.seller,
    priceKrw: best?.product.productPrice !== undefined ? Number(best.product.productPrice) : undefined,
    salePriceKrw: best?.product.salePrice !== undefined ? Number(best.product.salePrice) : undefined,
    url: best?.product.detailPageUrl,
    classification: best?.classification ?? "MISMATCH",
    detectedOptionHints: best?.detectedOptionHints ?? [],
    deliveryUncertain: best?.matchedDeliveryUncertaintyTerms ?? [],
    reviewReason,
    humanVerified: false,
  };
}

/** NOT INVOKED by this review - preparation only (see file header's
 * "실제 API 호출은 하지 말고" constraint). Mirrors supply-11st-
 * sample10.ts's runLive() exactly, scoped to only the items
 * PRIOR_EVIDENCE flags as liveCallWorthwhile, and hard-capped at
 * MAX_LIVE_CALLS_DIVING regardless. */
async function runLive() {
  const apiKey = process.env.ELEVENST_API_KEY;
  if (!apiKey) {
    console.error("Missing ELEVENST_API_KEY - see .env.example. Not making any call.");
    process.exit(1);
  }
  const outPath = parseArg("out") ?? DEFAULT_OUT;
  const toCall = SELECTED_DIVING_ITEMS.filter((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile);
  console.log(`=== 11st ProductSearch diving-sample - LIVE run: ${toCall.length} calls (skipping ${SELECTED_DIVING_ITEMS.length - toCall.length} already answered by existing data) ===\n`);

  const entries: Record<string, unknown>[] = [];
  for (const [i, item] of toCall.entries()) {
    console.log(`[${i + 1}/${toCall.length}] #${item.n} "${item.title}"`);
    try {
      const res = await searchElevenstProduct({ apiKey }, item.title, 5);
      console.log(`  HTTP ${res.status} | TotalCount=${res.totalCount ?? "?"} | candidates=${res.products.length}`);
      const classified = res.products.map((p) => classifyCandidate(item, p));
      const best = pickBestCandidate(classified);
      entries.push(toKrResultEntry(item, best));
    } catch (err) {
      console.log(`  failed: ${err instanceof ElevenstApiError ? `HTTP ${err.status} ${err.message}` : err instanceof Error ? err.message : String(err)}`);
      entries.push(toKrResultEntry(item, undefined));
    }
    if (i < toCall.length - 1) await new Promise((r) => setTimeout(r, 1200));
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf-8");
  console.log(`\nSaved ${entries.length} entries to ${outPath}`);
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
if (invokedPath && invokedPath.endsWith("supply-diving-sample12.ts")) {
  main().catch((err) => {
    console.error("supply-diving-sample12 FAILED:", err);
    process.exit(1);
  });
}
