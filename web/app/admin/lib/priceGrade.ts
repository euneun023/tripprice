/**
 * Read-only price-merit grading for the admin price-grades list. Computes
 * from data already stored (source_listings) via the existing comparison
 * engine - never fetches a seller API itself, never writes anything.
 *
 * Three concerns are deliberately kept separate rather than folded into one
 * grade letter:
 *   - rawPriceGrade: A/B/C/N-A, price numbers only.
 *   - freshness: fresh/stale, from last_success_at vs stale_after_hours -
 *     the exact staleness rule refreshService.sweepStaleListings() already
 *     uses, just read here instead of written.
 *   - riskWarnings: manually-curated same-product risk (src/domain/riskFlags.ts).
 * `actionable` is the single boolean that folds all three together for the
 * "is this really a safe A to act on" question - see computeActionable().
 */
import { compareVariant, type ComparisonLeg } from "@core/services/comparisonService";
import type { Repositories } from "@core/repository/types";
import type { CanonicalProduct, ProductVariant, SourceListing } from "@core/domain/types";
import { getRiskFlags, isBlockingRisk, type RiskFlag } from "@core/domain/riskFlags";

export type RawPriceGrade = "A" | "B" | "C" | "N/A";
export type Freshness = "fresh" | "stale" | null;

const A_MIN_GAP_KRW = 50_000;
const A_MIN_GAP_PERCENT = 10;

/**
 * Pure price-only grade - no DB/network access, no knowledge of risk or
 * freshness. Boundary is inclusive on both sides (>=), per spec: exactly
 * 50,000원 / exactly 10% qualifies for A.
 */
export function gradeFromGap(gapKrw: number | null, gapPercent: number | null): { grade: RawPriceGrade; reason: string } {
  if (gapKrw === null || gapPercent === null) {
    return { grade: "N/A", reason: "한국 또는 일본 쪽 유효 가격 정보가 없음" };
  }
  if (gapKrw <= 0) {
    return { grade: "C", reason: "일본이 한국과 같거나 더 비쌈" };
  }
  if (gapKrw >= A_MIN_GAP_KRW && gapPercent >= A_MIN_GAP_PERCENT) {
    return { grade: "A", reason: `일본이 ${gapPercent.toFixed(1)}% (${Math.round(gapKrw).toLocaleString()}원) 저렴 - A 기준(10%/5만원) 충족` };
  }
  return {
    grade: "B",
    reason: `일본이 저렴하지만 A 기준(10%·5만원) 미충족 (${gapPercent.toFixed(1)}%, ${Math.round(gapKrw).toLocaleString()}원)`,
  };
}

/**
 * A stays A even when stale or risky - rawPriceGrade never changes because
 * of risk/freshness (those are separate axes). `actionable` is what the "A"
 * filter and any future auto-surfacing should key off, never rawPriceGrade
 * alone. warranty_warning never affects this.
 */
export function computeActionable(grade: RawPriceGrade, freshness: Freshness, riskWarnings: RiskFlag[]): boolean {
  if (grade !== "A") return false;
  if (freshness === "stale") return false;
  if (riskWarnings.some((f) => isBlockingRisk(f.type))) return false;
  return true;
}

/**
 * comparison.legs is sorted ascending by krwPrice, but nothing guarantees
 * only one listing per region - two Coupang listings for one variant, say.
 * web/app/(site)/lib/conclusion.ts's legsByRegion() keeps the LAST leg seen
 * per region while iterating that ascending order, i.e. the MOST expensive
 * one when a region has >1 leg - fine for its current single-KR/single-JP
 * use, wrong for grading. This picks the cheapest leg per region explicitly.
 */
function cheapestLegByRegion(
  legs: ComparisonLeg[],
  regionOf: (sourceId: string) => string | undefined,
): Record<string, ComparisonLeg> {
  const best: Record<string, ComparisonLeg> = {};
  for (const leg of legs) {
    const region = regionOf(leg.sourceId);
    if (!region) continue;
    if (!best[region] || leg.krwPrice < best[region].krwPrice) {
      best[region] = leg;
    }
  }
  return best;
}

/** Same staleness rule as refreshService.sweepStaleListings() - read-only
 * here (never writes review_required/review_reason like that sweep does). */
function isStaleListing(listing: SourceListing | undefined, nowMs: number): boolean {
  if (!listing) return false;
  if (!listing.lastSuccessAt) return true;
  const ageHours = (nowMs - new Date(listing.lastSuccessAt).getTime()) / (1000 * 60 * 60);
  return ageHours > listing.staleAfterHours;
}

export interface PriceMeritRow {
  product: CanonicalProduct;
  variant: ProductVariant;
  krLeg: ComparisonLeg | null;
  jpLeg: ComparisonLeg | null;
  gapKrw: number | null;
  gapPercent: number | null;
  rawPriceGrade: RawPriceGrade;
  reason: string;
  freshness: Freshness;
  staleSides: Array<"KR" | "JP">;
  riskWarnings: RiskFlag[];
  actionable: boolean;
  /** most recent last_success_at among the legs actually used for this row */
  lastUpdatedAt: string | null;
  fxRateUsed: number | null;
  fxAsOf: string | null;
  /** set when compareVariant() itself threw (e.g. FX lookup failure) - the
   * row still renders as N/A instead of taking down the whole page. */
  error: string | null;
}

export async function listPriceMeritOverview(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources">,
  now: Date = new Date(),
): Promise<PriceMeritRow[]> {
  const [pairs, sources] = await Promise.all([repos.canonicalProducts.listAllVariants(), repos.sources.listAll()]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const regionOf = (sourceId: string) => sourceById.get(sourceId)?.region;
  const nowMs = now.getTime();

  return Promise.all(
    pairs.map(async ({ product, variant }): Promise<PriceMeritRow> => {
      const riskWarnings = getRiskFlags(variant.id);

      let comparison: Awaited<ReturnType<typeof compareVariant>> | null = null;
      let error: string | null = null;
      try {
        comparison = await compareVariant(repos, variant.id);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      if (error || !comparison) {
        return {
          product,
          variant,
          krLeg: null,
          jpLeg: null,
          gapKrw: null,
          gapPercent: null,
          rawPriceGrade: "N/A",
          reason: "가격 비교 계산 실패(환율 조회 등)",
          freshness: null,
          staleSides: [],
          riskWarnings,
          actionable: false,
          lastUpdatedAt: null,
          fxRateUsed: null,
          fxAsOf: null,
          error,
        };
      }

      const best = cheapestLegByRegion(comparison.legs, regionOf);
      const krLeg = best.KR ?? null;
      const jpLeg = best.JP ?? null;

      let gapKrw: number | null = null;
      let gapPercent: number | null = null;
      if (krLeg && jpLeg && krLeg.krwPrice > 0) {
        gapKrw = krLeg.krwPrice - jpLeg.krwPrice;
        gapPercent = (gapKrw / krLeg.krwPrice) * 100;
      }

      const { grade: rawPriceGrade, reason } = gradeFromGap(gapKrw, gapPercent);

      // ComparisonLeg only carries sourceListingId/krwPrice - lastSuccessAt
      // and staleAfterHours live on the raw listing, so it's fetched
      // separately (same double-fetch pattern the public product page
      // already uses: listByVariant() + compareVariant() side by side).
      const listings = await repos.sourceListings.listByVariant(variant.id);
      const listingById = new Map(listings.map((l) => [l.id, l]));
      const krListing = krLeg ? listingById.get(krLeg.sourceListingId) : undefined;
      const jpListing = jpLeg ? listingById.get(jpLeg.sourceListingId) : undefined;

      const staleSides: Array<"KR" | "JP"> = [];
      if (isStaleListing(krListing, nowMs)) staleSides.push("KR");
      if (isStaleListing(jpListing, nowMs)) staleSides.push("JP");
      const freshness: Freshness = krListing || jpListing ? (staleSides.length > 0 ? "stale" : "fresh") : null;

      const lastUpdatedAt =
        [krListing?.lastSuccessAt, jpListing?.lastSuccessAt].filter((x): x is string => !!x).sort().at(-1) ?? null;

      const actionable = computeActionable(rawPriceGrade, freshness, riskWarnings);

      return {
        product,
        variant,
        krLeg,
        jpLeg,
        gapKrw,
        gapPercent,
        rawPriceGrade,
        reason,
        freshness,
        staleSides,
        riskWarnings,
        actionable,
        lastUpdatedAt,
        fxRateUsed: jpLeg?.fxRateUsed ?? null,
        fxAsOf: jpLeg?.fxAsOf ?? null,
        error: null,
      };
    }),
  );
}
