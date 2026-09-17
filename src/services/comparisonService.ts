/**
 * Price comparison engine. Deliberately depends ONLY on SourceListingRepository
 * - it has no import path to affiliate_programs or anything commission-related.
 * That is not an accident: ranking must be computed from real prices alone
 * (Phase 1 request: "commission rate / affiliate 여부 / sponsored 여부를
 * 사용해 winner를 결정하지 마세요").
 *
 * No hardcoded assumption of "KR/직구/JP" - this just groups whatever active
 * source_listings exist for the variant, by however many there are.
 *
 * Unavailable legs (last_known_availability === false) are excluded from the
 * comparison entirely - an out-of-stock offer can't be a real "winner", and
 * with it removed the remaining legs are compared exactly as if it never
 * existed (2 legs left -> normal n-way over those 2, no special-casing).
 */
import { convertToKrw } from "../domain/pricing";
import type { Repositories } from "../repository/types";
import type { SourceListing } from "../domain/types";

export interface ComparisonLeg {
  sourceListingId: string;
  sourceId: string;
  price: number;
  currency: string;
  krwPrice: number;
  availability: boolean | null;
  isWinner: boolean;
  /** krwPrice - winnerKrwPrice (0 for the winner itself) */
  diffFromWinnerKrw: number;
  /** how much cheaper this leg is than the most expensive available leg (0 for the highest-priced leg) */
  savingsVsHighestKrw: number;
  /** null for KRW legs (no conversion needed) */
  fxRateUsed: number | null;
  /** when that rate was fetched - null for KRW legs */
  fxAsOf: string | null;
}

export type ComparisonMode = "no-data" | "single" | "n-way";

export interface ComparisonResult {
  productVariantId: string;
  mode: ComparisonMode;
  legCount: number;
  legs: ComparisonLeg[];
}

export async function compareVariant(
  repos: Pick<Repositories, "sourceListings">,
  productVariantId: string,
): Promise<ComparisonResult> {
  // reviewRequired listings (NOT_FOUND/PRICE_JUMP/OUT_OF_STOCK/AMBIGUOUS_MATCH/
  // STALE - see ReviewReason) are excluded from ranking/winner selection:
  // their lastKnownPrice is unconfirmed as of the last refresh attempt, so
  // it must never win a comparison or be silently blended into savings math.
  // The caller (product page) is expected to show these separately as
  // "확인 중", not as a normal priced leg - see ViewItemTracker's sibling
  // page code.
  const listings = (await repos.sourceListings.listByVariant(productVariantId)).filter(
    (l): l is SourceListing & { lastKnownPrice: number } =>
      l.lastKnownPrice !== null && l.lastKnownAvailability !== false && !l.reviewRequired,
  );

  if (listings.length === 0) {
    return { productVariantId, mode: "no-data", legCount: 0, legs: [] };
  }

  const legs: ComparisonLeg[] = [];
  for (const listing of listings) {
    const currency = listing.lastKnownCurrency ?? "KRW";
    const { krwPrice, fxRateUsed, fxAsOf } = await convertToKrw(listing.lastKnownPrice, currency);
    legs.push({
      sourceListingId: listing.id,
      sourceId: listing.sourceId,
      price: listing.lastKnownPrice,
      currency,
      krwPrice,
      availability: listing.lastKnownAvailability,
      isWinner: false,
      diffFromWinnerKrw: 0,
      savingsVsHighestKrw: 0,
      fxRateUsed: currency === "KRW" ? null : fxRateUsed,
      fxAsOf,
    });
  }

  legs.sort((a, b) => a.krwPrice - b.krwPrice);
  const winnerPrice = legs[0].krwPrice;
  const highestPrice = legs[legs.length - 1].krwPrice;
  for (const leg of legs) {
    leg.isWinner = leg.krwPrice === winnerPrice;
    leg.diffFromWinnerKrw = leg.krwPrice - winnerPrice;
    leg.savingsVsHighestKrw = highestPrice - leg.krwPrice;
  }

  return {
    productVariantId,
    mode: legs.length === 1 ? "single" : "n-way",
    legCount: legs.length,
    legs,
  };
}
