/** snake_case DB row <-> camelCase domain object mappers. */
import type { CanonicalProduct, ProductVariant, Source, SourceListing } from "../../domain/types";

export function rowToSource(row: any): Source {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    updateMethod: row.update_method,
    automationStatus: row.automation_status,
    defaultStaleAfterHours: row.default_stale_after_hours,
    rateLimitPerHour: row.rate_limit_per_hour,
  };
}

export function rowToCanonicalProduct(row: any): CanonicalProduct {
  return {
    id: row.id,
    category: row.category,
    brand: row.brand,
    officialName: row.official_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToProductVariant(row: any): ProductVariant {
  return {
    id: row.id,
    canonicalProductId: row.canonical_product_id,
    variantAttributes: row.variant_attributes ?? {},
    modelSku: row.model_sku,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function rowToSourceListing(row: any): SourceListing {
  return {
    id: row.id,
    productVariantId: row.product_variant_id,
    sourceId: row.source_id,
    externalId: row.external_id,
    externalIdType: row.external_id_type,
    sourceUrl: row.source_url,
    searchKeywordUsed: row.search_keyword_used,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    confidence: row.confidence,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    staleAfterHours: row.stale_after_hours,
    reviewRequired: row.review_required,
    reviewReason: row.review_reason,
    lastKnownPrice: row.last_known_price === null ? null : Number(row.last_known_price),
    lastKnownCurrency: row.last_known_currency,
    lastKnownAvailability: row.last_known_availability,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
