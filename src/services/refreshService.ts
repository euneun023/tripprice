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
import { searchRakutenItem, RakutenApiError, buildRakutenFallbackKeyword, deriveRakutenShippingStatus, type RakutenSearchResult } from "../adapters/rakuten";
import { searchCoupangProduct, CoupangApiError, deriveCoupangShippingStatus, COUPANG_MAX_SEARCH_LIMIT, type CoupangCredentials } from "../adapters/coupang";
import { convertToKrw } from "../domain/pricing";
import type { Repositories } from "../repository/types";
import type { ReviewReason, ShippingStatus, SourceListing } from "../domain/types";
import type { RakutenCreds } from "./mappingService";

const PRICE_JUMP_THRESHOLD = 0.4;

/**
 * D18L attempted to widen this from 10 to 20 to reduce intermittent false
 * NOT_FOUND on refresh (the theory: an exact productId had merely slipped
 * out of Coupang's top-10 for its own stored searchKeywordUsed, not
 * actually gone). That shipped to production and caused total NOT_FOUND
 * across every Coupang listing - D18O found the real cause: 20 exceeds
 * affiliate_open_api's documented max of 10 (COUPANG_MAX_SEARCH_LIMIT in
 * ../adapters/coupang), and the adapter at the time didn't check the
 * response envelope's rCode, so Coupang's rejection of the out-of-range
 * limit came back looking like a normal "0 results" search. Rolled back to
 * 10 here; the adapter itself now also enforces the cap and validates
 * rCode so this can't silently regress again even if this constant is
 * edited without reading this comment.
 */
const COUPANG_REFRESH_SEARCH_LIMIT: number = COUPANG_MAX_SEARCH_LIMIT;

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
  /**
   * Present ONLY when outcome === "hard_failure" - a safe classification of
   * *why*, deliberately carrying nothing more than an HTTP status number and
   * an error class name (never the seller's response body, request URL,
   * query params, or any credential - see classifySellerFailure() below,
   * the only place these three fields are ever populated).
   *   - failureKind: "http" (a real non-2xx response) or "transport" (no
   *     response at all - DNS/connection/timeout).
   *   - status: the adapter's own status number - 0 for transport (same
   *     convention rakuten.ts/coupang.ts already use for "no HTTP response
   *     received"), the real HTTP status otherwise (401/403 auth, 429 rate
   *     limit, 5xx seller-side, other 4xx a request/contract problem).
   *   - errorName: "RakutenApiError" or "CoupangApiError" - which adapter,
   *     redundant with `sourceId` above but kept as the plain class name a
   *     log reader would otherwise have to infer.
   */
  failureKind?: "http" | "transport";
  status?: number;
  errorName?: string;
}

/**
 * Normalizes RakutenApiError/CoupangApiError - and ONLY those two classes -
 * into one shape refreshOneListing() can treat uniformly as "the seller
 * call failed", without having to know which adapter it was. Both classes
 * now cover a real non-2xx HTTP response AND a fetch()-level transport
 * failure (DNS/connection/timeout - see the narrow try/catch each adapter
 * wraps its own fetch() call in), so this single instanceof check is enough
 * to catch every seller-reachability failure. Anything else thrown from
 * inside the adapter call (a credentials/config bug, an unexpected
 * programmer error - e.g. a bad Coupang secretKey throwing inside
 * generateAuthHeader(), which runs before fetch() and so is NOT covered by
 * either adapter's narrow wrapper) is deliberately NOT a
 * RakutenApiError/CoupangApiError, so the type guard below re-throws it
 * as-is instead of misclassifying it as an expected seller failure.
 */
export class SellerFetchError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "SellerFetchError";
  }
}

/**
 * Tries `keyword` once. On an HTTP 400 only, retries exactly once with
 * buildRakutenFallbackKeyword(keyword) if it returns a mergeable fallback -
 * same 400-only, single-retry policy as evaluate-candidates.ts's
 * searchRakutenWithFallback, sharing the same pure normalization helper
 * (adapters/rakuten.ts) so candidate search and this refresh path 400-avoid
 * identically. Any non-400 RakutenApiError (401/403/429/5xx/transport) or a
 * 400 with no mergeable token propagates unchanged - no retry. The raw
 * seller call never modifies listing.searchKeywordUsed; the fallback string
 * only ever lives in-memory for this one retry.
 */
async function searchRakutenWithOneFallback(
  creds: { applicationId: string; accessKey: string },
  keyword: string,
  hits: number,
): Promise<RakutenSearchResult> {
  try {
    return await searchRakutenItem({ ...creds, keyword, hits });
  } catch (err) {
    if (!(err instanceof RakutenApiError) || err.status !== 400) throw err;
    const fallbackKeyword = buildRakutenFallbackKeyword(keyword);
    if (!fallbackKeyword) throw err;
    return await searchRakutenItem({ ...creds, keyword: fallbackKeyword, hits });
  }
}

export async function fetchCurrentByExternalId(
  listing: SourceListing,
  deps: RefreshDeps,
): Promise<{ price: number; currency: string; availability: boolean; shippingStatus?: ShippingStatus } | null> {
  if (listing.sourceId === "rakuten") {
    let result;
    try {
      result = await searchRakutenWithOneFallback(deps.rakutenCreds, listing.searchKeywordUsed, 15);
    } catch (err) {
      if (!(err instanceof RakutenApiError)) throw err;
      throw new SellerFetchError(`Rakuten fetch failed for listing ${listing.id}`, err);
    }
    const item = result.items.find((i) => i.itemCode === listing.externalId);
    if (!item) return null;
    // See deriveRakutenShippingStatus()'s own doc comment: this describes
    // ONLY the seller's JP-domestic postage display, never whether shipping
    // to a Korean buyer is confirmed/costed - that distinction is preserved
    // all the way through to source_listings/price_history, never collapsed
    // into a false "included" here.
    return {
      price: item.itemPrice,
      currency: "JPY",
      availability: item.availability === 1,
      shippingStatus: deriveRakutenShippingStatus(item.postageFlag),
    };
  }

  if (listing.sourceId === "coupang") {
    let result;
    try {
      result = await searchCoupangProduct(deps.coupangCreds, listing.searchKeywordUsed, COUPANG_REFRESH_SEARCH_LIMIT);
    } catch (err) {
      if (!(err instanceof CoupangApiError)) throw err;
      throw new SellerFetchError(`Coupang fetch failed for listing ${listing.id}`, err);
    }
    const item = result.items.find((i) => String(i.productId) === listing.externalId);
    if (!item) return null;
    // Coupang search doesn't return an explicit stock flag; presence in
    // results (already checked above) is the only signal available.
    return {
      price: item.productPrice,
      currency: "KRW",
      availability: true,
      shippingStatus: deriveCoupangShippingStatus(item.isFreeShipping),
    };
  }

  // Unrecognized sourceId is a config/programmer error, not a seller
  // failure - deliberately NOT a SellerFetchError, so it propagates.
  throw new Error(`No refresh adapter wired for source "${listing.sourceId}"`);
}

/** The shape of fetchCurrentByExternalId() - exported so tests can inject a
 * fake in refreshOneListing()'s third parameter without hitting a real
 * seller API (adapters are hard-imported above, not part of RefreshDeps). */
export type SellerFetchFn = typeof fetchCurrentByExternalId;

/**
 * Extracts a safe (status/errorName only - never .body, the seller's raw
 * response) classification from a SellerFetchError. Relies on the invariant
 * both throw sites above establish: a SellerFetchError's `cause` is always
 * the RakutenApiError/CoupangApiError that was normalized into it (the
 * `if (!(err instanceof RakutenApiError)) throw err;` guards immediately
 * above each throw make this the only way a SellerFetchError is ever
 * constructed) - so this never needs to re-derive it from anywhere else.
 */
function classifySellerFailure(err: SellerFetchError): { failureKind: "http" | "transport"; status: number; errorName: string } {
  const cause = err.cause as RakutenApiError | CoupangApiError;
  return {
    failureKind: cause.status === 0 ? "transport" : "http",
    status: cause.status,
    errorName: cause.name,
  };
}

export async function refreshOneListing(
  listing: SourceListing,
  deps: RefreshDeps,
  fetchFn: SellerFetchFn = fetchCurrentByExternalId,
): Promise<RefreshOneResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();

  let current: { price: number; currency: string; availability: boolean; shippingStatus?: ShippingStatus } | null;
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
      ...classifySellerFailure(err),
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
    // Only included when this fetch actually derived one (the real
    // fetchCurrentByExternalId() above always does) - omitted entirely
    // rather than falling back to "unknown" here, so a fake/legacy fetchFn
    // that doesn't know about shipping (e.g. an older test) can never
    // silently regress an already-known shipping_status back to "unknown".
    // SupabaseSourceListingRepository.update() only ever writes keys present
    // in this patch object, so an omitted key leaves the DB value untouched.
    ...(current.shippingStatus !== undefined ? { shippingStatus: current.shippingStatus } : {}),
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
      // Point-in-time snapshot, same field as source_listings.shipping_status
      // above - a fake/legacy fetchFn without a shippingStatus falls back to
      // "unknown" at the repository layer (PriceHistoryRepository.append()),
      // which is safe here because this is a brand-new row, never an
      // overwrite of previously-known information.
      shippingStatus: current.shippingStatus,
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
