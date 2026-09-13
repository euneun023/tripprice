/**
 * Phase 1 domain model - mirrors the DB schema (supabase/migrations/0001_init.sql)
 * one-to-one, but this is what services/repositories talk in. Category-agnostic:
 * nothing here assumes diving or any other single vertical.
 */
import type { ProductType } from "./searchAliases";

export type Region = "KR" | "JP" | "INTL";
export type UpdateMethod = "api" | "feed" | "manual";
export type AutomationStatus = "auto" | "semi-auto" | "manual" | "failed";
export type Confidence = "verified" | "estimated";
export type ReviewReason = "NOT_FOUND" | "PRICE_JUMP" | "OUT_OF_STOCK" | "AMBIGUOUS_MATCH" | "STALE";
export type PriceHistoryOutcome = "success" | "not_found" | "error";
export type PriceHistoryChangeReason = "initial" | "price_change" | "availability_change" | "manual";
/**
 * Shipping cost handling, 1st pass (see docs/phase1-design.md-style audit
 * that preceded this): we deliberately never store or estimate an actual
 * shipping fee amount - no source gives us a reliable one (Rakuten's
 * postageFlag and Coupang's isFreeShipping are both included/separate
 * signals only, never a KRW/JPY figure) - so this only ever preserves which
 * of the three states a listing is in, end to end from adapter -> candidate
 * search -> DB -> UI. "unknown" is the safe default everywhere (DB column
 * default, repository fallback) - never silently upgraded to "included".
 */
export type ShippingStatus = "included" | "separate" | "unknown";

export interface Source {
  id: string;
  name: string;
  region: Region;
  updateMethod: UpdateMethod;
  automationStatus: AutomationStatus;
  defaultStaleAfterHours: number;
  rateLimitPerHour: number | null;
}

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  NOT_FOUND: "판매처에서 재확인 안 됨",
  PRICE_JUMP: "가격 급변 감지",
  OUT_OF_STOCK: "품절",
  AMBIGUOUS_MATCH: "매칭 불확실",
  STALE: "장기간 미확인",
};

export interface CanonicalProduct {
  id: string;
  category: string;
  brand: string;
  officialName: string;
  /** READ MODEL ONLY - nullable because the DB column is nullable during the
   * 0006 migration's expand phase (see that file): a row written by the
   * pre-product_type app revision can legitimately have no value yet. This
   * is a read-side allowance, not a write-side one - see
   * CanonicalProductRepository.createProduct(), whose `productType` input is
   * ProductType (required, never null). Once a future migration adds
   * `SET NOT NULL` (after confirming the new app is the only writer), this
   * can be tightened to `ProductType` here too. */
  productType: ProductType | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  canonicalProductId: string;
  variantAttributes: Record<string, string>;
  modelSku: string | null;
  displayName: string | null;
  /** one representative photo, set once from an approved listing's own image - never a stock/placeholder photo */
  imageUrl: string | null;
  createdAt: string;
}

export interface SourceListing {
  id: string;
  productVariantId: string;
  sourceId: string;

  externalId: string;
  externalIdType: string;
  sourceUrl: string | null;
  searchKeywordUsed: string;

  approvedAt: string;
  approvedBy: string;
  confidence: Confidence;

  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  staleAfterHours: number;

  reviewRequired: boolean;
  reviewReason: ReviewReason | null;

  lastKnownPrice: number | null;
  lastKnownCurrency: string | null;
  lastKnownAvailability: boolean | null;
  /** DB column is `not null default 'unknown'` - always a real value, never absent. */
  shippingStatus: ShippingStatus;

  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewSourceListingInput {
  productVariantId: string;
  sourceId: string;
  externalId: string;
  externalIdType: string;
  sourceUrl: string | null;
  searchKeywordUsed: string;
  approvedBy: string;
  confidence: Confidence;
  staleAfterHours?: number;
  initialPrice: number | null;
  initialCurrency: string | null;
  initialAvailability: boolean | null;
  /** optional so every existing caller keeps compiling/working unchanged - omitted means "unknown" (the repository/DB default), never guessed. */
  shippingStatus?: ShippingStatus;
}

export interface PriceHistoryEntry {
  sourceListingId: string;
  price: number | null;
  currency: string | null;
  krwPrice: number | null;
  fxRateUsed: number | null;
  availability: boolean | null;
  outcome: PriceHistoryOutcome;
  changeReason: PriceHistoryChangeReason | null;
  /** optional, same "omitted -> unknown" contract as NewSourceListingInput.shippingStatus */
  shippingStatus?: ShippingStatus;
}

export interface ReviewActionInput {
  sourceListingId: string;
  reason: string;
  detectedAt: string;
  resolvedBy?: string;
  resolution?: "approved_new_price" | "remapped" | "deactivated" | "snoozed";
  note?: string;
}
