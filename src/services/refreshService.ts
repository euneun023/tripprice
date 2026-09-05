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
  reviewRequired: boolean;
  reviewReason: ReviewReason | null;
  priceChanged: boolean;
  availabilityChanged: boolean;
  historyAppended: boolean;
  newPrice: number | null;
}

async function fetchCurrentByExternalId(
  listing: SourceListing,
  deps: RefreshDeps,
): Promise<{ price: number; currency: string; availability: boolean } | null> {
  if (listing.sourceId === "rakuten") {
    const result = await searchRakutenItem({
      applicationId: deps.rakutenCreds.applicationId,
      accessKey: deps.rakutenCreds.accessKey,
      keyword: listing.searchKeywordUsed,
      hits: 15,
    });
    const item = result.items.find((i) => i.itemCode === listing.externalId);
    if (!item) return null;
    return { price: item.itemPrice, currency: "JPY", availability: item.availability === 1 };
  }

  if (listing.sourceId === "coupang") {
    const result = await searchCoupangProduct(deps.coupangCreds, listing.searchKeywordUsed, 10);
    const item = result.items.find((i) => String(i.productId) === listing.externalId);
    if (!item) return null;
    // Coupang search doesn't return an explicit stock flag; presence in
    // results (already checked above) is the only signal available.
    return { price: item.productPrice, currency: "KRW", availability: true };
  }

  throw new Error(`No refresh adapter wired for source "${listing.sourceId}"`);
}

export async function refreshOneListing(listing: SourceListing, deps: RefreshDeps): Promise<RefreshOneResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const current = await fetchCurrentByExternalId(listing, deps);

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
): Promise<RefreshOneResult[]> {
  const due = await deps.repos.sourceListings.listDueForRefresh(opts.sourceId, opts.limit ?? 20, opts.checkedBefore);
  const results: RefreshOneResult[] = [];
  for (const listing of due) {
    results.push(await refreshOneListing(listing, deps));
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
