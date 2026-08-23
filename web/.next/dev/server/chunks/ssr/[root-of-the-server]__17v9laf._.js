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
    async updateVariantImage(variantId, imageUrl) {
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
"[project]/src/services/catalogService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Browse/search aggregation for the home and category pages. Winner/savings
 * numbers always come from compareVariant() (src/services/comparisonService.ts)
 * - nothing here recomputes a price ranking. This file only sorts/filters
 * using that service's output, so there is exactly one place price-winner
 * logic lives.
 */ __turbopack_context__.s([
    "listByCategory",
    ()=>listByCategory,
    "listMeaningfulPriceGaps",
    ()=>listMeaningfulPriceGaps,
    "listRecentlyChecked",
    ()=>listRecentlyChecked,
    "searchCatalog",
    ()=>searchCatalog
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$comparisonService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/services/comparisonService.ts [app-rsc] (ecmascript)");
;
async function buildEntry(repos, product, variant) {
    const [listings, comparison] = await Promise.all([
        repos.sourceListings.listByVariant(variant.id),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$comparisonService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["compareVariant"])(repos, variant.id)
    ]);
    const lastCheckedAt = listings.map((l)=>l.lastCheckedAt).filter((x)=>!!x).sort().at(-1) ?? null;
    return {
        product,
        variant,
        listings,
        comparison,
        lastCheckedAt
    };
}
async function listByCategory(repos, category) {
    const pairs = await repos.canonicalProducts.listVariantsByCategory(category);
    return Promise.all(pairs.map(({ product, variant })=>buildEntry(repos, product, variant)));
}
async function searchCatalog(repos, query) {
    if (!query.trim()) return [];
    const pairs = await repos.canonicalProducts.searchProducts(query.trim());
    return Promise.all(pairs.map(({ product, variant })=>buildEntry(repos, product, variant)));
}
async function listMeaningfulPriceGaps(repos, limit = 5) {
    const pairs = await repos.canonicalProducts.listAllVariants();
    const entries = await Promise.all(pairs.map(({ product, variant })=>buildEntry(repos, product, variant)));
    return entries.filter((e)=>e.comparison.mode === "n-way").sort((a, b)=>{
        const aSavings = a.comparison.legs.find((l)=>l.isWinner)?.savingsVsHighestKrw ?? 0;
        const bSavings = b.comparison.legs.find((l)=>l.isWinner)?.savingsVsHighestKrw ?? 0;
        return bSavings - aSavings;
    }).slice(0, limit);
}
async function listRecentlyChecked(repos, limit = 5) {
    const pairs = await repos.canonicalProducts.listAllVariants();
    const entries = await Promise.all(pairs.map(({ product, variant })=>buildEntry(repos, product, variant)));
    return entries.filter((e)=>e.lastCheckedAt !== null).sort((a, b)=>b.lastCheckedAt > a.lastCheckedAt ? 1 : -1).slice(0, limit);
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
"[project]/web/app/(site)/components/HeroSignatureCard.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "HeroSignatureCard",
    ()=>HeroSignatureCard
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
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
function HeroSignatureCard({ entry, sourceRegion }) {
    const regionOf = (sourceId)=>sourceRegion[sourceId];
    const conclusion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildConclusion"])(entry.comparison, regionOf);
    const byRegion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["legsByRegion"])(entry.comparison, regionOf);
    const winner = entry.comparison.legs.find((l)=>l.isWinner);
    const winnerRegion = winner ? regionOf(winner.sourceId) : undefined;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
        href: `/products/${entry.variant.id}`,
        className: "hero-card",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "hero-card-top",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ProductImage"], {
                        src: entry.variant.imageUrl,
                        alt: `${entry.product.brand} ${entry.product.officialName}`,
                        className: "hero-card-img",
                        sizes: "64px"
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 24,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "hero-card-name-wrap",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "hero-card-brand",
                                children: entry.product.brand
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                lineNumber: 31,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "hero-card-name",
                                children: entry.product.officialName
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                lineNumber: 32,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 30,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                lineNumber: 23,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "hc-rows",
                children: [
                    "JP",
                    "KR"
                ].map((region)=>{
                    const leg = byRegion[region];
                    if (!leg) return null;
                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "hc-row",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                                region: region
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                lineNumber: 42,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "hc-country",
                                children: region === "JP" ? "일본" : "한국"
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                lineNumber: 43,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "hc-price-wrap",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: `hc-price num${leg.isWinner ? " win" : ""}`,
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(leg.krwPrice)
                                    }, void 0, false, {
                                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                        lineNumber: 45,
                                        columnNumber: 17
                                    }, this),
                                    region === "JP" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "hc-price-sub num",
                                        children: [
                                            "¥",
                                            leg.price.toLocaleString("ja-JP"),
                                            " · 환율 적용"
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                        lineNumber: 47,
                                        columnNumber: 19
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                                lineNumber: 44,
                                columnNumber: 15
                            }, this)
                        ]
                    }, region, true, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 41,
                        columnNumber: 13
                    }, this);
                })
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                lineNumber: 36,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "hc-verdict-label",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                        region: winnerRegion
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 56,
                        columnNumber: 9
                    }, this),
                    conclusion.headline
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                lineNumber: 55,
                columnNumber: 7
            }, this),
            conclusion.savingsLine && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "hc-diff",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "hc-diff-num num",
                        children: conclusion.savingsLine.replace(/[^0-9,]/g, "")
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 61,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "hc-diff-unit",
                        children: conclusion.savingsLine.replace(/[0-9,]/g, "").trim()
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                        lineNumber: 62,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
                lineNumber: 60,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/components/HeroSignatureCard.tsx",
        lineNumber: 22,
        columnNumber: 5
    }, this);
}
}),
"[project]/web/app/(site)/components/ProductCardGrid.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ProductCardGrid",
    ()=>ProductCardGrid
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/lib/conclusion.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/format.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/Icons.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/categories.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
function ProductCardGrid({ entries, sourceRegion }) {
    if (entries.length === 0) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
            style: {
                color: "var(--slate-400)",
                fontSize: 13,
                padding: "20px 0"
            },
            children: "아직 비교할 상품이 없어요."
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 18,
            columnNumber: 12
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "product-grid",
        children: entries.map((entry)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(ProductCard, {
                entry: entry,
                sourceRegion: sourceRegion
            }, entry.variant.id, false, {
                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                lineNumber: 24,
                columnNumber: 9
            }, this))
    }, void 0, false, {
        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
        lineNumber: 22,
        columnNumber: 5
    }, this);
}
function ProductCard({ entry, sourceRegion }) {
    const { product, variant, comparison } = entry;
    const regionOf = (sourceId)=>sourceRegion[sourceId];
    const conclusion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildConclusion"])(comparison, regionOf);
    const byRegion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["legsByRegion"])(comparison, regionOf);
    const kr = byRegion.KR;
    const jp = byRegion.JP;
    const categoryLabel = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["findCategory"])(product.category)?.label ?? product.category;
    let diffBlock;
    let priceBlock;
    if (conclusion.tone === "kr" || conclusion.tone === "jp") {
        const winner = comparison.legs.find((l)=>l.isWinner);
        diffBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "pcard-diff num",
            children: [
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw).replace("원", ""),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    className: "unit",
                    children: "원 차이"
                }, void 0, false, {
                    fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                    lineNumber: 47,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 45,
            columnNumber: 7
        }, this);
        priceBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(PricesLine, {
            kr: kr,
            jp: jp
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 50,
            columnNumber: 18
        }, this);
    } else if (conclusion.tone === "close") {
        diffBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "pcard-diff flat num",
            children: conclusion.savingsLine
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 52,
            columnNumber: 17
        }, this);
        priceBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(PricesLine, {
            kr: kr,
            jp: jp
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 53,
            columnNumber: 18
        }, this);
    } else {
        // single (or no-data, defensively)
        const only = comparison.legs[0];
        diffBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "pcard-diff plain num",
            children: only ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(only.krwPrice) : "가격 정보 없음"
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 57,
            columnNumber: 17
        }, this);
        priceBlock = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "pcard-prices",
            children: "다른 시장의 판매처를 아직 확인하지 못했어요"
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
            lineNumber: 58,
            columnNumber: 18
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
        href: `/products/${variant.id}`,
        className: "pcard",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ProductImage"], {
                src: variant.imageUrl,
                alt: `${product.brand} ${product.officialName}`,
                className: "pmedia",
                sizes: "(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 60vw"
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                lineNumber: 63,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "pcard-body",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "pcard-brand",
                        children: [
                            product.brand,
                            " · ",
                            categoryLabel
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 65,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "pcard-name",
                        children: product.officialName
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 68,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "pcard-label",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CountryMark"], {
                                region: conclusion.tone === "kr" ? "KR" : conclusion.tone === "jp" ? "JP" : undefined
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                                lineNumber: 70,
                                columnNumber: 11
                            }, this),
                            conclusion.headline
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 69,
                        columnNumber: 9
                    }, this),
                    diffBlock,
                    priceBlock
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                lineNumber: 64,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
        lineNumber: 62,
        columnNumber: 5
    }, this);
}
function PricesLine({ kr, jp }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "pcard-prices num",
        children: [
            kr && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    "KR ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(kr.krwPrice)
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 85,
                        columnNumber: 14
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                lineNumber: 84,
                columnNumber: 9
            }, this),
            kr && jp && " · ",
            jp && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    "JP ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(jp.krwPrice)
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 91,
                        columnNumber: 14
                    }, this),
                    " ",
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        style: {
                            color: "var(--slate-400)",
                            fontWeight: 500
                        },
                        children: [
                            "(¥",
                            jp.price.toLocaleString("ja-JP"),
                            ")"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                        lineNumber: 92,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
                lineNumber: 90,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/components/ProductCardGrid.tsx",
        lineNumber: 82,
        columnNumber: 5
    }, this);
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
"[project]/web/app/(site)/components/RecentRowList.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RecentRowList",
    ()=>RecentRowList
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/lib/conclusion.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/format.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/Icons.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductImage.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/categories.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
function RecentRowList({ entries, sourceRegion }) {
    if (entries.length === 0) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
            style: {
                color: "var(--slate-400)",
                fontSize: 13,
                padding: "20px 0"
            },
            children: "아직 확인된 상품이 없어요."
        }, void 0, false, {
            fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
            lineNumber: 11,
            columnNumber: 12
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "recent-list",
        children: entries.map((entry)=>{
            const conclusion = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$lib$2f$conclusion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["buildConclusion"])(entry.comparison, (sourceId)=>sourceRegion[sourceId]);
            const isMuted = conclusion.tone === "close" || conclusion.tone === "single" || conclusion.tone === "no-data";
            const winner = entry.comparison.legs.find((l)=>l.isWinner);
            const categoryLabel = (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["findCategory"])(entry.product.category)?.label ?? entry.product.category;
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                href: `/products/${entry.variant.id}`,
                className: "recent-row",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductImage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ProductImage"], {
                        src: entry.variant.imageUrl,
                        alt: `${entry.product.brand} ${entry.product.officialName}`,
                        className: "recent-thumb",
                        sizes: "50px"
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                        lineNumber: 24,
                        columnNumber: 13
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "recent-mid",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "recent-name",
                                children: entry.product.officialName
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                                lineNumber: 31,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "recent-cat",
                                children: [
                                    entry.product.brand,
                                    " · ",
                                    categoryLabel
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                                lineNumber: 32,
                                columnNumber: 15
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                        lineNumber: 30,
                        columnNumber: 13
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: `recent-concl${isMuted ? " muted" : ""}`,
                        children: winner && !isMuted ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "num",
                                    children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatKrw"])(winner.savingsVsHighestKrw)
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                                    lineNumber: 39,
                                    columnNumber: 19
                                }, this),
                                " 차이"
                            ]
                        }, void 0, true, {
                            fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                            lineNumber: 38,
                            columnNumber: 17
                        }, this) : conclusion.cardLine
                    }, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                        lineNumber: 36,
                        columnNumber: 13
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ChevronRightIcon"], {}, void 0, false, {
                        fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                        lineNumber: 45,
                        columnNumber: 13
                    }, this)
                ]
            }, entry.variant.id, true, {
                fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
                lineNumber: 23,
                columnNumber: 11
            }, this);
        })
    }, void 0, false, {
        fileName: "[project]/web/app/(site)/components/RecentRowList.tsx",
        lineNumber: 15,
        columnNumber: 5
    }, this);
}
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
"[project]/web/app/(site)/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>HomePage,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$index$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/repository/supabase/index.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$catalogService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/services/catalogService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/lib/categories.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$HeroSignatureCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/HeroSignatureCard.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductCardGrid$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/ProductCardGrid.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$RecentRowList$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/RecentRowList.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/web/app/(site)/components/Icons.tsx [app-rsc] (ecmascript)");
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
async function HomePage() {
    const repos = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$repository$2f$supabase$2f$index$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createSupabaseRepositories"])();
    const [gaps, recent, sources] = await Promise.all([
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$catalogService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["listMeaningfulPriceGaps"])(repos, 8),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$services$2f$catalogService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["listRecentlyChecked"])(repos, 6),
        repos.sources.listAll()
    ]);
    const sourceRegion = Object.fromEntries(sources.map((s)=>[
            s.id,
            s.region
        ]));
    const heroEntry = gaps[0];
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "hero",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "wrap hero-grid",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                                    children: [
                                        "한국에서 살까,",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("br", {}, void 0, false, {
                                            fileName: "[project]/web/app/(site)/page.tsx",
                                            lineNumber: 31,
                                            columnNumber: 15
                                        }, this),
                                        "일본에서 살까?"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 29,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                    className: "lead",
                                    children: "여행 전에 가격부터 비교하세요."
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 34,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                    className: "sub",
                                    children: "같은 상품의 한국·일본 가격 차이를 한눈에 확인해보세요."
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 35,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("form", {
                                    action: "/search",
                                    method: "GET",
                                    className: "search-bar",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SearchIcon"], {
                                            color: "#9AA3B2",
                                            size: 17
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/page.tsx",
                                            lineNumber: 37,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                            type: "text",
                                            name: "q",
                                            placeholder: "상품명, 브랜드, 모델명으로 검색해보세요"
                                        }, void 0, false, {
                                            fileName: "[project]/web/app/(site)/page.tsx",
                                            lineNumber: 38,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                            type: "submit",
                                            className: "search-btn",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SearchIcon"], {
                                                    color: "#fff",
                                                    size: 15
                                                }, void 0, false, {
                                                    fileName: "[project]/web/app/(site)/page.tsx",
                                                    lineNumber: 40,
                                                    columnNumber: 17
                                                }, this),
                                                "검색"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/web/app/(site)/page.tsx",
                                            lineNumber: 39,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 36,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "hero-foot",
                                    children: "한국 · 일본 온라인 판매가를 환율 적용 원화 기준으로 바로 비교해드려요"
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 44,
                                    columnNumber: 13
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 28,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "hero-stage",
                            children: heroEntry ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$HeroSignatureCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["HeroSignatureCard"], {
                                entry: heroEntry,
                                sourceRegion: sourceRegion
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/page.tsx",
                                lineNumber: 49,
                                columnNumber: 15
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                style: {
                                    padding: 24,
                                    color: "var(--slate-400)",
                                    fontSize: 13
                                },
                                children: "아직 비교할 상품이 없어요."
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/page.tsx",
                                lineNumber: 51,
                                columnNumber: 15
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 47,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/page.tsx",
                    lineNumber: 27,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/page.tsx",
                lineNumber: 26,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "wrap",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "cat-row",
                    children: __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f$lib$2f$categories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CATEGORIES"].map((c)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                            href: `/categories/${c.slug}`,
                            className: "cat-pill",
                            children: [
                                __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$Icons$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["CAT_ICON"][c.slug],
                                c.label
                            ]
                        }, c.slug, true, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 62,
                            columnNumber: 13
                        }, this))
                }, void 0, false, {
                    fileName: "[project]/web/app/(site)/page.tsx",
                    lineNumber: 60,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/page.tsx",
                lineNumber: 59,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "block",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "wrap",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "block-head",
                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "block-title",
                                        children: "가격 차이가 큰 상품"
                                    }, void 0, false, {
                                        fileName: "[project]/web/app/(site)/page.tsx",
                                        lineNumber: 74,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "block-sub",
                                        children: "최근 확인 기준으로, 판매처 간 가격 차이가 큰 상품이에요"
                                    }, void 0, false, {
                                        fileName: "[project]/web/app/(site)/page.tsx",
                                        lineNumber: 75,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/web/app/(site)/page.tsx",
                                lineNumber: 73,
                                columnNumber: 13
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 72,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$ProductCardGrid$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ProductCardGrid"], {
                            entries: gaps,
                            sourceRegion: sourceRegion
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 78,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/page.tsx",
                    lineNumber: 71,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/page.tsx",
                lineNumber: 70,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "block alt",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "wrap",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "block-head",
                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "block-title",
                                children: "최근 가격을 확인한 상품"
                            }, void 0, false, {
                                fileName: "[project]/web/app/(site)/page.tsx",
                                lineNumber: 85,
                                columnNumber: 13
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 84,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$web$2f$app$2f28$site$292f$components$2f$RecentRowList$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["RecentRowList"], {
                            entries: recent,
                            sourceRegion: sourceRegion
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 87,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/page.tsx",
                    lineNumber: 83,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/page.tsx",
                lineNumber: 82,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("footer", {
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "wrap",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "foot-logo",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "logo-a",
                                    children: "얼마"
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 94,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "logo-b",
                                    children: "차이"
                                }, void 0, false, {
                                    fileName: "[project]/web/app/(site)/page.tsx",
                                    lineNumber: 95,
                                    columnNumber: 13
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 93,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "foot-desc",
                            children: "한국·일본 온라인 판매가를 비교해 얼마나 차이 나는지 알려드리는 가격비교 서비스입니다."
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 97,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$web$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "foot-disclaimer",
                            children: "표시된 가격은 각 온라인 판매처가 공개한 정보를 기준으로 확인 시점에 산정한 참고용 정보이며, 일본 가격은 확인 시점의 환율을 적용해 원화로 환산해 보여드립니다. 환율 변동이나 판매처 가격 변경에 따라 실제 결제 금액과 차이가 있을 수 있습니다. © 얼마차이"
                        }, void 0, false, {
                            fileName: "[project]/web/app/(site)/page.tsx",
                            lineNumber: 98,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/web/app/(site)/page.tsx",
                    lineNumber: 92,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/web/app/(site)/page.tsx",
                lineNumber: 91,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/web/app/(site)/page.tsx",
        lineNumber: 25,
        columnNumber: 5
    }, this);
}
}),
"[project]/web/app/(site)/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/web/app/(site)/page.tsx [app-rsc] (ecmascript)"));
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

//# sourceMappingURL=%5Broot-of-the-server%5D__17v9laf._.js.map