module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/src/adapters/exchangeRate.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** Free, no-key exchange rate lookup. Generic — any base/target currency pair. */ __turbopack_context__.s([
    "getFxRate",
    ()=>getFxRate
]);
async function getFxRate(base, target) {
    const url = `https://open.er-api.com/v6/latest/${base}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Exchange rate API responded ${res.status}`);
    }
    const body = await res.json();
    if (body.result !== "success") {
        throw new Error(`Exchange rate API returned result=${body.result}`);
    }
    const rate = body.rates[target];
    if (!rate) {
        throw new Error(`No rate found for ${base} -> ${target}`);
    }
    return {
        base,
        target,
        rate,
        fetchedAt: new Date().toISOString()
    };
}
}),
"[project]/src/db/supabaseClient.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getSupabaseClient",
    ()=>getSupabaseClient
]);
/**
 * The ONLY file that should import @supabase/supabase-js directly outside
 * of the repository layer. Adapters (src/adapters/*) and services
 * (src/services/*) never import this - services depend on repository
 * *interfaces* (src/repository/types.ts), not on Supabase.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@supabase/supabase-js/dist/index.mjs [app-rsc] (ecmascript) <locals>");
;
let cached = null;
function getSupabaseClient() {
    if (cached) return cached;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment. " + "This is a service-role connection (refresh worker, admin CLI) - never expose this key client-side.");
    }
    cached = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["createClient"])(url, key, {
        auth: {
            persistSession: false
        }
    });
    return cached;
}
}),
"[project]/src/domain/pricing.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "convertToKrw",
    ()=>convertToKrw
]);
/**
 * Single source of truth for "price + currency -> KRW". Both the initial
 * approval (mappingService) and the refresh cycle (refreshService) need
 * this - it used to be duplicated inline in refreshService only, with
 * mappingService just storing null. Comparison (comparisonService) also
 * uses this so all three call sites agree on the exact same conversion.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$adapters$2f$exchangeRate$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/adapters/exchangeRate.ts [app-rsc] (ecmascript)");
;
async function convertToKrw(price, currency) {
    if (currency === "KRW") {
        return {
            krwPrice: price,
            fxRateUsed: 1,
            fxAsOf: null
        };
    }
    const fx = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$adapters$2f$exchangeRate$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getFxRate"])(currency, "KRW");
    return {
        krwPrice: Math.round(price * fx.rate),
        fxRateUsed: fx.rate,
        fxAsOf: fx.fetchedAt
    };
}
}),
"[project]/src/domain/types.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Phase 1 domain model - mirrors the DB schema (supabase/migrations/0001_init.sql)
 * one-to-one, but this is what services/repositories talk in. Category-agnostic:
 * nothing here assumes diving or any other single vertical.
 */ __turbopack_context__.s([
    "REVIEW_REASON_LABELS",
    ()=>REVIEW_REASON_LABELS
]);
const REVIEW_REASON_LABELS = {
    NOT_FOUND: "판매처에서 재확인 안 됨",
    PRICE_JUMP: "가격 급변 감지",
    OUT_OF_STOCK: "품절",
    AMBIGUOUS_MATCH: "매칭 불확실",
    STALE: "장기간 미확인"
};
}),
"[project]/src/repository/supabase/CanonicalProductRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SupabaseCanonicalProductRepository",
    ()=>SupabaseCanonicalProductRepository
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/mappers.ts [app-rsc] (ecmascript)");
;
function rowToProductWithVariant(row) {
    const { canonical_products, ...variantRow } = row;
    return {
        product: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToCanonicalProduct"])(canonical_products),
        variant: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToProductVariant"])(variantRow)
    };
}
class SupabaseCanonicalProductRepository {
    db;
    constructor(db){
        this.db = db;
    }
    async createProduct(input) {
        const { data, error } = await this.db.from("canonical_products").insert({
            category: input.category,
            brand: input.brand,
            official_name: input.officialName
        }).select().single();
        if (error) throw error;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToCanonicalProduct"])(data);
    }
    async createVariant(input) {
        const { data, error } = await this.db.from("product_variants").insert({
            canonical_product_id: input.canonicalProductId,
            variant_attributes: input.variantAttributes,
            model_sku: input.modelSku,
            display_name: input.displayName
        }).select().single();
        if (error) throw error;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToProductVariant"])(data);
    }
    async getVariant(id) {
        const { data, error } = await this.db.from("product_variants").select().eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToProductVariant"])(data) : null;
    }
    async getProduct(id) {
        const { data, error } = await this.db.from("canonical_products").select().eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToCanonicalProduct"])(data) : null;
    }
    async listAllProducts() {
        const { data, error } = await this.db.from("canonical_products").select().order("created_at", {
            ascending: false
        });
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToCanonicalProduct"]);
    }
    async listVariantsForProduct(canonicalProductId) {
        const { data, error } = await this.db.from("product_variants").select().eq("canonical_product_id", canonicalProductId);
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToProductVariant"]);
    }
    async setVariantImageIfMissing(variantId, imageUrl) {
        const { data, error: selErr } = await this.db.from("product_variants").select("image_url").eq("id", variantId).maybeSingle();
        if (selErr) throw selErr;
        if (data?.image_url) return; // never overwrite an existing photo
        const { error } = await this.db.from("product_variants").update({
            image_url: imageUrl
        }).eq("id", variantId);
        if (error) throw error;
    }
    async listAllVariants() {
        const { data, error } = await this.db.from("product_variants").select("*, canonical_products!inner(*)");
        if (error) throw error;
        return (data ?? []).map(rowToProductWithVariant);
    }
    async listVariantsByCategory(category) {
        const { data, error } = await this.db.from("product_variants").select("*, canonical_products!inner(*)").eq("canonical_products.category", category);
        if (error) throw error;
        return (data ?? []).map(rowToProductWithVariant);
    }
    async searchProducts(query) {
        const q = `%${query}%`;
        const [byProduct, byVariant] = await Promise.all([
            this.db.from("product_variants").select("*, canonical_products!inner(*)").or(`brand.ilike.${q},official_name.ilike.${q}`, {
                referencedTable: "canonical_products"
            }),
            this.db.from("product_variants").select("*, canonical_products!inner(*)").ilike("model_sku", q)
        ]);
        if (byProduct.error) throw byProduct.error;
        if (byVariant.error) throw byVariant.error;
        const seen = new Map();
        for (const row of [
            ...byProduct.data ?? [],
            ...byVariant.data ?? []
        ]){
            const mapped = rowToProductWithVariant(row);
            seen.set(mapped.variant.id, mapped);
        }
        return [
            ...seen.values()
        ];
    }
}
}),
"[project]/src/repository/supabase/PriceHistoryRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SupabasePriceHistoryRepository",
    ()=>SupabasePriceHistoryRepository
]);
class SupabasePriceHistoryRepository {
    db;
    constructor(db){
        this.db = db;
    }
    async append(entry) {
        const { error } = await this.db.from("price_history").insert({
            source_listing_id: entry.sourceListingId,
            price: entry.price,
            currency: entry.currency,
            krw_price: entry.krwPrice,
            fx_rate_used: entry.fxRateUsed,
            availability: entry.availability,
            outcome: entry.outcome,
            change_reason: entry.changeReason
        });
        if (error) throw error;
    }
    async listForListing(sourceListingId, limit = 50) {
        const { data, error } = await this.db.from("price_history").select().eq("source_listing_id", sourceListingId).order("checked_at", {
            ascending: false
        }).limit(limit);
        if (error) throw error;
        return (data ?? []).map((row)=>({
                sourceListingId: row.source_listing_id,
                price: row.price === null ? null : Number(row.price),
                currency: row.currency,
                krwPrice: row.krw_price === null ? null : Number(row.krw_price),
                fxRateUsed: row.fx_rate_used === null ? null : Number(row.fx_rate_used),
                availability: row.availability,
                outcome: row.outcome,
                changeReason: row.change_reason
            }));
    }
}
}),
"[project]/src/repository/supabase/ReviewActionRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SupabaseReviewActionRepository",
    ()=>SupabaseReviewActionRepository
]);
class SupabaseReviewActionRepository {
    db;
    constructor(db){
        this.db = db;
    }
    async record(input) {
        const { error } = await this.db.from("review_actions").insert({
            source_listing_id: input.sourceListingId,
            reason: input.reason,
            detected_at: input.detectedAt,
            resolved_by: input.resolvedBy ?? null,
            resolution: input.resolution ?? null,
            note: input.note ?? null
        });
        if (error) throw error;
    }
}
}),
"[project]/src/repository/supabase/SourceListingRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SupabaseSourceListingRepository",
    ()=>SupabaseSourceListingRepository
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/mappers.ts [app-rsc] (ecmascript)");
;
class SupabaseSourceListingRepository {
    db;
    constructor(db){
        this.db = db;
    }
    async create(input) {
        const now = new Date().toISOString();
        const { data, error } = await this.db.from("source_listings").insert({
            product_variant_id: input.productVariantId,
            source_id: input.sourceId,
            external_id: input.externalId,
            external_id_type: input.externalIdType,
            source_url: input.sourceUrl,
            search_keyword_used: input.searchKeywordUsed,
            approved_by: input.approvedBy,
            confidence: input.confidence,
            stale_after_hours: input.staleAfterHours ?? 24,
            last_checked_at: now,
            last_success_at: now,
            review_required: false,
            review_reason: null,
            last_known_price: input.initialPrice,
            last_known_currency: input.initialCurrency,
            last_known_availability: input.initialAvailability
        }).select().single();
        if (error) throw error;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"])(data);
    }
    async getById(id) {
        const { data, error } = await this.db.from("source_listings").select().eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"])(data) : null;
    }
    async findByExternalId(sourceId, externalId) {
        const { data, error } = await this.db.from("source_listings").select().eq("source_id", sourceId).eq("external_id", externalId).maybeSingle();
        if (error) throw error;
        return data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"])(data) : null;
    }
    async listByVariant(productVariantId) {
        const { data, error } = await this.db.from("source_listings").select().eq("product_variant_id", productVariantId).eq("is_active", true);
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"]);
    }
    async listDueForRefresh(sourceId, limit) {
        const { data, error } = await this.db.from("source_listings").select().eq("source_id", sourceId).eq("is_active", true).order("last_checked_at", {
            ascending: true,
            nullsFirst: true
        }).limit(limit);
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"]);
    }
    async listReviewQueue() {
        const { data, error } = await this.db.from("source_listings").select().eq("review_required", true).eq("is_active", true).order("updated_at", {
            ascending: true
        });
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"]);
    }
    async listActiveUnflagged() {
        const { data, error } = await this.db.from("source_listings").select().eq("is_active", true).eq("review_required", false);
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"]);
    }
    async update(id, patch) {
        const dbPatch = {
            updated_at: new Date().toISOString()
        };
        if ("lastCheckedAt" in patch) dbPatch.last_checked_at = patch.lastCheckedAt;
        if ("lastSuccessAt" in patch) dbPatch.last_success_at = patch.lastSuccessAt;
        if ("reviewRequired" in patch) dbPatch.review_required = patch.reviewRequired;
        if ("reviewReason" in patch) dbPatch.review_reason = patch.reviewReason;
        if ("lastKnownPrice" in patch) dbPatch.last_known_price = patch.lastKnownPrice;
        if ("lastKnownCurrency" in patch) dbPatch.last_known_currency = patch.lastKnownCurrency;
        if ("lastKnownAvailability" in patch) dbPatch.last_known_availability = patch.lastKnownAvailability;
        if ("isActive" in patch) dbPatch.is_active = patch.isActive;
        if ("externalId" in patch) dbPatch.external_id = patch.externalId;
        const { data, error } = await this.db.from("source_listings").update(dbPatch).eq("id", id).select().single();
        if (error) throw error;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSourceListing"])(data);
    }
}
}),
"[project]/src/repository/supabase/SourceRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SupabaseSourceRepository",
    ()=>SupabaseSourceRepository
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/mappers.ts [app-rsc] (ecmascript)");
;
class SupabaseSourceRepository {
    db;
    constructor(db){
        this.db = db;
    }
    async listAll() {
        const { data, error } = await this.db.from("sources").select();
        if (error) throw error;
        return (data ?? []).map(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSource"]);
    }
    async getById(id) {
        const { data, error } = await this.db.from("sources").select().eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$mappers$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["rowToSource"])(data) : null;
    }
}
}),
"[project]/src/repository/supabase/index.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createSupabaseRepositories",
    ()=>createSupabaseRepositories
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$db$2f$supabaseClient$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/db/supabaseClient.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$SourceRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/SourceRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$CanonicalProductRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/CanonicalProductRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$SourceListingRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/SourceListingRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$PriceHistoryRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/PriceHistoryRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$ReviewActionRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/ReviewActionRepository.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
function createSupabaseRepositories() {
    const db = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$db$2f$supabaseClient$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getSupabaseClient"])();
    return {
        sources: new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$SourceRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SupabaseSourceRepository"](db),
        canonicalProducts: new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$CanonicalProductRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SupabaseCanonicalProductRepository"](db),
        sourceListings: new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$SourceListingRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SupabaseSourceListingRepository"](db),
        priceHistory: new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$PriceHistoryRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SupabasePriceHistoryRepository"](db),
        reviewActions: new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$ReviewActionRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SupabaseReviewActionRepository"](db)
    };
}
}),
"[project]/src/repository/supabase/mappers.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** snake_case DB row <-> camelCase domain object mappers. */ __turbopack_context__.s([
    "rowToCanonicalProduct",
    ()=>rowToCanonicalProduct,
    "rowToProductVariant",
    ()=>rowToProductVariant,
    "rowToSource",
    ()=>rowToSource,
    "rowToSourceListing",
    ()=>rowToSourceListing
]);
function rowToSource(row) {
    return {
        id: row.id,
        name: row.name,
        region: row.region,
        updateMethod: row.update_method,
        automationStatus: row.automation_status,
        defaultStaleAfterHours: row.default_stale_after_hours,
        rateLimitPerHour: row.rate_limit_per_hour
    };
}
function rowToCanonicalProduct(row) {
    return {
        id: row.id,
        category: row.category,
        brand: row.brand,
        officialName: row.official_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function rowToProductVariant(row) {
    return {
        id: row.id,
        canonicalProductId: row.canonical_product_id,
        variantAttributes: row.variant_attributes ?? {},
        modelSku: row.model_sku,
        displayName: row.display_name,
        imageUrl: row.image_url ?? null,
        createdAt: row.created_at
    };
}
function rowToSourceListing(row) {
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
        updatedAt: row.updated_at
    };
}
}),
"[project]/src/services/comparisonService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "compareVariant",
    ()=>compareVariant
]);
/**
 * Price comparison engine. Deliberately depends ONLY on SourceListingRepository
 * - it has no import path to affiliate_programs or anything commission-related.
 * That is not an accident: ranking must be computed from real prices alone
 * (Phase 1 request: "commission rate / affiliate 여부 / sponsored 여부를
 * 사용해 winner를 결정하지 마세요").
 *
 * No hardcoded assumption of "KR/직구/JP" - this just groups whatever active
 * source_listings exist for the variant, by however many there are.
 *
 * Unavailable legs (last_known_availability === false) are excluded from the
 * comparison entirely - an out-of-stock offer can't be a real "winner", and
 * with it removed the remaining legs are compared exactly as if it never
 * existed (2 legs left -> normal n-way over those 2, no special-casing).
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/domain/pricing.ts [app-rsc] (ecmascript)");
;
async function compareVariant(repos, productVariantId) {
    const listings = (await repos.sourceListings.listByVariant(productVariantId)).filter((l)=>l.lastKnownPrice !== null && l.lastKnownAvailability !== false);
    if (listings.length === 0) {
        return {
            productVariantId,
            mode: "no-data",
            legCount: 0,
            legs: []
        };
    }
    const legs = [];
    for (const listing of listings){
        const currency = listing.lastKnownCurrency ?? "KRW";
        const { krwPrice, fxRateUsed, fxAsOf } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["convertToKrw"])(listing.lastKnownPrice, currency);
        legs.push({
            sourceListingId: listing.id,
            sourceId: listing.sourceId,
            price: listing.lastKnownPrice,
            currency,
            krwPrice,
            availability: listing.lastKnownAvailability,
            isWinner: false,
            diffFromWinnerKrw: 0,
            savingsVsHighestKrw: 0,
            fxRateUsed: currency === "KRW" ? null : fxRateUsed,
            fxAsOf
        });
    }
    legs.sort((a, b)=>a.krwPrice - b.krwPrice);
    const winnerPrice = legs[0].krwPrice;
    const highestPrice = legs[legs.length - 1].krwPrice;
    for (const leg of legs){
        leg.isWinner = leg.krwPrice === winnerPrice;
        leg.diffFromWinnerKrw = leg.krwPrice - winnerPrice;
        leg.savingsVsHighestKrw = highestPrice - leg.krwPrice;
    }
    return {
        productVariantId,
        mode: legs.length === 1 ? "single" : "n-way",
        legCount: legs.length,
        legs
    };
}
}),
"[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ProductImage",
    ()=>ProductImage
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const ProductImage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call ProductImage() from the server but ProductImage is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/web/app/(site)/components/ProductImage.tsx", "ProductImage");
}),
"[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ProductImage",
    ()=>ProductImage
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const ProductImage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call ProductImage() from the server but ProductImage is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/web/app/(site)/components/ProductImage.tsx <module evaluation>", "ProductImage");
}),
"[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/web/app/(site)/lib/conclusion.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildConclusion",
    ()=>buildConclusion,
    "legsByRegion",
    ()=>legsByRegion
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/format.ts [app-rsc] (ecmascript)");
;
function legsByRegion(comparison, regionOf) {
    const map = {};
    for (const leg of comparison.legs){
        const region = regionOf(leg.sourceId);
        if (region) map[region] = leg;
    }
    return map;
}
const CLOSE_ENOUGH_RATIO = 0.02; // under 2% apart reads as "no real difference"
const REGION_PLACE = {
    KR: "한국",
    JP: "일본",
    INTL: "해외직구"
};
function buildConclusion(comparison, regionOf) {
    if (comparison.mode === "no-data") {
        return {
            tone: "no-data",
            cardLine: "가격 정보 없음",
            headline: "아직 비교할 가격 정보가 없어요",
            savingsLine: null
        };
    }
    if (comparison.mode === "single") {
        return {
            tone: "single",
            cardLine: "현재 비교 가능한 판매처가 1곳이에요",
            headline: "현재 비교 가능한 판매처가 1곳이에요",
            savingsLine: null
        };
    }
    const winner = comparison.legs.find((l)=>l.isWinner) ?? comparison.legs[0];
    const highest = winner.krwPrice + winner.savingsVsHighestKrw;
    const ratio = highest > 0 ? winner.savingsVsHighestKrw / highest : 0;
    if (ratio < CLOSE_ENOUGH_RATIO) {
        return {
            tone: "close",
            cardLine: "가격 차이가 거의 없어요",
            headline: "가격 차이가 거의 없어요",
            savingsLine: winner.savingsVsHighestKrw > 0 ? `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw)} 차이` : null
        };
    }
    const region = regionOf(winner.sourceId);
    const place = region && REGION_PLACE[region] || "이곳";
    const savingsLine = `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw)} 절약`;
    return {
        tone: region === "KR" ? "kr" : region === "JP" ? "jp" : "intl",
        cardLine: region === "KR" ? `한국에서 사는 게 ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw)} 저렴해요` : `${place}에서 사면 ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw)} 절약`,
        headline: `${place}에서 사는 게 가장 저렴해요`,
        savingsLine
    };
}
}),
"[project]/web/app/(site)/products/[id]/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>ProductVariantPage,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$api$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/api/navigation.react-server.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/components/navigation.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$index$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/index.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$comparisonService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/services/comparisonService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/domain/pricing.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/domain/types.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/lib/conclusion.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/format.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/Icons.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
const dynamic = "force-dynamic";
const REGION_KO = {
    KR: "한국",
    JP: "일본",
    INTL: "해외직구"
};
async function ProductVariantPage({ params }) {
    const { id: variantId } = await params;
    const repos = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$index$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createSupabaseRepositories"])();
    const variant = await repos.canonicalProducts.getVariant(variantId);
    if (!variant) (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["notFound"])();
    const [product, listings, sources, comparison] = await Promise.all([
        repos.canonicalProducts.getProduct(variant.canonicalProductId),
        repos.sourceListings.listByVariant(variantId),
        repos.sources.listAll(),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$comparisonService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["compareVariant"])(repos, variantId)
    ]);
    if (!product) (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["notFound"])();
    const sourceById = new Map(sources.map((s)=>[
            s.id,
            s
        ]));
    const regionOf = (sourceId)=>sourceById.get(sourceId)?.region;
    const listingById = new Map(listings.map((l)=>[
            l.id,
            l
        ]));
    const conclusion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildConclusion"])(comparison, regionOf);
    const byRegion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["legsByRegion"])(comparison, regionOf); // {KR?: leg, JP?: leg, ...}
    const winner = comparison.legs.find((l)=>l.isWinner);
    const winnerRegion = winner ? regionOf(winner.sourceId) : undefined;
    const fxLeg = comparison.legs.find((l)=>l.fxRateUsed !== null);
    // real out-of-stock listings that compareVariant excludes from ranking -
    // still shown, per spec, as "품절 · 비교 제외" rows, never as a fake price.
    // KRW conversion reuses the same convertToKrw() the comparison service uses -
    // no separate FX math for this row.
    const outOfStockListings = await Promise.all(listings.filter((l)=>l.lastKnownPrice !== null && l.lastKnownAvailability === false).map(async (listing)=>{
        const conv = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["convertToKrw"])(listing.lastKnownPrice, listing.lastKnownCurrency ?? "KRW");
        return {
            listing,
            krwPrice: conv.krwPrice
        };
    }));
    const mostRecentCheck = listings.map((l)=>l.lastCheckedAt).filter((x)=>!!x).sort().at(-1);
    const variantAttrs = Object.entries(variant.variantAttributes ?? {});
    const variantLabel = variantAttrs.length > 0 ? variantAttrs.map(([k, v])=>`${k}: ${v}`).join(" · ") : variant.displayName;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "wrap pd-topbar",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                    href: "/",
                    className: "back-link",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["BackIcon"], {}, void 0, false, {
                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                            lineNumber: 68,
                            columnNumber: 11
                        }, this),
                        "목록으로"
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                    lineNumber: 67,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 66,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "wrap pd-grid",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ProductImage"], {
                        src: variant.imageUrl,
                        alt: `${product.brand} ${product.officialName}`,
                        className: "pd-media",
                        sizes: "(min-width: 880px) 460px, 100vw"
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 74,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "pd-brand",
                                children: product.brand
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 82,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "pd-name",
                                children: product.officialName
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 83,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "pd-variant",
                                children: [
                                    variantLabel,
                                    variant.modelSku ? ` · 모델명 ${variant.modelSku}` : ""
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 84,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "verdict-label",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                                        region: winnerRegion
                                    }, void 0, false, {
                                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                        lineNumber: 90,
                                        columnNumber: 13
                                    }, this),
                                    conclusion.headline
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 89,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "verdict-big",
                                children: (conclusion.tone === "kr" || conclusion.tone === "jp") && winner ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "verdict-num num",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw).replace("원", "")
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 97,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "verdict-unit",
                                            children: "원 차이"
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 98,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                    lineNumber: 96,
                                    columnNumber: 15
                                }, this) : conclusion.tone === "close" && winner ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "verdict-num plain num",
                                    children: conclusion.savingsLine
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                    lineNumber: 101,
                                    columnNumber: 15
                                }, this) : comparison.legs[0] ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "verdict-num plain num",
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(comparison.legs[0].krwPrice)
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                    lineNumber: 103,
                                    columnNumber: 15
                                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "verdict-num plain num",
                                    children: "가격 정보 없음"
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                    lineNumber: 105,
                                    columnNumber: 15
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 94,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "verdict-note",
                                children: byRegion.KR && byRegion.JP ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                                    children: [
                                        "한국 ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: "num",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(byRegion.KR.krwPrice)
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 112,
                                            columnNumber: 20
                                        }, this),
                                        " · 일본",
                                        " ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: "num",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(byRegion.JP.krwPrice)
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 113,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                    lineNumber: 111,
                                    columnNumber: 15
                                }, this) : comparison.mode === "single" ? "다른 시장의 비교 가능한 판매처를 아직 확인하지 못했어요" : ""
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 109,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "price-rows",
                                children: [
                                    [
                                        "KR",
                                        "JP"
                                    ].map((region)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(PriceRow, {
                                            region: region,
                                            leg: byRegion[region],
                                            listing: byRegion[region] ? listingById.get(byRegion[region].sourceListingId) : undefined,
                                            source: byRegion[region] ? sourceById.get(byRegion[region].sourceId) : undefined
                                        }, region, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 124,
                                            columnNumber: 15
                                        }, this)),
                                    outOfStockListings.map(({ listing, krwPrice })=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(OutOfStockRow, {
                                            listing: listing,
                                            krwPrice: krwPrice,
                                            source: sourceById.get(listing.sourceId)
                                        }, listing.id, false, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 133,
                                            columnNumber: 15
                                        }, this))
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 122,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "pd-meta-foot",
                                children: [
                                    "모델번호 ",
                                    variant.modelSku ?? "확인 안 됨",
                                    listings.filter((l)=>l.lastKnownPrice !== null).map((l)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("br", {}, void 0, false, {
                                                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                                    lineNumber: 143,
                                                    columnNumber: 19
                                                }, this),
                                                REGION_KO[regionOf(l.sourceId) ?? ""] ?? l.sourceId,
                                                ": ",
                                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatCheckedDateTime"])(l.lastCheckedAt),
                                                " ·",
                                                " ",
                                                __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CONFIDENCE_LABEL"][l.confidence],
                                                l.reviewRequired && ` · 검수 필요(${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$domain$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["REVIEW_REASON_LABELS"][l.reviewReason] ?? l.reviewReason})`
                                            ]
                                        }, l.id, true, {
                                            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                            lineNumber: 142,
                                            columnNumber: 17
                                        }, this))
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 137,
                                columnNumber: 11
                            }, this),
                            fxLeg && fxLeg.fxRateUsed !== null && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "fx-note",
                                children: [
                                    "환율 100엔 = ",
                                    (fxLeg.fxRateUsed * 100).toFixed(1),
                                    "원 적용 · JPY → KRW 환산 기준 · ",
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatAsOf"])(fxLeg.fxAsOf)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 152,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "pd-note",
                                children: "가격은 온라인 판매처 공개 정보를 기준으로 확인 시점에 산정하며, 환율 및 판매처 가격 변경 시 실제 금액과 차이가 있을 수 있습니다."
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                                lineNumber: 157,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 81,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 73,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
        lineNumber: 65,
        columnNumber: 5
    }, this);
}
function PriceRow({ region, leg, listing, source }) {
    if (!leg || !listing) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "prow prow--muted",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                    region: region
                }, void 0, false, {
                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                    lineNumber: 181,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "prow-label",
                    children: [
                        REGION_KO[region],
                        " 판매처를 아직 확인하지 못했어요"
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                    lineNumber: 182,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
            lineNumber: 180,
            columnNumber: 7
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: `prow${leg.isWinner ? " prow--win" : ""}`,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                region: region
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 189,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "prow-label",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                        children: REGION_KO[region]
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 191,
                        columnNumber: 9
                    }, this),
                    " · ",
                    source?.name ?? listing.sourceId
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 190,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "prow-price-wrap",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "prow-price num",
                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(leg.krwPrice)
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 194,
                        columnNumber: 9
                    }, this),
                    leg.fxRateUsed !== null && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "prow-price-sub num",
                        children: [
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatPrice"])(leg.price, leg.currency),
                            " · 환율 적용"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 196,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 193,
                columnNumber: 7
            }, this),
            listing.sourceUrl && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("a", {
                className: "prow-cta",
                href: listing.sourceUrl,
                target: "_blank",
                rel: "noopener noreferrer",
                children: "바로가기"
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 200,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
        lineNumber: 188,
        columnNumber: 5
    }, this);
}
function OutOfStockRow({ listing, krwPrice, source }) {
    const isJpy = listing.lastKnownCurrency !== "KRW";
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "prow prow--muted",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                region: source?.region
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 220,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "prow-label",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                        children: REGION_KO[source?.region ?? ""] ?? listing.sourceId
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 222,
                        columnNumber: 9
                    }, this),
                    " · 품절 · 비교 제외"
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 221,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "prow-price-wrap",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "prow-price strike num",
                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(krwPrice)
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 225,
                        columnNumber: 9
                    }, this),
                    isJpy && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "prow-price-sub num",
                        children: [
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatPrice"])(listing.lastKnownPrice ?? 0, listing.lastKnownCurrency ?? "KRW"),
                            " · 환율 적용"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                        lineNumber: 227,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
                lineNumber: 224,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/products/[id]/page.tsx",
        lineNumber: 219,
        columnNumber: 5
    }, this);
}
}),
"[project]/web/app/(site)/products/[id]/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/web/app/(site)/products/[id]/page.tsx [app-rsc] (ecmascript)"));
}),
"[project]/web/app/lib/format.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CONFIDENCE_LABEL",
    ()=>CONFIDENCE_LABEL,
    "REGION_LABEL",
    ()=>REGION_LABEL,
    "formatAsOf",
    ()=>formatAsOf,
    "formatCheckedDate",
    ()=>formatCheckedDate,
    "formatCheckedDateTime",
    ()=>formatCheckedDateTime,
    "formatKrw",
    ()=>formatKrw,
    "formatPrice",
    ()=>formatPrice
]);
function formatKrw(n) {
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function formatPrice(n, currency) {
    if (currency === "KRW") return formatKrw(n);
    if (currency === "JPY") return `¥${n.toLocaleString("ja-JP")}`;
    if (currency === "USD") return `$${n.toLocaleString("en-US")}`;
    return `${n.toLocaleString()} ${currency}`;
}
function formatCheckedDate(iso) {
    if (!iso) return "확인 이력 없음";
    const d = new Date(iso);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 확인`;
}
function formatCheckedDateTime(iso) {
    if (!iso) return "확인 이력 없음";
    const d = new Date(iso);
    const date = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    const time = d.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit"
    });
    return `${date} ${time} 확인`;
}
const REGION_LABEL = {
    KR: "한국",
    JP: "일본",
    INTL: "해외직구"
};
const CONFIDENCE_LABEL = {
    verified: "SKU 확인됨",
    estimated: "이름 매칭 (SKU 미확인)"
};
function formatAsOf(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const time = d.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit"
    });
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time} 기준`;
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0l3929r._.js.map