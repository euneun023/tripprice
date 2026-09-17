/**
 * Phase 2-F1: comparison semantics hardening (see the read-only Phase 2-F0
 * audit this follows). Replaces "pick the cheapest leg across all sources"
 * with an explicit per-market eligibility -> grouping -> compare pipeline,
 * so a market with 2+ still-unresolved active listings can never silently
 * have one of them picked as "the" price, and a comparison built from an
 * `estimated`-confidence match can never be presented as a savings claim.
 *
 * marketKey is `sources.region` (KR/JP/INTL) - never inferred from
 * currency, never sourceId directly (see F0's marketKey design note): a
 * future second source in the same region groups into the same MarketQuote
 * automatically.
 */
import type { Confidence, Region, ShippingStatus, SourceListing } from "../domain/types";
import { convertToKrw } from "../domain/pricing";

export interface Offer {
  sourceListingId: string;
  sourceId: string;
  region: Region;
  price: number | null;
  currency: string | null;
  availability: boolean | null;
  reviewRequired: boolean;
  confidence: Confidence;
  shippingStatus: ShippingStatus;
  sourceUrl: string | null;
}

export type OfferIneligibilityReason = "review_required" | "no_price" | "no_currency" | "unavailable";

export interface OfferEligibility {
  eligible: boolean;
  reasons: OfferIneligibilityReason[];
}

/**
 * The ONLY hard gates (F0 section A): reviewRequired=false, a real
 * price+currency, and availability !== false (unknown/null availability
 * still passes - it has never been observed as unavailable). Deliberately
 * does NOT gate on confidence/freshness/condition/bundle/mount - F0 found
 * no persisted data backs those for most listings, so hard-gating on them
 * would silently exclude nearly everything. Those stay informational only,
 * folded into MarketQuote.allVerified / the comparison mode instead.
 */
export function evaluateOfferEligibility(offer: Offer): OfferEligibility {
  const reasons: OfferIneligibilityReason[] = [];
  if (offer.reviewRequired) reasons.push("review_required");
  if (offer.price === null || offer.price <= 0) reasons.push("no_price");
  if (!offer.currency) reasons.push("no_currency");
  if (offer.availability === false) reasons.push("unavailable");
  return { eligible: reasons.length === 0, reasons };
}

/** Maps repository SourceListings to Offers, dropping any whose source has
 * no known region (should not happen in practice - `sources.region` is
 * NOT NULL - but a listing referencing an unrecognized/未 source can't be
 * grouped into any market, so it's excluded rather than guessed). */
export function offersFromListings(listings: SourceListing[], regionOf: (sourceId: string) => Region | undefined): Offer[] {
  const offers: Offer[] = [];
  for (const l of listings) {
    const region = regionOf(l.sourceId);
    if (!region) continue;
    offers.push({
      sourceListingId: l.id,
      sourceId: l.sourceId,
      region,
      price: l.lastKnownPrice,
      currency: l.lastKnownCurrency,
      availability: l.lastKnownAvailability,
      reviewRequired: l.reviewRequired,
      confidence: l.confidence,
      shippingStatus: l.shippingStatus,
      sourceUrl: l.sourceUrl,
    });
  }
  return offers;
}

export type MarketQuoteStatus = "no-eligible-offer" | "single" | "duplicate-review-required";

export interface MarketQuote {
  marketKey: string;
  eligibleOffers: Offer[];
  excludedOffersWithReasons: { offer: Offer; reasons: OfferIneligibilityReason[] }[];
  /** set only when status === "single" - never an automatic cheapest-of-N
   * pick (see the duplicate rule below), null otherwise. */
  representativeOffer: Offer | null;
  offerCount: number;
  hasDuplicate: boolean;
  /** true only when there's at least one eligible offer and every one of
   * them is confidence="verified" - a market with zero eligible offers is
   * NOT "verified", it's simply not represented. */
  allVerified: boolean;
  status: MarketQuoteStatus;
}

/**
 * Groups Offers by marketKey (region) and resolves each market's eligible
 * set into a MarketQuote. The duplicate rule is the core hardening this
 * phase adds: 2+ eligible offers in the same market can never be silently
 * reduced to "the cheapest one" (that was the old legsByRegion() behavior -
 * see F0's "동일 market multi-offer" contamination path) - instead the
 * market is marked for review and contributes no price at all.
 */
export function groupIntoMarketQuotes(offers: Offer[]): MarketQuote[] {
  const byMarket = new Map<string, Offer[]>();
  for (const offer of offers) {
    const list = byMarket.get(offer.region);
    if (list) list.push(offer);
    else byMarket.set(offer.region, [offer]);
  }

  const quotes: MarketQuote[] = [];
  for (const [marketKey, marketOffers] of byMarket) {
    const eligibleOffers: Offer[] = [];
    const excludedOffersWithReasons: { offer: Offer; reasons: OfferIneligibilityReason[] }[] = [];
    for (const offer of marketOffers) {
      const { eligible, reasons } = evaluateOfferEligibility(offer);
      if (eligible) eligibleOffers.push(offer);
      else excludedOffersWithReasons.push({ offer, reasons });
    }

    const hasDuplicate = eligibleOffers.length > 1;
    const status: MarketQuoteStatus =
      eligibleOffers.length === 0 ? "no-eligible-offer" : hasDuplicate ? "duplicate-review-required" : "single";

    quotes.push({
      marketKey,
      eligibleOffers,
      excludedOffersWithReasons,
      representativeOffer: status === "single" ? eligibleOffers[0] : null,
      offerCount: eligibleOffers.length,
      hasDuplicate,
      allVerified: eligibleOffers.length > 0 && eligibleOffers.every((o) => o.confidence === "verified"),
      status,
    });
  }
  return quotes;
}

export type MarketComparisonMode = "no-data" | "single-market" | "comparable" | "comparable-unverified" | "duplicate-review-required";

export interface MarketComparisonLeg {
  marketKey: string;
  offer: Offer;
  krwPrice: number;
  /** null for KRW offers (no conversion needed) */
  fxRateUsed: number | null;
  fxAsOf: string | null;
  isWinner: boolean;
  diffFromWinnerKrw: number;
  savingsVsHighestKrw: number;
}

export interface MarketComparisonResult {
  mode: MarketComparisonMode;
  marketQuotes: MarketQuote[];
  /** one entry per market whose status is "single" (i.e. has exactly one
   * eligible offer) - krw-converted and populated regardless of whether
   * some OTHER market is duplicate/unverified, so a still-displayable
   * market's own price is never hidden just because a sibling market isn't
   * ready to compare. */
  legs: MarketComparisonLeg[];
  /**
   * True only for mode === "comparable": 2+ markets, none duplicate, every
   * contributing offer confidence="verified". This is the single flag the
   * UI must check before showing ANY savings/"cheaper" framing - see F0
   * section C. `estimated` confidence and `duplicate-review-required`
   * markets both keep prices displayable (mode still carries `legs`) but
   * never flip this to true.
   */
  headlineAllowed: boolean;
}

/**
 * Compares MarketQuotes (never raw Offers/legs directly - see the file
 * header). krw conversion happens here (not in groupIntoMarketQuotes, which
 * stays a pure sync function) because it's the only async step.
 */
export async function compareMarkets(marketQuotes: MarketQuote[]): Promise<MarketComparisonResult> {
  const legs: MarketComparisonLeg[] = [];
  for (const quote of marketQuotes) {
    if (quote.status !== "single") continue;
    const offer = quote.representativeOffer!;
    const currency = offer.currency ?? "KRW";
    const { krwPrice, fxRateUsed, fxAsOf } = await convertToKrw(offer.price!, currency);
    legs.push({
      marketKey: quote.marketKey,
      offer,
      krwPrice,
      fxRateUsed: currency === "KRW" ? null : fxRateUsed,
      fxAsOf,
      isWinner: false,
      diffFromWinnerKrw: 0,
      savingsVsHighestKrw: 0,
    });
  }

  const hasDuplicateMarket = marketQuotes.some((q) => q.status === "duplicate-review-required");
  if (hasDuplicateMarket) {
    return { mode: "duplicate-review-required", marketQuotes, legs, headlineAllowed: false };
  }

  if (legs.length === 0) {
    return { mode: "no-data", marketQuotes, legs, headlineAllowed: false };
  }

  if (legs.length === 1) {
    return { mode: "single-market", marketQuotes, legs, headlineAllowed: false };
  }

  legs.sort((a, b) => a.krwPrice - b.krwPrice);
  const winnerPrice = legs[0].krwPrice;
  const highestPrice = legs[legs.length - 1].krwPrice;
  for (const leg of legs) {
    leg.isWinner = leg.krwPrice === winnerPrice;
    leg.diffFromWinnerKrw = leg.krwPrice - winnerPrice;
    leg.savingsVsHighestKrw = highestPrice - leg.krwPrice;
  }

  const allVerified = legs.every((l) => l.offer.confidence === "verified");
  const mode: MarketComparisonMode = allVerified ? "comparable" : "comparable-unverified";
  return { mode, marketQuotes, legs, headlineAllowed: mode === "comparable" };
}

/** Convenience end-to-end helper for real call sites that already have
 * `listings` + `sources` in hand (product page, catalog builder) - pure
 * wiring, no new logic. */
export async function buildMarketComparison(
  listings: SourceListing[],
  regionOf: (sourceId: string) => Region | undefined,
): Promise<MarketComparisonResult> {
  const offers = offersFromListings(listings, regionOf);
  const marketQuotes = groupIntoMarketQuotes(offers);
  return compareMarkets(marketQuotes);
}
