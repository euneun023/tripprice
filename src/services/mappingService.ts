/**
 * New-product approval flow (semi-automatic, per Phase 1 principle):
 * search only ever returns candidates. A human (CLI operator, later an
 * admin UI) picks the exact one. This module never auto-confirms a match
 * by name alone - see docs/phase1-design.md §4.
 */
import { searchRakutenItem, type RakutenItem } from "../adapters/rakuten";
import { searchCoupangProduct, type CoupangProduct, type CoupangCredentials } from "../adapters/coupang";
import { convertToKrw } from "../domain/pricing";
import type { Repositories } from "../repository/types";
import type { Confidence, ShippingStatus, SourceListing } from "../domain/types";
import { isHttpUrl } from "../domain/url";

export interface RakutenCreds {
  applicationId: string;
  accessKey: string;
}

export async function searchRakutenCandidates(keyword: string, creds: RakutenCreds, hits = 15): Promise<RakutenItem[]> {
  const result = await searchRakutenItem({ applicationId: creds.applicationId, accessKey: creds.accessKey, keyword, hits });
  return result.items;
}

export async function searchCoupangCandidates(keyword: string, creds: CoupangCredentials, limit = 10): Promise<CoupangProduct[]> {
  const result = await searchCoupangProduct(creds, keyword, limit);
  return result.items;
}

export interface ApproveListingInput {
  productVariantId: string;
  /** any row id from the `sources` table - not restricted to rakuten/coupang, so manual/test/future sources work without a type change here */
  sourceId: string;
  externalId: string;
  externalIdType: string;
  sourceUrl: string | null;
  searchKeywordUsed: string;
  approvedBy: string;
  confidence: Confidence;
  initialPrice: number;
  initialCurrency: string;
  initialAvailability: boolean;
  /** optional - omitted means "unknown" (repository/DB default), same contract as NewSourceListingInput.shippingStatus. Existing call sites (src/cli/index.ts, src/scripts/verify-3way-comparison.ts) don't pass this and keep working unchanged. */
  shippingStatus?: ShippingStatus;
}

/**
 * Persists a human-approved mapping. This is the ONLY place a source_listing
 * row gets created - there is no code path that creates one from a raw
 * search result without going through this function.
 */
export async function approveListing(
  repos: Pick<Repositories, "sourceListings" | "priceHistory">,
  input: ApproveListingInput,
): Promise<SourceListing> {
  const existing = await repos.sourceListings.findByExternalId(input.sourceId, input.externalId);
  if (existing) {
    throw new Error(
      `externalId ${input.externalId} on source ${input.sourceId} is already mapped to source_listing ${existing.id} - not creating a duplicate.`,
    );
  }

  // sourceUrl ends up in an <a href> and a JSON-LD offer url on the product
  // page - reject anything but http(s) here, at the only place a
  // source_listing gets created, so a javascript:/data: URL can never be
  // stored in the first place.
  if (input.sourceUrl !== null && !isHttpUrl(input.sourceUrl)) {
    throw new Error(`sourceUrl must be an http(s) URL, got: ${input.sourceUrl}`);
  }

  const listing = await repos.sourceListings.create({
    productVariantId: input.productVariantId,
    sourceId: input.sourceId,
    externalId: input.externalId,
    externalIdType: input.externalIdType,
    sourceUrl: input.sourceUrl,
    searchKeywordUsed: input.searchKeywordUsed,
    approvedBy: input.approvedBy,
    confidence: input.confidence,
    initialPrice: input.initialPrice,
    initialCurrency: input.initialCurrency,
    initialAvailability: input.initialAvailability,
    shippingStatus: input.shippingStatus,
  });

  let krwPrice: number | null = null;
  let fxRateUsed: number | null = null;
  try {
    const conv = await convertToKrw(input.initialPrice, input.initialCurrency);
    krwPrice = conv.krwPrice;
    fxRateUsed = conv.fxRateUsed;
  } catch {
    // fx lookup failing shouldn't block the approval itself - krw_price stays null
  }

  await repos.priceHistory.append({
    sourceListingId: listing.id,
    price: input.initialPrice,
    currency: input.initialCurrency,
    krwPrice,
    fxRateUsed,
    availability: input.initialAvailability,
    outcome: "success",
    changeReason: "initial",
    shippingStatus: input.shippingStatus,
  });

  return listing;
}

/**
 * Thrown when a new listing was created (or already existed) but deactivating
 * the old listing failed - both rows are left active. This is the deliberate
 * "duplicate active" failure state: it costs nothing (no data loss, no
 * deletion) and is surfaced as review-required elsewhere, so it is strictly
 * safer than guessing at a rollback. Caller must resolve manually (retrying
 * remapListing() with the same input is the expected resolution path - the
 * idempotency check will find the already-created new listing and retry only
 * the deactivate step).
 */
export class RemapDuplicateActiveError extends Error {
  constructor(
    message: string,
    public readonly oldListingId: string,
    public readonly newListingId: string,
  ) {
    super(message);
    this.name = "RemapDuplicateActiveError";
  }
}

export interface RemapListingInput {
  oldSourceListingId: string;
  /** Guard rail, not a lookup key: must match the old listing's actual productVariantId or the remap is refused before anything is touched. */
  expectedProductVariantId: string;
  /** Guard rail: must match the old listing's actual sourceId (e.g. 'rakuten') or the remap is refused before anything is touched. */
  expectedSourceId: string;
  newExternalId: string;
  externalIdType: string;
  sourceUrl: string | null;
  searchKeywordUsed: string;
  approvedBy: string;
  confidence: Confidence;
  initialPrice: number;
  initialCurrency: string;
  initialAvailability: boolean;
  shippingStatus?: ShippingStatus;
  /** review_actions.reason - why this remap is happening (e.g. "cheaper verified alternative found"). */
  reviewReason: string;
  /** review_actions.detected_at - caller-generated ISO timestamp, same contract as elsewhere in this codebase (never raw user/request input). */
  detectedAt: string;
  /** appended to the auto-generated old->new externalId note in review_actions. */
  note?: string;
}

export type RemapStatus = "remapped" | "already-remapped";

export interface RemapListingResult {
  status: RemapStatus;
  oldListing: SourceListing;
  newListing: SourceListing;
  /** false either because recording failed (see auditError) or because this
   * call was an already-remapped no-op replay that intentionally does not
   * write a second audit entry - check `status` to tell those apart. */
  auditRecorded: boolean;
  auditError?: string;
}

/**
 * Safely transitions an existing source_listing to a new externalId on the
 * SAME source_id and product_variant_id, without ever mutating the old row's
 * externalId/sourceUrl and without deleting anything - both rows' price
 * history stay intact forever. This is deliberately NOT "in-place update":
 * SourceListingRepository.update() can't patch sourceUrl or confidence, and
 * rewriting external_id on an existing row would silently detach its
 * price_history from the seller listing that history actually describes.
 *
 * Sequencing (idempotent - safe to call again with the same input after any
 * partial failure):
 *   1. Load + verify the old listing (must exist, must match
 *      expectedProductVariantId/expectedSourceId).
 *   2. Idempotency check: does an active listing already exist for
 *      (sourceId, newExternalId) on this variant? If so, reuse it instead of
 *      inserting a duplicate.
 *   3. If not, create the new listing via approveListing() (the only place a
 *      source_listing row is ever created). Failure here leaves the old
 *      listing completely untouched.
 *   4. Deactivate the old listing (isActive=false only - never touches its
 *      externalId/sourceUrl/confidence/price_history). Failure here throws
 *      RemapDuplicateActiveError: the new listing is NOT rolled back/deleted,
 *      both rows are left active, and the caller must resolve manually.
 *   5. Record a review_actions audit entry (resolution='remapped'). Failure
 *      here does NOT fail the overall remap - the listing mutation already
 *      succeeded - it is reported separately via auditRecorded/auditError.
 *   6. If step 1's old listing was already inactive and a matching active new
 *      listing already exists, this is a no-op replay: returns
 *      status="already-remapped" without touching anything or writing a
 *      second audit entry.
 */
export async function remapListing(
  repos: Pick<Repositories, "sourceListings" | "priceHistory" | "reviewActions">,
  input: RemapListingInput,
): Promise<RemapListingResult> {
  const old = await repos.sourceListings.getById(input.oldSourceListingId);
  if (!old) {
    throw new Error(`remapListing: old source_listing ${input.oldSourceListingId} not found`);
  }
  if (old.sourceId !== input.expectedSourceId) {
    throw new Error(
      `remapListing: refusing to remap - old listing ${old.id} sourceId=${old.sourceId} does not match expectedSourceId=${input.expectedSourceId}`,
    );
  }
  if (old.productVariantId !== input.expectedProductVariantId) {
    throw new Error(
      `remapListing: refusing to remap - old listing ${old.id} productVariantId=${old.productVariantId} does not match expectedProductVariantId=${input.expectedProductVariantId}`,
    );
  }
  if (input.newExternalId === old.externalId) {
    throw new Error(`remapListing: newExternalId equals old listing's externalId (${old.externalId}) - nothing to remap`);
  }

  const existingNew = await repos.sourceListings.findByExternalId(old.sourceId, input.newExternalId);

  let newListing: SourceListing;
  if (existingNew) {
    if (existingNew.productVariantId !== old.productVariantId) {
      throw new Error(
        `remapListing: newExternalId ${input.newExternalId} on source ${old.sourceId} is already mapped to a different variant (source_listing ${existingNew.id}, productVariantId=${existingNew.productVariantId}) - refusing to touch it`,
      );
    }
    if (!existingNew.isActive) {
      throw new Error(
        `remapListing: a listing for newExternalId ${input.newExternalId} already exists (source_listing ${existingNew.id}) but is inactive - ambiguous state, resolve manually before retrying`,
      );
    }
    newListing = existingNew;
  } else {
    if (!old.isActive) {
      throw new Error(
        `remapListing: old listing ${old.id} is already inactive, but no active listing exists yet for newExternalId ${input.newExternalId} on source ${old.sourceId} - refusing to create one blindly, verify state manually`,
      );
    }
    try {
      newListing = await approveListing(repos, {
        productVariantId: old.productVariantId,
        sourceId: old.sourceId,
        externalId: input.newExternalId,
        externalIdType: input.externalIdType,
        sourceUrl: input.sourceUrl,
        searchKeywordUsed: input.searchKeywordUsed,
        approvedBy: input.approvedBy,
        confidence: input.confidence,
        initialPrice: input.initialPrice,
        initialCurrency: input.initialCurrency,
        initialAvailability: input.initialAvailability,
        shippingStatus: input.shippingStatus,
      });
    } catch (err) {
      throw new Error(
        `remapListing: failed to create new listing (externalId=${input.newExternalId}) - old listing ${old.id} left untouched: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (newListing.productVariantId !== old.productVariantId || newListing.sourceId !== old.sourceId) {
      throw new Error(
        `remapListing: newly created listing ${newListing.id} does not match old listing's variant/source - refusing to deactivate old listing ${old.id}`,
      );
    }
  }

  const alreadyRemapped = !old.isActive && newListing.isActive;

  let finalOld = old;
  if (!alreadyRemapped) {
    try {
      finalOld = await repos.sourceListings.update(old.id, { isActive: false });
    } catch (err) {
      throw new RemapDuplicateActiveError(
        `remapListing: new listing ${newListing.id} (externalId=${input.newExternalId}) was created but deactivating old listing ${old.id} failed - BOTH LISTINGS ARE NOW ACTIVE. No automatic rollback/delete was performed. Resolve manually, then retry remapListing() with the same input to finish deactivating the old listing: ${err instanceof Error ? err.message : String(err)}`,
        old.id,
        newListing.id,
      );
    }
  }

  let auditRecorded = false;
  let auditError: string | undefined;
  if (!alreadyRemapped) {
    try {
      await repos.reviewActions.record({
        sourceListingId: old.id,
        reason: input.reviewReason,
        detectedAt: input.detectedAt,
        resolvedBy: input.approvedBy,
        resolution: "remapped",
        note: `remapped ${old.externalId} -> ${input.newExternalId} (new source_listing ${newListing.id})${input.note ? `; ${input.note}` : ""}`,
      });
      auditRecorded = true;
    } catch (err) {
      auditRecorded = false;
      auditError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    status: alreadyRemapped ? "already-remapped" : "remapped",
    oldListing: finalOld,
    newListing,
    auditRecorded,
    auditError,
  };
}
