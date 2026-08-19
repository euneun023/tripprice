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

export interface SourceRepository {
  listAll(): Promise<Source[]>;
  getById(id: string): Promise<Source | null>;
}

export interface ProductWithVariant {
  product: CanonicalProduct;
  variant: ProductVariant;
}

export interface CanonicalProductRepository {
  createProduct(input: { category: string; brand: string; officialName: string }): Promise<CanonicalProduct>;
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

  /** every variant + its parent product - browse/listing surfaces only, not used by pricing logic */
  listAllVariants(): Promise<ProductWithVariant[]>;
  listVariantsByCategory(category: string): Promise<ProductWithVariant[]>;
  /** matches canonical_products.brand / official_name OR product_variants.model_sku (case-insensitive substring) */
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
