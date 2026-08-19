/**
 * Category-agnostic core model. Nothing here should assume "diving" —
 * `category` is a free-form string so any vertical (beauty, fashion,
 * electronics, household goods, ...) reuses the same shapes.
 */

export type Region = "KR" | "JP" | "INTL";

export type UpdateMethod = "api" | "feed" | "manual";

/** Axis A — technical automation feasibility for a given price_source. */
export type AutomationStatus = "auto" | "semi-auto" | "manual" | "failed";

/** Axis B — monetization feasibility for a given price_source. Kept separate from AutomationStatus on purpose. */
export type MonetizationStatus =
  | "affiliate_available"
  | "region_or_approval_required"
  | "direct_partnership_required"
  | "not_monetizable_unconfirmed";

export interface CanonicalProduct {
  id: string;
  category: string;
  brand: string;
  officialName: string;
  modelSku?: string;
}

/**
 * A place where a canonical product can be bought. Many price_sources can
 * point at one product (Rakuten/mic21, Amazon JP, TradeInn, a Korean shop, ...).
 */
export interface PriceSource {
  id: string;
  productId: string;
  region: Region;
  sourceName: string;
  sourceUrl: string;
  updateMethod: UpdateMethod;
  automationStatus: AutomationStatus;
  monetizationStatus: MonetizationStatus;
}

/** One observed price reading from a price_source at a point in time. */
export interface Offer {
  id: string;
  priceSourceId: string;
  price: number;
  currency: string;
  krwPrice: number | null;
  fxRateUsed: number | null;
  inStock: boolean | null;
  checkedAt: string;
  lastSuccessAt: string | null;
  staleAfterHours: number;
  confidence: "verified" | "estimated";
  raw?: unknown;
}

export function isStale(offer: Offer, now: Date = new Date()): boolean {
  if (!offer.lastSuccessAt) return true;
  const lastSuccess = new Date(offer.lastSuccessAt).getTime();
  const ageHours = (now.getTime() - lastSuccess) / (1000 * 60 * 60);
  return ageHours > offer.staleAfterHours;
}

/**
 * A source listing a human approved once, keyed by a source-native stable
 * identifier (Rakuten itemCode, Coupang productId). Neither API supports an
 * exact-lookup-by-id endpoint (confirmed live: Rakuten rejects itemCode as
 * "wrong_parameter"; Coupang Partners only exposes keyword search) — so
 * refresh re-runs the same keyword search and re-identifies this listing by
 * ID equality in the results, instead of re-doing fuzzy name matching.
 */
export type ReviewReason = "NOT_FOUND" | "PRICE_JUMP" | "OUT_OF_STOCK" | "AMBIGUOUS_MATCH";

export interface ApprovedSourceMapping {
  id: string;
  productId: string;
  source: "rakuten" | "coupang";
  /** stable id used to re-identify this exact listing on refresh */
  externalId: string;
  /** keyword the fallback re-search uses, captured at approval time */
  searchKeywordUsed: string;
  approvedAt: string;
  approvedBy: string;

  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  staleAfterHours: number;
  confidence: "verified" | "estimated";
  reviewRequired: boolean;
  reviewReason: ReviewReason | null;

  lastKnownPrice: number | null;
  lastKnownCurrency: string;
  lastKnownInStock: boolean | null;
  /** origin+pathname only - tracking query params (rafcid, traceid, token...) are stripped before comparison */
  lastKnownCanonicalUrl: string | null;
}

/** Strip volatile affiliate-tracking query params so URL diffing isn't noise. */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
