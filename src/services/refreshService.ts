/**
 * The core of Phase 1: refreshApprovedListings() is a plain async function.
 * It takes its dependencies as arguments (repositories, adapter credentials)
 * and has no idea whether it's being called from a CLI, a cron job, a
 * Supabase Edge Function, a Vercel Cron route, or a standalone worker - that
 * decision is made entirely by whatever calls this function, not by this
 * file. See docs/phase1-design.md and the Phase 1 request: "실행환경에
 * 종속되지 않는 Refresh Worker".
 *
 * Re-identification logic (search again by the stored keyword, match by
 * externalId equality, never auto-substitute a different product) is
 * carried over unchanged from the PoC (src/refresh.ts) - that behavior was
 * already verified live against both APIs.
 */
import { searchRakutenItem } from "../adapters/rakuten";
import { searchCoupangProduct, type CoupangCredentials } from "../adapters/coupang";
import { convertToKrw } from "../domain/pricing";
import type { Repositories } from "../repository/types";
import type { ReviewReason, SourceListing } from "../domain/types";
import type { RakutenCreds } from "./mappingService";

const PRICE_JUMP_THRESHOLD = 0.4;

export interface RefreshDeps {
  repos: Pick<Repositories, "sourceListings" | "priceHistory">;
  rakutenCreds: RakutenCreds;
  coupangCreds: CoupangCredentials;
  now?: () => Date;
}

export interface RefreshOneResult {
  listingId: string;
  sourceId: string;
  found: boolean;
  /** Discriminates the three real outcomes for batch summary counting -
   * "found"/"reviewReason" alone can't distinguish a hard_failure from a
   * not_found (both leave found=false), since hard_failure's reviewReason is
   * just whatever the listing already had. */
  outcome: "success" | "not_found" | "hard_failure";
  reviewRequired: boolean;
  reviewReason: ReviewReason | null;
  priceChanged: boolean;
  availabilityChanged: boolean;
  historyAppended: boolean;
  newPrice: number | null;
}

/**
 * Normalizes every way a seller fetch can fail - RakutenApiError/
 * CoupangApiError (non-2xx HTTP response) and a plain fetch()-level throw
 * (DNS/connection/timeout - Node/undici surfaces these as a generic
 * TypeError, with no adapter-specific class to catch) - into one shape
 * refreshOneListing() can treat uniformly as "the seller call failed",
 * without having to know which adapter or which specific error class it
 * was. Anything that is NOT a SellerFetchError (a repository failure, an
 * invariant violation, a bug) is never wrapped in this and always
 * propagates untouched - see refreshOneListing()'s catch below.
 */
export class SellerFetchError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "SellerFetchError";
  }
}

async function fetchCurrentByExternalId(
  listing: SourceListing,
  deps: RefreshDeps,
): Promise<{ price: number; currency: string; availability: boolean } | null> {
  if (listing.sourceId === "rakuten") {
    let result;
    try {
      result = await searchRakutenItem({
        applicationId: deps.rakutenCreds.applicationId,
        accessKey: deps.rakutenCreds.accessKey,
        keyword: listing.searchKeywordUsed,
        hits: 15,
      });
    } catch (err) {
      throw new SellerFetchError(`Rakuten fetch failed for listing ${listing.id}`, err);
    }
    const item = result.items.find((i) => i.itemCode === listing.externalId);
    if (!item) return null;
    return { price: item.itemPrice, currency: "JPY", availability: item.availability === 1 };
  }

  if (listing.sourceId === "coupang") {
    let result;
    try {
      result = await searchCoupangProduct(deps.coupangCreds, listing.searchKeywordUsed, 10);
    } catch (err) {
      throw new SellerFetchError(`Coupang fetch failed for listing ${listing.id}`, err);
    }
    const item = result.items.find((i) => String(i.productId) === listing.externalId);
    if (!item) return null;
    // Coupang search doesn't return an explicit stock flag; presence in
    // results (already checked above) is the only signal available.
    return { price: item.productPrice, currency: "KRW", availability: true };
  }

  // Unrecognized sourceId is a config/programmer error, not a seller
  // failure - deliberately NOT a SellerFetchError, so it propagates.
  throw new Error(`No refresh adapter wired for source "${listing.sourceId}"`);
}

/** The shape of fetchCurrentByExternalId() - exported so tests can inject a
 * fake in refreshOneListing()'s third parameter without hitting a real
 * seller API (adapters are hard-imported above, not part of RefreshDeps). */
export type SellerFetchFn = typeof fetchCurrentByExternalId;

export async function refreshOneListing(
  listing: SourceListing,
  deps: RefreshDeps,
  fetchFn: SellerFetchFn = fetchCurrentByExternalId,
): Promise<RefreshOneResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();

  let current: { price: number; currency: string; availability: boolean } | null;
  try {
    current = await fetchFn(listing, deps);
  } catch (err) {
    // Anything that isn't a normalized seller-fetch failure (a repository
    // bug, an invariant violation, an unexpected programmer error) is never
    // treated as an expected external failure - it propagates so the caller
    // (and ultimately the batch) sees it as the system-level failure it is.
    if (!(err instanceof SellerFetchError)) throw err;

    // Expected external failure (seller timeout/network/429/5xx/auth - see
    // SellerFetchError's doc comment for exactly which throws land here).
    // Only last_checked_at moves - "an attempt was made". last_success_at,
    // last_known_price/currency/availability, and any existing
    // review_required/review_reason are left completely untouched (the
    // repository's update() only ever writes the keys present in this
    // patch), so a listing that was already flagged for a real reason isn't
    // silently unflagged by an unrelated transient failure, and the price
    // already on screen never gets paired with a timestamp that implies it
    // was just reconfirmed.
    await deps.repos.sourceListings.update(listing.id, { lastCheckedAt: now });
    return {
      listingId: listing.id,
      sourceId: listing.sourceId,
      found: false,
      outcome: "hard_failure",
      reviewRequired: listing.reviewRequired,
      reviewReason: listing.reviewReason,
      priceChanged: false,
      availabilityChanged: false,
      historyAppended: false,
      newPrice: null,
    };
  }

  if (!current) {
    await deps.repos.sourceListings.update(listing.id, {
      lastCheckedAt: now,
      reviewRequired: true,
      reviewReason: "NOT_FOUND",
    });
    return {
      listingId: listing.id,
      sourceId: listing.sourceId,
      found: false,
      outcome: "not_found",
      reviewRequired: true,
      reviewReason: "NOT_FOUND",
      priceChanged: false,
      availabilityChanged: false,
      historyAppended: false,
      newPrice: null,
    };
  }

  const priceChanged = listing.lastKnownPrice !== null && listing.lastKnownPrice !== current.price;
  const availabilityChanged =
    listing.lastKnownAvailability !== null && listing.lastKnownAvailability !== current.availability;
  const priceDeltaPct =
    listing.lastKnownPrice !== null && listing.lastKnownPrice !== 0
      ? Math.abs(current.price - listing.lastKnownPrice) / listing.lastKnownPrice
      : null;

  let reviewRequired = false;
  let reviewReason: ReviewReason | null = null;
  if (priceDeltaPct !== null && priceDeltaPct > PRICE_JUMP_THRESHOLD) {
    reviewRequired = true;
    reviewReason = "PRICE_JUMP";
  } else if (!current.availability) {
    reviewRequired = true;
    reviewReason = "OUT_OF_STOCK";
  }

  await deps.repos.sourceListings.update(listing.id, {
    lastCheckedAt: now,
    lastSuccessAt: now,
    lastKnownPrice: current.price,
    lastKnownCurrency: current.currency,
    lastKnownAvailability: current.availability,
    reviewRequired,
    reviewReason,
  });

  // Policy: only append to price_history on a meaningful state transition,
  // not on every same-price poll (that only touches last_checked_at above).
  let historyAppended = false;
  if (priceChanged || availabilityChanged) {
    let krwPrice: number | null = null;
    let fxRateUsed: number | null = null;
    try {
      const conv = await convertToKrw(current.price, current.currency);
      krwPrice = conv.krwPrice;
      fxRateUsed = conv.fxRateUsed;
    } catch {
      // fx lookup failing shouldn't block the price update itself
    }

    await deps.repos.priceHistory.append({
      sourceListingId: listing.id,
      price: current.price,
      currency: current.currency,
      krwPrice,
      fxRateUsed,
      availability: current.availability,
      outcome: "success",
      changeReason: priceChanged ? "price_change" : "availability_change",
    });
    historyAppended = true;
  }

  return {
    listingId: listing.id,
    sourceId: listing.sourceId,
    found: true,
    outcome: "success",
    reviewRequired,
    reviewReason,
    priceChanged,
    availabilityChanged,
    historyAppended,
    newPrice: current.price,
  };
}

/**
 * The function referenced throughout Phase 1 planning as
 * `refreshApprovedListings()`. Call this from anywhere; it has no
 * environment-specific code in it.
 */
export async function refreshApprovedListings(
  deps: RefreshDeps,
  opts: { sourceId: "rakuten" | "coupang"; limit?: number; checkedBefore?: string },
  fetchFn: SellerFetchFn = fetchCurrentByExternalId,
): Promise<RefreshOneResult[]> {
  const due = await deps.repos.sourceListings.listDueForRefresh(opts.sourceId, opts.limit ?? 20, opts.checkedBefore);
  const results: RefreshOneResult[] = [];
  for (const listing of due) {
    // refreshOneListing() itself isolates an expected seller-fetch failure
    // (it returns a hard_failure result, it doesn't throw) - a repository/
    // system failure still throws here and deliberately aborts this loop,
    // propagating to whatever calls refreshApprovedListings().
    results.push(await refreshOneListing(listing, deps, fetchFn));
  }
  return results;
}

/**
 * Pure DB sweep, no external API calls - catches listings that fell stale
 * without ever failing a refresh (e.g. scheduler backlog, or a listing that
 * was never picked up by listDueForRefresh often enough).
 */
export async function sweepStaleListings(
  repos: Pick<Repositories, "sourceListings">,
  now: Date = new Date(),
): Promise<string[]> {
  const candidates = await repos.sourceListings.listActiveUnflagged();
  const flagged: string[] = [];

  for (const listing of candidates) {
    if (!listing.lastSuccessAt) {
      flagged.push(listing.id);
      continue;
    }
    const ageHours = (now.getTime() - new Date(listing.lastSuccessAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > listing.staleAfterHours) {
      flagged.push(listing.id);
    }
  }

  for (const id of flagged) {
    await repos.sourceListings.update(id, { reviewRequired: true, reviewReason: "STALE" });
  }

  return flagged;
}
