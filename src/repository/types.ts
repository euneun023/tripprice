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
  listDueForRefresh(sourceId: string, limit: number): Promise<SourceListing[]>;
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

export interface Repositories {
  sources: SourceRepository;
  canonicalProducts: CanonicalProductRepository;
  sourceListings: SourceListingRepository;
  priceHistory: PriceHistoryRepository;
  reviewActions: ReviewActionRepository;
}
