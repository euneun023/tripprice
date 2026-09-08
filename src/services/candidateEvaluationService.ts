/**
 * Candidate Evaluator v0 - in-memory, dry-run only. Never writes to the DB,
 * never calls approveListing()/CanonicalProductRepository, never touches the
 * existing seed-product/approve/admin flows. Scores a Rakuten+Coupang
 * candidate pair and produces ADD/REVIEW/SKIP for a human to act on.
 *
 * Reuses existing conventions rather than inventing new ones:
 *  - savingKrw/savingPercent follow comparisonService.ts's
 *    savingsVsHighestKrw convention (higher leg minus lower leg).
 *  - KRW conversion goes through the same convertToKrw() used by
 *    comparisonService/mappingService/refreshService (injectable here so
 *    tests never hit the real fx adapter).
 *  - normalize() is the same string-normalization searchAliases.ts uses.
 *  - riskFlags reuse RiskFlag/RiskFlagType from domain/riskFlags.ts, but
 *    this file defines its OWN candidate-specific blocking/review split -
 *    riskFlags.ts's global isBlockingRisk() (used for already-registered
 *    variants) is untouched and NOT reused for this decision, because its
 *    blocking set (which includes language_limitation) differs on purpose
 *    from the candidate-stage rule below (language_limitation -> REVIEW,
 *    not SKIP, at the pre-registration stage).
 */
import type { RakutenItem } from "../adapters/rakuten";
import type { CoupangProduct } from "../adapters/coupang";
import type { RiskFlag, RiskFlagType } from "../domain/riskFlags";
import { RISK_FLAG_LABELS } from "../domain/riskFlags";
import { isProductType, normalize } from "../domain/searchAliases";
import { convertToKrw } from "../domain/pricing";

export type CandidateConfidence = "verified" | "estimated";

export interface CandidateEvaluationInput {
  /** intended canonical_products.official_name - not yet in the DB */
  productName: string;
  /** validated against PRODUCT_TYPES below; a non-member value is a hard-gate SKIP */
  productType: string;

  /** null means "no candidate found on this source" - triggers the single-source hard gate */
  rakuten: Pick<RakutenItem, "itemName" | "itemPrice" | "itemUrl"> | null;
  coupang: Pick<CoupangProduct, "productName" | "productPrice" | "productUrl"> | null;

  /** manufacturer SKU/model hint - RakutenItem/CoupangProduct carry no such field, this can only come from the operator */
  modelSkuHint?: string | null;
  /** operator's pre-registration judgment - mirrors source_listings.confidence, but supplied before any DB row exists */
  matchConfidence?: CandidateConfidence | null;
  riskFlags?: RiskFlag[];
}

export type CandidateDecision = "ADD" | "REVIEW" | "SKIP";

export interface CandidateEvaluationResult {
  productName: string;
  productType: string;
  rakuten: CandidateEvaluationInput["rakuten"];
  coupang: CandidateEvaluationInput["coupang"];
  rakutenKrw: number | null;
  coupangKrw: number | null;
  savingKrw: number | null;
  savingPercent: number | null;
  priceScore: number;
  matchScore: number;
  coverageScore: number;
  riskFlags: RiskFlag[];
  totalScore: number;
  decision: CandidateDecision;
  reasons: string[];
}

/** Score thresholds - named constants so they can be retuned without touching the decision logic itself. */
export const ADD_SCORE_THRESHOLD = 70;
export const REVIEW_SCORE_THRESHOLD = 40;

/** Candidate-stage risk gating. Distinct from riskFlags.ts's global isBlockingRisk() on purpose - see file header. */
const CANDIDATE_BLOCKING_RISK_TYPES: ReadonlySet<RiskFlagType> = new Set([
  "region_lock",
  "voltage_issue",
  "variant_mismatch",
  "discontinued",
]);
const CANDIDATE_REVIEW_RISK_TYPES: ReadonlySet<RiskFlagType> = new Set([
  "language_limitation",
  "warranty_warning",
]);

/** A1: percentage-gap tier (0-25). savingPercent follows comparisonService's convention: savingKrw / higherKrw * 100. */
export function priceGapPercentScore(savingPercent: number): number {
  if (savingPercent >= 30) return 25;
  if (savingPercent >= 20) return 20;
  if (savingPercent >= 12) return 15;
  if (savingPercent >= 7) return 10;
  if (savingPercent >= 3) return 5;
  return 0;
}

/** A2: absolute-KRW-saving tier (0-25). Independent of A1 on purpose - a large absolute saving scores well even at a small percentage gap. */
export function absoluteSavingScore(savingKrw: number): number {
  if (savingKrw >= 300_000) return 25;
  if (savingKrw >= 150_000) return 20;
  if (savingKrw >= 80_000) return 15;
  if (savingKrw >= 30_000) return 10;
  if (savingKrw >= 10_000) return 5;
  return 0;
}

/** Token-overlap ratio between two titles, using normalize() (searchAliases.ts) then whitespace-splitting.
 * Divides by the SHORTER title's token count (not union/Jaccard) - Rakuten shop titles tend to be long and
 * noisy, so "how much of the shorter title's tokens show up in the other" is more forgiving than a strict
 * Jaccard index would be. */
export function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(normalize(a).toLowerCase().split(" ").filter(Boolean));
  const tokensB = new Set(normalize(b).toLowerCase().split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  return intersection / Math.min(tokensA.size, tokensB.size);
}

/** B1: name/identifier match (0-15). An exact modelSkuHint match on both titles is treated as the strongest
 * possible signal (capped at the same 15 a high token-overlap would get) since RakutenItem/CoupangProduct
 * carry no manufacturer SKU field of their own - this is the closest a candidate can get to "exact match". */
export function nameMatchScore(rakutenTitle: string, coupangTitle: string, modelSkuHint: string | null | undefined): number {
  if (modelSkuHint) {
    const hint = modelSkuHint.toLowerCase();
    if (rakutenTitle.toLowerCase().includes(hint) && coupangTitle.toLowerCase().includes(hint)) return 15;
  }
  const overlap = tokenOverlapRatio(rakutenTitle, coupangTitle);
  if (overlap >= 0.6) return 12;
  if (overlap >= 0.4) return 8;
  if (overlap >= 0.2) return 4;
  return 0;
}

/** B2: operator-declared confidence (0-15). Mirrors source_listings.confidence, judged pre-registration. */
export function confidenceScore(matchConfidence: CandidateConfidence | null | undefined): number {
  if (matchConfidence === "verified") return 15;
  if (matchConfidence === "estimated") return 7;
  return 0;
}

/** C: product_type coverage tier (0-20), keyed by gap = thisType's count - the current minimum count across
 * all types. Tiered rather than a raw 1/count formula on purpose (see the design discussion this follows) -
 * a pure inverse-count score would keep over-favoring whichever type happens to be smallest indefinitely. */
export function coverageGapScore(gap: number): number {
  if (gap <= 0) return 20;
  if (gap === 1) return 15;
  if (gap === 2) return 10;
  if (gap === 3) return 5;
  return 0;
}

function minCount(countByType: Record<string, number>): number {
  const values = Object.values(countByType);
  return values.length === 0 ? 0 : Math.min(...values);
}

export function computeCoverageScore(productType: string, countByType: Record<string, number>): number {
  const count = countByType[productType] ?? 0;
  const gap = count - minCount(countByType);
  return coverageGapScore(gap);
}

/** Injectable so tests never hit the real fx adapter - defaults to the actual convertToKrw() (domain/pricing.ts)
 * for production use, matching this repo's sleepFn-injection convention (see refreshJobService.ts). */
export type ConvertToKrwFn = (price: number, currency: string) => Promise<{ krwPrice: number; fxRateUsed: number; fxAsOf: string | null }>;

function buildSkipResult(input: CandidateEvaluationInput, reasons: string[]): CandidateEvaluationResult {
  return {
    productName: input.productName,
    productType: input.productType,
    rakuten: input.rakuten,
    coupang: input.coupang,
    rakutenKrw: null,
    coupangKrw: null,
    savingKrw: null,
    savingPercent: null,
    priceScore: 0,
    matchScore: 0,
    coverageScore: 0,
    riskFlags: input.riskFlags ?? [],
    totalScore: 0,
    decision: "SKIP",
    reasons,
  };
}

export async function evaluateCandidate(
  input: CandidateEvaluationInput,
  countByType: Record<string, number>,
  convertFn: ConvertToKrwFn = convertToKrw,
): Promise<CandidateEvaluationResult> {
  // ---- Hard gate: structural SKIPs, collected together, no scoring attempted ----
  const gateReasons: string[] = [];
  if (!input.rakuten || !input.coupang) {
    gateReasons.push("Rakuten 또는 Coupang 후보가 없음 - 비교 불가");
  } else {
    if (!(input.rakuten.itemPrice > 0)) gateReasons.push("Rakuten 가격이 없거나 0 이하");
    if (!(input.coupang.productPrice > 0)) gateReasons.push("Coupang 가격이 없거나 0 이하");
  }
  if (!isProductType(input.productType)) {
    gateReasons.push(`허용되지 않은 product_type: "${input.productType}"`);
  }

  const riskFlags = input.riskFlags ?? [];
  const blockingFlags = riskFlags.filter((f) => CANDIDATE_BLOCKING_RISK_TYPES.has(f.type));
  for (const f of blockingFlags) {
    gateReasons.push(`risk(blocking): ${RISK_FLAG_LABELS[f.type]}`);
  }

  if (gateReasons.length > 0) {
    return buildSkipResult(input, gateReasons);
  }

  // Past the hard gate: input.rakuten/input.coupang are guaranteed non-null.
  const rakuten = input.rakuten!;
  const coupang = input.coupang!;

  // ---- Price comparison (A) - rakuten is always JPY, coupang always KRW; neither
  // adapter's response type carries a currency field of its own to read instead. ----
  let rakutenKrw: number | null = null;
  let coupangKrw: number | null = null;
  let savingKrw: number | null = null;
  let savingPercent: number | null = null;
  let priceScore = 0;
  let fxFailed = false;

  try {
    const [rk, ck] = await Promise.all([convertFn(rakuten.itemPrice, "JPY"), convertFn(coupang.productPrice, "KRW")]);
    rakutenKrw = rk.krwPrice;
    coupangKrw = ck.krwPrice;
    const higher = Math.max(rakutenKrw, coupangKrw);
    const lower = Math.min(rakutenKrw, coupangKrw);
    savingKrw = higher - lower;
    savingPercent = (savingKrw / higher) * 100;
    priceScore = priceGapPercentScore(savingPercent) + absoluteSavingScore(savingKrw);
  } catch {
    fxFailed = true;
  }

  // ---- Match certainty (B) ----
  const matchScore1 = nameMatchScore(rakuten.itemName, coupang.productName, input.modelSkuHint);
  const matchScore2 = confidenceScore(input.matchConfidence);
  const matchScore = matchScore1 + matchScore2;
  const matchUncertain = matchScore1 === 0 && !input.modelSkuHint;

  // ---- Coverage (C) ----
  const coverageScore = computeCoverageScore(input.productType, countByType);

  const totalScore = priceScore + matchScore + coverageScore;

  // ---- Decision ----
  const reasons: string[] = [];
  const reviewRiskFlags = riskFlags.filter((f) => CANDIDATE_REVIEW_RISK_TYPES.has(f.type));
  for (const f of reviewRiskFlags) reasons.push(`risk(review): ${RISK_FLAG_LABELS[f.type]}`);
  if (fxFailed) reasons.push("KRW 환산 실패 - 재시도 필요");
  if (matchUncertain) reasons.push("이름 매칭 불확실하고 modelSkuHint도 없음 - 사람 확인 필요");

  let decision: CandidateDecision;
  if (reviewRiskFlags.length > 0 || fxFailed || matchUncertain) {
    decision = "REVIEW";
  } else if (totalScore < REVIEW_SCORE_THRESHOLD) {
    decision = "SKIP";
    reasons.push(`totalScore ${totalScore} < ${REVIEW_SCORE_THRESHOLD}`);
  } else if (totalScore >= ADD_SCORE_THRESHOLD && input.matchConfidence === "verified") {
    decision = "ADD";
  } else {
    decision = "REVIEW";
    if (totalScore >= ADD_SCORE_THRESHOLD) {
      reasons.push(`totalScore ${totalScore} >= ${ADD_SCORE_THRESHOLD}이지만 matchConfidence가 "verified"가 아니라 ADD 불가`);
    } else {
      reasons.push(`totalScore ${totalScore} - REVIEW 구간(${REVIEW_SCORE_THRESHOLD}~${ADD_SCORE_THRESHOLD - 1})`);
    }
  }

  return {
    productName: input.productName,
    productType: input.productType,
    rakuten,
    coupang,
    rakutenKrw,
    coupangKrw,
    savingKrw,
    savingPercent,
    priceScore,
    matchScore,
    coverageScore,
    riskFlags,
    totalScore,
    decision,
    reasons,
  };
}

// ---------------------------------------------------------------------
// selectCandidates(): greedy top-N selection with live coverage recompute.
// Input is assumed to already be exactly the eligible pool (original ADD
// results plus whatever REVIEW results a human has separately approved) -
// this function does NOT look at `.decision` and does NOT auto-approve
// anything; it only orders and picks, all in memory. No DB write, no call
// to seed-product/approve/CanonicalProductRepository anywhere in this file.
// ---------------------------------------------------------------------

export interface CandidateSelectionResult {
  /** in selection order; coverageScore/totalScore reflect the virtual count AT THE MOMENT each was picked */
  selected: CandidateEvaluationResult[];
  /** whatever didn't make the cut (targetCount reached, or pool exhausted first); scores reflect the final virtual counts */
  remaining: CandidateEvaluationResult[];
}

/**
 * `initialCountByType` should include every entry `countByType` normally would (see computeCoverageScore) -
 * a productType missing from it is treated as count 0, same as evaluateCandidate().
 */
export function selectCandidates(
  candidates: CandidateEvaluationResult[],
  targetCount: number,
  initialCountByType: Record<string, number>,
): CandidateSelectionResult {
  const countByType: Record<string, number> = { ...initialCountByType };
  const pool = candidates.map((c) => ({ ...c }));
  const selected: CandidateEvaluationResult[] = [];

  while (selected.length < targetCount && pool.length > 0) {
    for (const c of pool) {
      c.coverageScore = computeCoverageScore(c.productType, countByType);
      c.totalScore = c.priceScore + c.matchScore + c.coverageScore;
    }
    pool.sort((a, b) => b.totalScore - a.totalScore);
    const next = pool.shift()!;
    selected.push(next);
    countByType[next.productType] = (countByType[next.productType] ?? 0) + 1;
  }

  return { selected, remaining: pool };
}
