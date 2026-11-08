/**
 * Measures how many of the 26-item supply sample (docs/supply-sample-
 * products.json, reused as-is from the claude/tripprice-supply-validation
 * branch - not modified here) 11st's ProductSearch can actually surface,
 * for the first 10 of them (camera/camera_lens priority + a representative
 * "기타" spread: earbuds/headphones/smartwatch/beauty).
 *
 * Two modes, both read-only w.r.t. production (no DB writes, no listing
 * approval, no deploy):
 *
 *   npx tsx src/scripts/supply-11st-sample10.ts offline   (default)
 *     No network call, no API key read at all. Prints the 10-item
 *     selection and the classifier config so the matching LOGIC can be
 *     reviewed before any live call is made.
 *
 *   npx tsx src/scripts/supply-11st-sample10.ts live
 *     Requires ELEVENST_API_KEY in the environment and the explicit
 *     `live` argument - this is the "사용자의 명시적 승인" gate. Makes
 *     exactly 10 live calls (MAX_LIVE_CALLS, one per selected item,
 *     pageSize=5, 1.2s apart) and nothing more. Never reads/prints the
 *     key itself - only the adapter's already-redacted fields.
 *
 * Classification is a best-effort heuristic, not a verdict: EXACT_CANDIDATE
 * still needs a human glance at the printed productName (color/kit/
 * condition aren't fully machine-checkable - see classifyCandidate()'s own
 * comments for exactly which parts are heuristic and why).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "../match";
import { searchElevenstProduct, ElevenstApiError, type ElevenstProduct } from "../adapters/elevenst";

export interface SelectedItem {
  /** `n` in docs/supply-sample-products.json's items array. */
  n: number;
  type: string;
  title: string;
  /** OR - at least one must appear (brand is often localized to Korean on
   * 11st, e.g. "소니" not "Sony", so this is never AND'd with model terms). */
  brandTerms: string[];
  /** AND - every one of these must appear; this is what actually
   * distinguishes model/spec/generation (e.g. "XH2" vs "XH2S", "Sense2"
   * vs "Sense"), so it is intentionally NOT satisfied by a bare substring
   * of a different product's code - see each item's own comment below. */
  baseModelRequiredTerms: string[];
  /** OR, optional - alternate spellings of the same generation marker
   * (e.g. "Mark II" vs "마크2" vs "2세대") when Korean listings are likely
   * to vary; omitted when the generation is already baked into
   * baseModelRequiredTerms unambiguously. */
  generationVariants?: string[];
  /** Any hit here doesn't reject the candidate - it downgrades it to
   * NEEDS_REVIEW, surfaced for a human to read as 중고/리퍼/키트/세트 etc. */
  excludeTerms: string[];
}

const BASE_EXCLUDE = ["중고", "리퍼비시", "리퍼", "전시상품", "전시품", "대여", "렌탈"];

/**
 * The first 10 of the 26-item sample: all 6 camera/camera_lens entries
 * (task priority) plus 4 "기타" entries spanning earbuds/headphones/
 * smartwatch/beauty - chosen over diving gear because consumer
 * electronics/beauty are far more plausible on a mainstream KR
 * marketplace like 11st, and #25 (SK-II) already has an approved Coupang
 * (KR-side) listing in data/approved-mappings.json for direct comparison.
 */
export const SELECTED_ITEMS: SelectedItem[] = [
  {
    n: 1,
    type: "camera",
    title: "FUJIFILM X-T50",
    brandTerms: ["FUJIFILM", "Fuji", "후지필름", "후지"],
    baseModelRequiredTerms: ["XT50"],
    excludeTerms: [...BASE_EXCLUDE, "키트", "렌즈포함", "세트"],
  },
  {
    n: 2,
    type: "camera",
    title: "FUJIFILM X-H2",
    brandTerms: ["FUJIFILM", "Fuji", "후지필름", "후지"],
    baseModelRequiredTerms: ["XH2"],
    // X-H2S is a DIFFERENT real product whose normalized code ("xh2s")
    // contains "xh2" as a substring - without this exclude, a search for
    // "X-H2" would silently accept X-H2S listings as EXACT_CANDIDATE.
    excludeTerms: [...BASE_EXCLUDE, "XH2S", "키트", "렌즈포함", "세트"],
  },
  {
    n: 3,
    type: "camera",
    title: "Canon EOS R6 Mark II BODY",
    brandTerms: ["Canon", "캐논"],
    baseModelRequiredTerms: ["R6"],
    generationVariants: ["MarkII", "마크2", "마크II", "2세대", "M2"],
    excludeTerms: [...BASE_EXCLUDE, "키트", "렌즈포함", "세트"],
  },
  {
    n: 4,
    type: "camera_lens",
    // Same exact keyword already confirmed live in the prior 11st
    // ProductSearch verification step (HTTP 200, 1 real product found).
    title: "Sony FE 24mm F1.4 GM",
    brandTerms: ["Sony", "소니"],
    baseModelRequiredTerms: ["24mm", "F14", "GM"],
    excludeTerms: [...BASE_EXCLUDE, "세트", "필터", "후드"],
  },
  {
    n: 5,
    type: "camera_lens",
    title: "Tamron 12-20mm F2.8",
    brandTerms: ["Tamron", "탐론"],
    baseModelRequiredTerms: ["1220mm", "F28"],
    excludeTerms: [...BASE_EXCLUDE, "세트", "필터", "후드"],
  },
  {
    n: 6,
    type: "camera_lens",
    title: "Sony FE 70-200mm F2.8 GM OSS II",
    brandTerms: ["Sony", "소니"],
    baseModelRequiredTerms: ["70200mm", "F28", "GM"],
    generationVariants: ["OSSII", "2세대"],
    excludeTerms: [...BASE_EXCLUDE, "세트", "필터", "후드"],
  },
  {
    n: 7,
    type: "earbuds",
    title: "OnePlus Buds Pro 3",
    brandTerms: ["OnePlus", "원플러스"],
    baseModelRequiredTerms: ["BudsPro3"],
    excludeTerms: [...BASE_EXCLUDE, "케이스", "커버"],
  },
  {
    n: 9,
    type: "headphones",
    title: "Bowers & Wilkins Px7 S3",
    brandTerms: ["Bowers", "B&W", "바워스", "윌킨스"],
    baseModelRequiredTerms: ["Px7S3"],
    excludeTerms: [...BASE_EXCLUDE, "케이스", "커버"],
  },
  {
    n: 12,
    type: "smartwatch",
    title: "Fitbit Sense 2",
    brandTerms: ["Fitbit", "핏빗"],
    baseModelRequiredTerms: ["Sense2"],
    excludeTerms: [...BASE_EXCLUDE, "케이스", "밴드", "스트랩"],
  },
  {
    n: 25,
    type: "beauty",
    title: "SK-II Facial Treatment Essence 230ml",
    // Korean listings almost always use "피테라 에센스", never the literal
    // English "Facial Treatment Essence" (see data/approved-mappings.json's
    // map-coupang-skii, whose own searchKeywordUsed is the Korean name) -
    // so matching relies on brand + "230ml" only, not the English phrase.
    brandTerms: ["SKII", "SK2", "에스케이투", "에스케이2", "피테라"],
    baseModelRequiredTerms: ["230ml"],
    excludeTerms: [...BASE_EXCLUDE, "증정", "기획", "리필"],
  },
];

export const MAX_LIVE_CALLS = 10;
if (SELECTED_ITEMS.length !== MAX_LIVE_CALLS) {
  throw new Error(
    `SELECTED_ITEMS has ${SELECTED_ITEMS.length} entries, expected exactly ${MAX_LIVE_CALLS} - ` +
      `this script is deliberately capped; update MAX_LIVE_CALLS deliberately if the sample size changes.`,
  );
}

/** Manually cross-referenced against data/approved-mappings.json (4
 * entries total, checked by hand - not fuzzy-matched, since slug-style
 * productIds there don't line up with these titles automatically). Only
 * #25 (SK-II) has an existing approved listing, and it's KR/Coupang only -
 * no JP/Rakuten side exists in this repo's data for any of the 10. */
export const EXISTING_APPROVED_KR_JP: Record<number, { kr?: string; jp?: string }> = {
  25: { kr: "map-coupang-skii (Coupang, KRW 237,150, confidence=estimated)" },
};

export type Classification = "EXACT_CANDIDATE" | "NEEDS_REVIEW" | "MISMATCH";

export interface ClassifiedCandidate {
  product: ElevenstProduct;
  classification: Classification;
  matchedExcludeTerms: string[];
}

/**
 * Pure, offline-testable. See SelectedItem's field comments for what each
 * check is actually for - this does NOT verify color, kit contents, or new
 * vs used beyond the excludeTerms word list; EXACT_CANDIDATE means "the
 * model/spec identity looks right", not "confirmed identical listing".
 */
export function classifyCandidate(item: SelectedItem, product: ElevenstProduct): ClassifiedCandidate {
  const name = normalize(product.productName ?? "");
  const brandOk = item.brandTerms.length === 0 || item.brandTerms.some((t) => name.includes(normalize(t)));
  const baseOk = item.baseModelRequiredTerms.every((t) => name.includes(normalize(t)));
  const genOk = !item.generationVariants || item.generationVariants.some((t) => name.includes(normalize(t)));
  const matchedExcludeTerms = item.excludeTerms.filter((t) => name.includes(normalize(t)));

  if (!baseOk) return { product, classification: "MISMATCH", matchedExcludeTerms };
  if (brandOk && genOk && matchedExcludeTerms.length === 0) {
    return { product, classification: "EXACT_CANDIDATE", matchedExcludeTerms };
  }
  return { product, classification: "NEEDS_REVIEW", matchedExcludeTerms };
}

/** Picks the single best candidate to report per item: first
 * EXACT_CANDIDATE, else first NEEDS_REVIEW, else undefined (MISMATCH-only
 * or no products at all). */
export function pickBestCandidate(classified: ClassifiedCandidate[]): ClassifiedCandidate | undefined {
  return (
    classified.find((c) => c.classification === "EXACT_CANDIDATE") ??
    classified.find((c) => c.classification === "NEEDS_REVIEW")
  );
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function loadSampleItemContext(n: number): unknown {
  const path = join(SCRIPT_DIR, "..", "..", "docs", "supply-sample-products.json");
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return data.items.find((it: { n: number }) => it.n === n);
}

function printOfflinePlan() {
  console.log("=== 11st ProductSearch supply-sample(10/26) - OFFLINE plan (no network call) ===\n");
  for (const item of SELECTED_ITEMS) {
    const ctx = loadSampleItemContext(item.n) as Record<string, unknown> | undefined;
    const existing = EXISTING_APPROVED_KR_JP[item.n];
    console.log(`#${item.n} [${item.type}] ${item.title}`);
    console.log(`  11st search keyword (planned): "${item.title}"`);
    console.log(`  identifierReadiness (from sample doc): ${ctx?.identifierReadiness ?? "unknown"}`);
    console.log(`  existing KR approved listing: ${existing?.kr ?? "none"}`);
    console.log(`  existing JP approved listing: ${existing?.jp ?? "none"}`);
    console.log(`  classifier: brandTerms=${JSON.stringify(item.brandTerms)}`);
    console.log(`             baseModelRequiredTerms=${JSON.stringify(item.baseModelRequiredTerms)}`);
    if (item.generationVariants) console.log(`             generationVariants=${JSON.stringify(item.generationVariants)}`);
    console.log(`             excludeTerms=${JSON.stringify(item.excludeTerms)}`);
    console.log("");
  }
  console.log(
    `Nothing above touched the network or read ELEVENST_API_KEY. To run the ${MAX_LIVE_CALLS} live calls ` +
      `(after you've approved it, with your own re-issued key, locally):\n` +
      `  ELEVENST_API_KEY=... npx tsx src/scripts/supply-11st-sample10.ts live`,
  );
}

async function runLive() {
  const apiKey = process.env.ELEVENST_API_KEY;
  if (!apiKey) {
    console.error("Missing ELEVENST_API_KEY - see .env.example. Not making any call.");
    process.exit(1);
  }

  console.log(`=== 11st ProductSearch supply-sample(10/26) - LIVE run: exactly ${MAX_LIVE_CALLS} calls ===\n`);

  const results: Array<{
    item: SelectedItem;
    totalCount?: number;
    candidatesReturned: number;
    best?: ClassifiedCandidate;
  }> = [];

  for (const [i, item] of SELECTED_ITEMS.entries()) {
    console.log(`[${i + 1}/${MAX_LIVE_CALLS}] #${item.n} "${item.title}"`);
    try {
      const res = await searchElevenstProduct({ apiKey }, item.title, 5);
      console.log(`  HTTP ${res.status} | TotalCount=${res.totalCount ?? "?"} | candidates on page=${res.products.length}`);
      const classified = res.products.map((p) => classifyCandidate(item, p));
      const best = pickBestCandidate(classified);
      if (best) {
        console.log(
          `  best candidate: ${best.classification} | productName="${best.product.productName}" | ` +
            `productCode=${best.product.productCode} | seller=${best.product.seller} | ` +
            `price=${best.product.productPrice} saleprice=${best.product.salePrice} | url=${best.product.detailPageUrl}`,
        );
        if (best.matchedExcludeTerms.length > 0) {
          console.log(`  (flagged terms: ${best.matchedExcludeTerms.join(", ")} - needs human check)`);
        }
      } else {
        console.log("  no EXACT_CANDIDATE/NEEDS_REVIEW among returned products - MISMATCH");
      }
      results.push({ item, totalCount: res.totalCount, candidatesReturned: res.products.length, best });
    } catch (err) {
      if (err instanceof ElevenstApiError) {
        console.log(`  11st API error (HTTP ${err.status}): ${err.message}`);
      } else {
        console.log(`  request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({ item, candidatesReturned: 0 });
    }
    if (i < SELECTED_ITEMS.length - 1) await new Promise((r) => setTimeout(r, 1200));
  }

  const exact = results.filter((r) => r.best?.classification === "EXACT_CANDIDATE");
  const review = results.filter((r) => r.best?.classification === "NEEDS_REVIEW");
  const mismatch = results.length - exact.length - review.length;
  const withPrice = exact.filter((r) => r.best?.product.productPrice || r.best?.product.salePrice);
  const jpLinkable = results.filter((r) => EXISTING_APPROVED_KR_JP[r.item.n]?.jp);

  console.log("\n=== FINAL TALLY ===");
  console.log(`검색한 상품 수: ${results.length}`);
  console.log(`정확 매칭(EXACT_CANDIDATE) 수: ${exact.length}`);
  console.log(`검수 필요(NEEDS_REVIEW) 수: ${review.length}`);
  console.log(`불일치(MISMATCH/오류) 수: ${mismatch}`);
  console.log(`실제 판매처 가격 확인 수 (EXACT 중 가격 필드 존재): ${withPrice.length}`);
  console.log(`기존 JP(라쿠텐) 승인 리스팅과 연결 가능한 수: ${jpLinkable.length}`);
}

async function main() {
  const mode = process.argv[2] ?? "offline";
  if (mode === "live") {
    await runLive();
  } else if (mode === "offline") {
    printOfflinePlan();
  } else {
    console.error(`Unknown mode "${mode}" - use "offline" (default) or "live".`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("supply-11st-sample10.ts")) {
  main().catch((err) => {
    console.error("supply-11st-sample10 FAILED:", err);
    process.exit(1);
  });
}
