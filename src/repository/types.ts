/**
 * Repository interfaces. Services (src/services/*) depend on THESE, never
 * on @supabase/supabase-js directly - that's what keeps refreshApprovedListings()
 * callable from a CLI, a cron job, a serverless function, or a long-running
 * worker without caring which one. Swapping Supabase for something else
 * later means writing a new class that implements these interfaces; no
 * service code changes.
 */
import type {
  CanonicalProduct,
  NewSourceListingInput,
  PriceHistoryEntry,
  ProductVariant,
  ReviewActionInput,
  Source,
  SourceListing,
} from "../domain/types";
import type { ProductType } from "../domain/searchAliases";

export interface SourceRepository {
  listAll(): Promise<Source[]>;
  getById(id: string): Promise<Source | null>;
}

export interface ProductWithVariant {
  product: CanonicalProduct;
  variant: ProductVariant;
}

export interface CanonicalProductRepository {
  /** WRITE CONTRACT: productType is required and typed as the ProductType
   * literal union (not `string`) - every new row gets a real, valid
   * product_type, full stop. This is intentionally stricter than the DB
   * column, which stays nullable until a future migration adds
   * `SET NOT NULL` (see supabase/migrations/0006_product_type.sql) - callers
   * still validate with isProductType() before reaching here (CLI/admin API
   * route) since the value often starts as unvalidated form/CLI input, but
   * this signature itself never accepts null, so a caller cannot silently
   * skip that validation and pass an unvalidated value through. */
  createProduct(input: {
    category: string;
    brand: string;
    officialName: string;
    productType: ProductType;
  }): Promise<CanonicalProduct>;
  createVariant(input: {
    canonicalProductId: string;
    variantAttributes: Record<string, string>;
    modelSku: string | null;
    displayName: string | null;
  }): Promise<ProductVariant>;
  getVariant(id: string): Promise<ProductVariant | null>;
  getProduct(id: string): Promise<CanonicalProduct | null>;
  listVariantsForProduct(canonicalProductId: string): Promise<ProductVariant[]>;
  listAllProducts(): Promise<CanonicalProduct[]>;
  /** no-op if the variant already has an image - never overwrites an existing photo */
  setVariantImageIfMissing(variantId: string, imageUrl: string): Promise<void>;
  /** unconditional overwrite - only for the explicit "swap in a higher-res version of the same photo" path, never for the normal backfill */
  updateVariantImage(variantId: string, imageUrl: string): Promise<void>;

  /** every variant + its parent product - browse/listing surfaces only, not used by pricing logic */
  listAllVariants(): Promise<ProductWithVariant[]>;
  listVariantsByCategory(category: string): Promise<ProductWithVariant[]>;
  /** Search V2: query is parsed into independent axes (brand / product_type /
   * category alias tokens, plus one free-text axis per unrecognized token -
   * see parseSearchIntent() in src/domain/searchAliases.ts). Same axis = OR,
   * different axes = AND (variant.id set intersection). A single unrecognized
   * token reduces to plain brand/official_name/model_sku substring matching,
   * so this is a strict superset of the old whole-string 3-way match. */
  searchProducts(query: string): Promise<ProductWithVariant[]>;
}

export interface SourceListingRepository {
  create(input: NewSourceListingInput): Promise<SourceListing>;
  getById(id: string): Promise<SourceListing | null>;
  findByExternalId(sourceId: string, externalId: string): Promise<SourceListing | null>;
  listByVariant(productVariantId: string): Promise<SourceListing[]>;
  /**
   * `checkedBefore` is optional and additive only: omitted (the admin
   * "refresh-all" button's call), it returns exactly what it always has -
   * every active listing for sourceId, oldest-checked first, up to limit.
   * Passed (a scheduled Job's call), it additionally excludes listings whose
   * last_checked_at is already >= checkedBefore - never-checked
   * (last_checked_at IS NULL) listings are still always included. Must be an
   * ISO timestamp string generated internally (e.g. `now - due age`), never
   * a raw value forwarded from user/request input.
   */
  listDueForRefresh(sourceId: string, limit: number, checkedBefore?: string): Promise<SourceListing[]>;
  listReviewQueue(): Promise<SourceListing[]>;
  /** active + not already flagged - candidates for the stale sweep (pure DB, no external calls) */
  listActiveUnflagged(): Promise<SourceListing[]>;
  update(
    id: string,
    patch: Partial<
      Pick<
        SourceListing,
        | "lastCheckedAt"
        | "lastSuccessAt"
        | "reviewRequired"
        | "reviewReason"
        | "lastKnownPrice"
        | "lastKnownCurrency"
        | "lastKnownAvailability"
        | "shippingStatus"
        | "isActive"
        | "externalId"
      >
    >,
  ): Promise<SourceListing>;
}

export interface PriceHistoryRepository {
  append(entry: PriceHistoryEntry): Promise<void>;
  listForListing(sourceListingId: string, limit?: number): Promise<PriceHistoryEntry[]>;
}

export interface ReviewActionRepository {
  record(input: ReviewActionInput): Promise<void>;
}

/**
 * Backs the refresh_lock singleton row (supabase/migrations/0008_refresh_lock.sql)
 * - a duplicate-run guard for a future scheduled-refresh Cloud Run Job.
 * Nothing calls this yet; no current production code path depends on it.
 */
export interface RefreshLeaseRepository {
  /**
   * A single atomic conditional UPDATE, never a separate SELECT-then-UPDATE
   * (that would race: two callers could both see "unlocked" before either
   * writes). Acquires (or renews) the lease if and only if one of:
   *   - locked_until IS NULL (never acquired)
   *   - locked_until < now (a previous lease expired)
   *   - the lease's run_id already equals runId (this exact run
   *     reacquiring/renewing its own lease - e.g. a Cloud Run Job task
   *     retry sharing the same CLOUD_RUN_EXECUTION as a prior attempt that
   *     died before releasing)
   * On success, sets run_id=runId, locked_at=now, locked_until=lockedUntil
   * and returns true. Returns false - not a thrown error - when another
   * run's still-live lease blocked acquisition; that is an expected,
   * ordinary outcome a caller should treat as "skip this run", not a
   * failure. A genuine Supabase/Postgres error still throws.
   *
   * The refresh_lock table's schema only guarantees AT MOST one row (see
   * 0008_refresh_lock.sql) - it does not guarantee the singleton row always
   * exists. If the conditional UPDATE matches 0 rows, the implementation
   * distinguishes "row exists, another run holds it" (returns false, the
   * ordinary case above) from "the row itself is missing" (throws - a
   * configuration/invariant error, not lock contention) via one read-only
   * diagnostic SELECT; acquisition itself is still decided entirely by the
   * single conditional UPDATE, never by a SELECT-then-UPDATE.
   *
   * `now`/`lockedUntil` are caller-generated ISO timestamps (never raw
   * user/request input - same contract as SourceListingRepository.
   * listDueForRefresh()'s checkedBefore), parsed and re-canonicalized
   * internally - an unparseable value throws before any query runs, and
   * lockedUntil must be strictly after now (a lease that starts already
   * expired is never valid) or this throws too. This deliberately takes no
   * opinion on the lease duration itself - a future Job/config layer
   * computes lockedUntil, not this repository.
   */
  tryAcquire(runId: string, now: string, lockedUntil: string): Promise<boolean>;

  /**
   * Releases the lease ONLY if it is currently held by runId (WHERE
   * run_id = runId) - never touches a lease a different run has since
   * legitimately acquired. A no-op (not an error) if this run doesn't
   * currently hold it (e.g. its lease already expired and someone else
   * took over).
   */
  release(runId: string, now: string): Promise<void>;
}

export interface Repositories {
  sources: SourceRepository;
  canonicalProducts: CanonicalProductRepository;
  sourceListings: SourceListingRepository;
  priceHistory: PriceHistoryRepository;
  reviewActions: ReviewActionRepository;
  refreshLease: RefreshLeaseRepository;
}
