/**
 * Bridge: adapters/rakutenProduct.ts (data-sources branch) -> domain/providerListing.ts
 * (multi-source intake branch). The two were developed independently; this is
 * the only code that joins them, and it contains no matching logic of its own.
 *
 *   RakutenProduct (Product Search row: productNo / makerName / salesMinPrice)
 *     -> ProviderListing (provider "rakuten_product")
 *     -> runIntake() in listingIntakeService.ts
 *
 * Decisions (each is pinned by rakutenProductIntake.test.ts):
 *  - provider is "rakuten_product", NOT "rakuten". adapters/rakuten.ts rows are
 *    seller listings keyed by itemCode and data/approved-mappings.json stores
 *    them as source "rakuten". A Product Search productId is a different ID
 *    space; sharing the provider name would let a productId collide with an
 *    approved itemCode and be mis-refreshed.
 *  - productNo -> modelNumber and makerName -> manufacturer, exactly as stated
 *    by Rakuten. This is the structured identifier the intake pipeline treats
 *    as an "explicit_code" (weak unless it hits a catalog code). Nothing is
 *    parsed out of the product name here.
 *  - productNo/makerName are NFKC-normalised (Japanese APIs return full-width
 *    "ＩＬＣＥ－７Ｍ５"). The pipeline already NFKCs titles but compares an
 *    explicit modelNumber verbatim, so without this a full-width code silently
 *    fails to link to its catalog entry. Only width/compat folding: hyphens,
 *    spaces and suffixes are preserved (a "/B" or "W" suffix is a different SKU
 *    per scripts/lib/identifierMatch.ts and must stay a human decision).
 *  - salesMinPrice null/<=0 stays price=null. The pipeline HOLDs it
 *    ("no_price"). It is NOT a malformed row: the adapter documents that
 *    Rakuten may return these values empty, and buildProviderBatch() turns a
 *    batch of only-malformed rows into a failed (no-information) batch.
 *  - priceBasis is "product_aggregate" and sourceUrl is null. salesMinPrice is a roll-up over many
 *    shops and productUrlPC is not a purchase URL, so the pipeline HOLDs these rows
 *    ("product_level_price_only"): they feed discovery (model id, seeds), never a price comparison.
 *  - seller stays UNKNOWN: a product row aggregates many shops.
 *  - availability is stated only when Rakuten states a listing count:
 *    >0 -> in_stock (via summarizeJpOffers().comparable), 0 -> out_of_stock,
 *    null -> UNKNOWN. Absence is never read as sold out.
 *  - usageRights is NOT granted here. The caller (or IntakeContext.providerRights)
 *    must grant it explicitly after the terms have been confirmed.
 */
import { buildProviderBatch, mapGenericRow, type MapOptions, type MapResult, type ProviderBatch } from "../domain/providerListing";
import { summarizeJpOffers, type RakutenProduct } from "../adapters/rakutenProduct";

export const RAKUTEN_PRODUCT_PROVIDER = "rakuten_product";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One parsed RakutenProduct -> ProviderListing, via the existing generic-row mapper so defaults stay identical to every other provider. */
export function mapRakutenProduct(raw: unknown, opts: MapOptions = {}): MapResult {
  if (!isRecord(raw)) return { ok: false, error: "product is not an object" };
  const p = raw as unknown as RakutenProduct;
  if (typeof p.productId !== "string" || p.productId === "") return { ok: false, error: "missing productId" };
  if (typeof p.productName !== "string" || p.productName === "") return { ok: false, error: "missing productName" };

  const { purchasableListingCount, comparable } = summarizeJpOffers(p);
  const price = typeof p.salesMinPrice === "number" && p.salesMinPrice > 0 ? p.salesMinPrice : null;
  const availability = comparable ? "in_stock" : purchasableListingCount === 0 ? "out_of_stock" : undefined;

  const mapped = mapGenericRow(
    RAKUTEN_PRODUCT_PROVIDER,
    {
      id: p.productId,
      title: p.productName,
      brand: p.makerName ? p.makerName.normalize("NFKC") : undefined,
      model: p.productNo ? p.productNo.normalize("NFKC") : undefined,
      price,
      currency: "JPY",
      region: "JP",
      availability,
    },
    opts,
  );
  if (!mapped.ok) return mapped;
  // mapGenericRow labels ids "feed_id"; this one is Rakuten's own product id. priceBasis is forced (not
  // overridable by opts): salesMinPrice is a roll-up over shops. sourceUrl stays null: productUrlPC is a
  // product page on the price-comparison site, not a purchase URL.
  return { ok: true, listing: { ...mapped.listing, externalIdType: "rakuten_product_id", priceBasis: "product_aggregate", sourceUrl: null } };
}

/** Parsed Product Search rows -> one ProviderBatch (malformed rows counted, never ingested). */
export function buildRakutenProductBatch(products: unknown, opts: MapOptions = {}): ProviderBatch {
  return buildProviderBatch(RAKUTEN_PRODUCT_PROVIDER, products, (raw) => mapRakutenProduct(raw, opts));
}
