/**
 * Refresh engine for already-approved source mappings. This is deliberately
 * NOT the same code path as first-time matching (verify-rakuten*.ts /
 * verify-coupang.ts use fuzzy name matching because there's no canonical id
 * yet). Here a human already picked the exact listing once; refresh only
 * has to re-find that same externalId in a fresh search, which is a much
 * stronger check (ID equality, not fuzzy name matching).
 *
 * Neither Rakuten nor Coupang Partners expose a real exact-lookup-by-id
 * endpoint (confirmed live in earlier PoC steps), so "re-find by id" is
 * implemented as: re-run the same keyword search, then filter by id
 * equality among the results. If the id isn't in this round's results,
 * that's surfaced as NOT_FOUND for human review - never silently dropped.
 */
import { searchRakutenItem } from "./sources/rakuten";
import { searchCoupangProduct, type CoupangCredentials } from "./sources/coupang";
import { canonicalizeUrl, type ApprovedSourceMapping, type ReviewReason } from "./types";

const PRICE_JUMP_THRESHOLD = 0.4; // matches the 40% anomaly threshold from the planning doc

export interface RefreshOutcome {
  mapping: ApprovedSourceMapping;
  found: boolean;
  priceChanged: boolean;
  priceDeltaPct: number | null;
  urlChanged: boolean;
  stockChanged: boolean;
}

function decideReview(
  found: boolean,
  priceDeltaPct: number | null,
  inStock: boolean | null,
): { reviewRequired: boolean; reviewReason: ReviewReason | null } {
  if (!found) return { reviewRequired: true, reviewReason: "NOT_FOUND" };
  if (priceDeltaPct !== null && priceDeltaPct > PRICE_JUMP_THRESHOLD) {
    return { reviewRequired: true, reviewReason: "PRICE_JUMP" };
  }
  if (inStock === false) return { reviewRequired: true, reviewReason: "OUT_OF_STOCK" };
  return { reviewRequired: false, reviewReason: null };
}

export async function refreshRakutenMapping(
  mapping: ApprovedSourceMapping,
  credentials: { applicationId: string; accessKey: string },
): Promise<RefreshOutcome> {
  const now = new Date().toISOString();
  const result = await searchRakutenItem({
    applicationId: credentials.applicationId,
    accessKey: credentials.accessKey,
    keyword: mapping.searchKeywordUsed,
    hits: 15,
  });

  const item = result.items.find((i) => i.itemCode === mapping.externalId);

  if (!item) {
    const { reviewRequired, reviewReason } = decideReview(false, null, null);
    return {
      mapping: { ...mapping, lastCheckedAt: now, reviewRequired, reviewReason },
      found: false,
      priceChanged: false,
      priceDeltaPct: null,
      urlChanged: false,
      stockChanged: false,
    };
  }

  const newPrice = item.itemPrice;
  const inStock = item.availability === 1;
  const canonicalUrl = canonicalizeUrl(item.itemUrl);

  const priceDeltaPct =
    mapping.lastKnownPrice !== null && mapping.lastKnownPrice !== 0
      ? Math.abs(newPrice - mapping.lastKnownPrice) / mapping.lastKnownPrice
      : null;
  const { reviewRequired, reviewReason } = decideReview(true, priceDeltaPct, inStock);

  return {
    mapping: {
      ...mapping,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastKnownPrice: newPrice,
      lastKnownCurrency: "JPY",
      lastKnownInStock: inStock,
      lastKnownCanonicalUrl: canonicalUrl,
      reviewRequired,
      reviewReason,
    },
    found: true,
    priceChanged: mapping.lastKnownPrice !== null && mapping.lastKnownPrice !== newPrice,
    priceDeltaPct,
    urlChanged: mapping.lastKnownCanonicalUrl !== null && mapping.lastKnownCanonicalUrl !== canonicalUrl,
    stockChanged: mapping.lastKnownInStock !== null && mapping.lastKnownInStock !== inStock,
  };
}

export async function refreshCoupangMapping(
  mapping: ApprovedSourceMapping,
  credentials: CoupangCredentials,
): Promise<RefreshOutcome> {
  const now = new Date().toISOString();
  const result = await searchCoupangProduct(credentials, mapping.searchKeywordUsed, 10);

  const item = result.items.find((i) => String(i.productId) === mapping.externalId);

  if (!item) {
    const { reviewRequired, reviewReason } = decideReview(false, null, null);
    return {
      mapping: { ...mapping, lastCheckedAt: now, reviewRequired, reviewReason },
      found: false,
      priceChanged: false,
      priceDeltaPct: null,
      urlChanged: false,
      stockChanged: false,
    };
  }

  const newPrice = item.productPrice;
  // Coupang Partners search doesn't return an explicit stock flag - absence from
  // results (handled above) is the closest signal available; treat "found" as in-stock.
  const inStock = true;
  const canonicalUrl = canonicalizeUrl(item.productUrl);

  const priceDeltaPct =
    mapping.lastKnownPrice !== null && mapping.lastKnownPrice !== 0
      ? Math.abs(newPrice - mapping.lastKnownPrice) / mapping.lastKnownPrice
      : null;
  const { reviewRequired, reviewReason } = decideReview(true, priceDeltaPct, inStock);

  return {
    mapping: {
      ...mapping,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastKnownPrice: newPrice,
      lastKnownCurrency: "KRW",
      lastKnownInStock: inStock,
      lastKnownCanonicalUrl: canonicalUrl,
      reviewRequired,
      reviewReason,
    },
    found: true,
    priceChanged: mapping.lastKnownPrice !== null && mapping.lastKnownPrice !== newPrice,
    priceDeltaPct,
    urlChanged: mapping.lastKnownCanonicalUrl !== null && mapping.lastKnownCanonicalUrl !== canonicalUrl,
    stockChanged: false,
  };
}
