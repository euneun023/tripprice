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
 * (either order, optional whitespace between them), AND a regex boundary
 * against a second false-positive class: compound size codes are
 * substrings of EACH OTHER, not just of unrelated words. "사이즈S" is a
 * literal PREFIX of "사이즈SS"; "XS사이즈" contains "S사이즈" as a SUFFIX
 * (the leading "X" doesn't stop a plain .includes() check). Confirmed
 * boundary pairs: S/SS, XS/S, XL/L, XXL/XL.
 *
 * Tested against the RAW (non-normalized) product name - see
 * supply-11st-sample10.ts's classifyCandidate(), which runs
 * hardOptionGroups.patterns against rawName specifically because
 * normalize() strips every space, which would destroy the very boundary
 * ("사이즈SS BCD" vs "사이즈SSBCD" are different for this purpose, but
 * normalize() makes them identical). `\s*` allows an optional space
 * between the marker and the letter either way (사이즈 S / 사이즈S /
 * S 사이즈 / S사이즈 all count); the lookaround only blocks an
 * IMMEDIATELY ADJACENT extra Latin letter with no separator - every pair
 * above is a dedicated regression test in this file's test.
 */
function sizeTokenPatternsKr(letters: string[]): { token: string; regex: RegExp }[] {
  return letters.flatMap((letter) => [
    { token: `사이즈${letter}`, regex: new RegExp(`사이즈\\s*${letter}(?![A-Za-z])`, "i") },
    { token: `${letter}사이즈`, regex: new RegExp(`(?<![A-Za-z])${letter}\\s*사이즈`, "i") },
  ]);
}
const STANDARD_SIZE_PATTERNS_KR = sizeTokenPatternsKr(["XS", "S", "M", "L", "XL", "XXL"]);
const FIN_SIZE_PATTERNS_KR = sizeTokenPatternsKr(["SS", "S", "M", "L", "XL"]);

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
    hardOptionGroups: [{ label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_KR, soft: true }],
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
    hardOptionGroups: [{ label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_KR, soft: true }],
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
    // the KR standard SF-22. This is tracked as its OWN soft axis
    // (regional_spec) - left genuinely UNRESOLVED (해당없음/미확인) until
    // both sides' real listing text are compared, never assumed either
    // way: neither "they must be the same lens-class fin" nor "they must
    // differ" - see this file's PRIOR_EVIDENCE[20] for the same caveat.
    hardOptionGroups: [
      { label: "size", anyOf: [], patterns: FIN_SIZE_PATTERNS_KR, soft: true },
      { label: "color", anyOf: ["블랙", "Black", "블루", "Blue", "옐로우", "Yellow"], soft: true },
      { label: "regional_spec", anyOf: ["SF-22", "SF0115", "J-spec", "Jspec", "해외사양", "국내사양"], soft: true },
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
      { label: "size", anyOf: [], patterns: FIN_SIZE_PATTERNS_KR, soft: true },
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
      { label: "size", anyOf: [], patterns: STANDARD_SIZE_PATTERNS_KR, soft: true },
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
    reason:
      "poc_products_10.csv row10: KR(elfdive, SF-22 standard) and JP(mic21, SF0115 'J-spec') seller URLs both confirmed, but the CSV ITSELF flags a real regional-spec difference ('표준형과 사양 차이 가능성') - the SF-22/SF0115 question stays 미확인(unresolved) here deliberately: this review does NOT conclude they are the same product, nor that they differ - that is exactly what the new regional_spec soft axis exists to surface from the live listing text itself, not from this CSV note alone. size/color matter here too, not just a formality.",
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
    reason:
      "poc_products_10.csv row4: KR(swimnara) + US-direct(TradeInn) confirmed with the SAME official SKU 412382 across BOTH - the single highest-confidence SKU match in the whole 30-item PoC pool. The JP leg: mic21 SPECIFICALLY shows this exact model discontinued/廃盤 - that is evidence mic21 no longer carries it, NOT evidence the model is unavailable from Japan as a whole (poc_products_10.csv's own manual, single-site research already missed a real Rakuten listing once before - see supply-rakuten-diving12.ts's GULL Mantis5 note on shop 'find') - so the live Rakuten call is still worth making, not skipped on an assumption of total JP unavailability.",
    liveCallWorthwhile: true,
    existingRealEvidence: "KR + US-direct (mic21 specifically discontinued - NOT a confirmed JP-market-wide absence)",
  },
};

if (Object.keys(PRIOR_EVIDENCE).length !== MAX_LIVE_CALLS_DIVING) {
  throw new Error("PRIOR_EVIDENCE must have exactly one entry per SELECTED_DIVING_ITEMS item");
}

/**
 * Simplifies a sample title down to what a real listing's own title is
 * likely to contain, BEFORE it's used as a search keyword - never used
 * for classification (baseModelRequiredTerms/brandTerms are untouched).
 * Two concrete problems found by this review's own offline check (5.
 * "검색어의 정확성과 정규화 여부"):
 *   - a trailing parenthetical descriptor ("(Original/Standard, Black)",
 *     "(Steel/Fog Gray, 43mm)", "(Open Heel Diving Fins)") is this
 *     sample's own curation note, not how a seller titles the product -
 *     stripped entirely.
 *   - a "/" joining two alternate names ("Oceanic Zeo/FDXi") is kept as
 *     only its FIRST alternative for the one call this review's budget
 *     allows - the dropped alternative is surfaced in the offline plan
 *     output so a human can try it separately if the first finds nothing
 *     (never silently discarded without a trace).
 */
export function buildSearchKeyword(title: string): { keyword: string; droppedAlternative?: string; wasSimplified: boolean } {
  const withoutParens = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const [first, ...rest] = withoutParens.split("/").map((s) => s.trim());
  const droppedAlternative = rest.length > 0 ? rest.join("/") : undefined;
  const keyword = first || title;
  return { keyword, droppedAlternative, wasSimplified: keyword !== title };
}

/**
 * KR-side note on the same keyword simplification: 11st's own search is
 * far less likely to miss results over language (model codes/brand names
 * are routinely kept in Latin on Korean listings too, already confirmed
 * for the camera sample - see supply-11st-sample10.ts's brandTerms
 * comments), so no additional language-risk note is added here; the
 * language-coverage risk this review flagged is specifically about the
 * JAPANESE side - see supply-rakuten-diving12.ts's own note.
 */
function printOfflinePlan() {
  console.log("=== 11st ProductSearch diving-sample(12) - OFFLINE plan (no network call) ===\n");
  const byBucket = { "동일 상품 후보": 0, 미확인: 0, "불일치 후보": 0 } as Record<PriorEvidenceBucket, number>;
  for (const item of SELECTED_DIVING_ITEMS) {
    const ev = PRIOR_EVIDENCE[item.n];
    byBucket[ev.bucket]++;
    const { keyword, droppedAlternative, wasSimplified } = buildSearchKeyword(item.title);
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(`  기존 자료 분류: ${ev.bucket} | 기존 실데이터: ${ev.existingRealEvidence}`);
    console.log(`  근거: ${ev.reason}`);
    console.log(
      wasSimplified
        ? `  11st 검색 키워드(정규화됨): "${keyword}" (원본 제목: "${item.title}")`
        : `  11st 검색 키워드(원본 그대로): "${keyword}"`,
    );
    if (droppedAlternative) console.log(`    (검색에서 제외된 대안명: "${droppedAlternative}" - 1차 검색 결과 없으면 수동으로 추가 시도 권장)`);
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

/** One preserved candidate, kept even when it's MISMATCH/REJECTED_
 * ACCESSORY - so a human reading the saved JSON can see exactly WHY a
 * candidate was excluded, not just that it was. */
export interface DivingCandidateEntry {
  productName?: string;
  productCode?: string;
  seller?: string;
  priceKrw?: number;
  salePriceKrw?: number;
  url?: string;
  classification: string;
  detectedOptionHints: string[];
  deliveryUncertain: string[];
  reviewReason: string[];
}

export type DivingCallStatus = "ok" | "no_results" | "call_failed" | "all_candidates_rejected";

function toCandidateEntry(c: ClassifiedCandidate): DivingCandidateEntry {
  return {
    productName: c.product.productName,
    productCode: c.product.productCode,
    seller: c.product.seller,
    priceKrw: c.product.productPrice !== undefined ? Number(c.product.productPrice) : undefined,
    salePriceKrw: c.product.salePrice !== undefined ? Number(c.product.salePrice) : undefined,
    url: c.product.detailPageUrl,
    classification: c.classification,
    detectedOptionHints: c.detectedOptionHints,
    deliveryUncertain: c.matchedDeliveryUncertaintyTerms,
    reviewReason: [...c.matchedExcludeTerms, ...(c.rejectedAccessoryPhrase ? [`accessory:${c.rejectedAccessoryPhrase}`] : [])],
  };
}

/**
 * Saves ALL returned candidates (up to 5 - pageSize is already capped at
 * 5 in the live call below, never raised to "get more") as `candidates`,
 * while keeping every existing top-level field (productName/url/price/
 * classification/...) mirroring the `best` one for backward
 * compatibility with compare-kr-jp-sample10.ts's KrResultEntry schema -
 * existing readers that only look at the top level see no change.
 * `callStatus` distinguishes exactly what requirement 1 asked for:
 * an API error, zero results, and "results came back but none were a
 * plausible candidate" are three different situations, not one.
 */
export function toKrResultEntry(
  item: SelectedItem,
  outcome: { status: "ok"; totalCount?: number; classified: ClassifiedCandidate[] } | { status: "call_failed"; errorMessage: string },
): Record<string, unknown> {
  if (outcome.status === "call_failed") {
    return { n: item.n, callStatus: "call_failed" as DivingCallStatus, errorMessage: outcome.errorMessage, candidates: [], humanVerified: false };
  }
  const candidates = outcome.classified.map(toCandidateEntry);
  const best = pickBestCandidate(outcome.classified);
  const callStatus: DivingCallStatus = candidates.length === 0 ? "no_results" : best ? "ok" : "all_candidates_rejected";
  const bestEntry = best ? toCandidateEntry(best) : undefined;
  return {
    n: item.n,
    callStatus,
    totalCount: outcome.totalCount,
    // top-level fields mirror `best` for backward compatibility with
    // existing KrResultEntry readers - unset (undefined) when there's no
    // best candidate (no_results / all_candidates_rejected), never
    // fabricated.
    productName: bestEntry?.productName,
    productCode: bestEntry?.productCode,
    seller: bestEntry?.seller,
    priceKrw: bestEntry?.priceKrw,
    salePriceKrw: bestEntry?.salePriceKrw,
    url: bestEntry?.url,
    classification: bestEntry?.classification ?? (candidates.length === 0 ? undefined : "MISMATCH"),
    detectedOptionHints: bestEntry?.detectedOptionHints ?? [],
    deliveryUncertain: bestEntry?.deliveryUncertain ?? [],
    reviewReason: bestEntry?.reviewReason ?? [],
    candidates,
    humanVerified: false,
  };
}

/** NOT INVOKED by this review - preparation only (see file header's
 * "실제 API 호출은 하지 말고" constraint). Mirrors supply-11st-
 * sample10.ts's runLive() exactly, scoped to only the items
 * PRIOR_EVIDENCE flags as liveCallWorthwhile, and hard-capped at
 * MAX_LIVE_CALLS_DIVING regardless. Uses buildSearchKeyword() (see above)
 * for the actual search string sent, never the raw sample title. */
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
    const { keyword } = buildSearchKeyword(item.title);
    console.log(`[${i + 1}/${toCall.length}] #${item.n} "${item.title}"${keyword !== item.title ? ` (검색어: "${keyword}")` : ""}`);
    try {
      const res = await searchElevenstProduct({ apiKey }, keyword, 5);
      console.log(`  HTTP ${res.status} | TotalCount=${res.totalCount ?? "?"} | candidates=${res.products.length}`);
      const classified = res.products.map((p) => classifyCandidate(item, p));
      entries.push(toKrResultEntry(item, { status: "ok", totalCount: res.totalCount, classified }));
    } catch (err) {
      const errorMessage = err instanceof ElevenstApiError ? `HTTP ${err.status} ${err.message}` : err instanceof Error ? err.message : String(err);
      console.log(`  failed: ${errorMessage}`);
      entries.push(toKrResultEntry(item, { status: "call_failed", errorMessage }));
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
