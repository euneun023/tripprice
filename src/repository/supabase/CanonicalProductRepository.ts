import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalProductRepository, ProductWithVariant } from "../types";
import { rowToCanonicalProduct, rowToProductVariant } from "./mappers";
import { parseSearchIntent, type ProductType } from "../../domain/searchAliases";

function rowToProductWithVariant(row: any): ProductWithVariant {
  const { canonical_products, ...variantRow } = row;
  return {
    product: rowToCanonicalProduct(canonical_products),
    variant: rowToProductVariant(variantRow),
  };
}

function rowsToMap(rows: any[]): Map<string, ProductWithVariant> {
  const map = new Map<string, ProductWithVariant>();
  for (const row of rows) {
    const mapped = rowToProductWithVariant(row);
    map.set(mapped.variant.id, mapped);
  }
  return map;
}

/** AND across axes: keeps only ids present in every map. Empty input -> empty
 * result (searchProducts() only calls this with >=1 map, guarded separately). */
function intersectMaps(maps: Map<string, ProductWithVariant>[]): Map<string, ProductWithVariant> {
  if (maps.length === 0) return new Map();
  let result = maps[0];
  for (let idx = 1; idx < maps.length; idx++) {
    const next = new Map<string, ProductWithVariant>();
    for (const [id, row] of result) {
      if (maps[idx].has(id)) next.set(id, row);
    }
    result = next;
  }
  return result;
}

export class SupabaseCanonicalProductRepository implements CanonicalProductRepository {
  constructor(private db: SupabaseClient) {}

  async createProduct(input: { category: string; brand: string; officialName: string; productType: ProductType }) {
    const { data, error } = await this.db
      .from("canonical_products")
      .insert({
        category: input.category,
        brand: input.brand,
        official_name: input.officialName,
        product_type: input.productType,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToCanonicalProduct(data);
  }

  async createVariant(input: {
    canonicalProductId: string;
    variantAttributes: Record<string, string>;
    modelSku: string | null;
    displayName: string | null;
  }) {
    const { data, error } = await this.db
      .from("product_variants")
      .insert({
        canonical_product_id: input.canonicalProductId,
        variant_attributes: input.variantAttributes,
        model_sku: input.modelSku,
        display_name: input.displayName,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToProductVariant(data);
  }

  async getVariant(id: string) {
    const { data, error } = await this.db.from("product_variants").select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToProductVariant(data) : null;
  }

  async getProduct(id: string) {
    const { data, error } = await this.db.from("canonical_products").select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToCanonicalProduct(data) : null;
  }

  async listAllProducts() {
    const { data, error } = await this.db.from("canonical_products").select().order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToCanonicalProduct);
  }

  async listVariantsForProduct(canonicalProductId: string) {
    const { data, error } = await this.db
      .from("product_variants")
      .select()
      .eq("canonical_product_id", canonicalProductId);
    if (error) throw error;
    return (data ?? []).map(rowToProductVariant);
  }

  async setVariantImageIfMissing(variantId: string, imageUrl: string): Promise<void> {
    const { data, error: selErr } = await this.db
      .from("product_variants")
      .select("image_url")
      .eq("id", variantId)
      .maybeSingle();
    if (selErr) throw selErr;
    if (data?.image_url) return; // never overwrite an existing photo
    const { error } = await this.db.from("product_variants").update({ image_url: imageUrl }).eq("id", variantId);
    if (error) throw error;
  }

  async updateVariantImage(variantId: string, imageUrl: string): Promise<void> {
    const { error } = await this.db.from("product_variants").update({ image_url: imageUrl }).eq("id", variantId);
    if (error) throw error;
  }

  async listAllVariants(): Promise<ProductWithVariant[]> {
    const { data, error } = await this.db.from("product_variants").select("*, canonical_products!inner(*)");
    if (error) throw error;
    return (data ?? []).map(rowToProductWithVariant);
  }

  async listVariantsByCategory(category: string): Promise<ProductWithVariant[]> {
    const { data, error } = await this.db
      .from("product_variants")
      .select("*, canonical_products!inner(*)")
      .eq("canonical_products.category", category);
    if (error) throw error;
    return (data ?? []).map(rowToProductWithVariant);
  }

  // Single parameterized .ilike() - value always a separate bound parameter,
  // never spliced into a filter-syntax string (see the injection note on
  // searchProducts() below for why that distinction matters).
  private async ilikeQuery(column: string, pattern: string): Promise<any[]> {
    const { data, error } = await this.db
      .from("product_variants")
      .select("*, canonical_products!inner(*)")
      .ilike(column, pattern);
    if (error) throw error;
    return data ?? [];
  }

  // Single parameterized .in() - values come from THIS class's own fixed
  // alias dictionaries (src/domain/searchAliases.ts), never from raw user
  // text, and supabase-js binds the array as parameters (translated to
  // `column IN ($1, $2, ...)`), not string-concatenated - same safety
  // property as .ilike()/.eq(), just expressing "OR within one column" in
  // one round trip instead of N separate .eq() calls unioned in JS.
  private async inQuery(column: string, values: string[]): Promise<any[]> {
    const { data, error } = await this.db
      .from("product_variants")
      .select("*, canonical_products!inner(*)")
      .in(column, values);
    if (error) throw error;
    return data ?? [];
  }

  // V1's whole-string 3-way match, unchanged in behavior - used both as the
  // no-intent-recognized-at-all path is no longer needed (parseSearchIntent
  // always treats an unrecognized single token as one free-text axis, which
  // reduces to exactly this for a single-token query) and as the explicit
  // safety valve for abnormally long queries (see MAX_SEARCH_TOKENS).
  private async legacyThreeWaySearch(query: string): Promise<ProductWithVariant[]> {
    const pattern = `%${query}%`;
    const [byBrand, byOfficialName, byVariant] = await Promise.all([
      this.ilikeQuery("canonical_products.brand", pattern),
      this.ilikeQuery("canonical_products.official_name", pattern),
      this.ilikeQuery("model_sku", pattern),
    ]);
    return [...rowsToMap([...byBrand, ...byOfficialName, ...byVariant]).values()];
  }

  /**
   * Search V2: parses the query into independent axes (brand / product_type /
   * category / one axis per free-text token - see parseSearchIntent()), runs
   * one parameterized query per axis, and combines them as:
   *   - within one axis, multiple matched values are OR'd (.in() naturally
   *     does this; a free-text token's own brand/official_name/model_sku
   *     sub-results are OR'd via Map union)
   *   - across axes, results are AND'd (Map intersection by variant.id)
   * This never builds a PostgREST filter string from user input - every
   * value that reaches .ilike()/.in() is either one whitespace-delimited
   * token (still bound as a single parameter, same as V1's whole-string
   * pattern) or a value pulled from this file's own alias dictionaries.
   * .or() is not used anywhere in this class.
   */
  async searchProducts(query: string): Promise<ProductWithVariant[]> {
    const intent = parseSearchIntent(query);

    // Abnormally long query - parseSearchIntent() deliberately parsed
    // nothing (see MAX_SEARCH_TOKENS) rather than let query count grow
    // unbounded. Falls back to V1 behavior on the full normalized query text
    // (NFC+trim+whitespace-collapse, never truncated/dropped) - using
    // intent.normalizedQuery here (not the raw `query` argument) so this
    // fallback path gets the same normalization every other path already
    // gets, instead of silently skipping it.
    if (intent.tokenLimitExceeded) {
      return this.legacyThreeWaySearch(intent.normalizedQuery);
    }

    const hasAnyAxis =
      intent.brands.length > 0 ||
      intent.productTypes.length > 0 ||
      intent.categories.length > 0 ||
      intent.freeTextTokens.length > 0;
    if (!hasAnyAxis) return [];

    const axisPromises: Promise<Map<string, ProductWithVariant>>[] = [];

    if (intent.brands.length > 0) {
      axisPromises.push(this.inQuery("canonical_products.brand", intent.brands).then(rowsToMap));
    }
    if (intent.productTypes.length > 0) {
      axisPromises.push(this.inQuery("canonical_products.product_type", intent.productTypes as string[]).then(rowsToMap));
    }
    if (intent.categories.length > 0) {
      axisPromises.push(this.inQuery("canonical_products.category", intent.categories).then(rowsToMap));
    }
    for (const token of intent.freeTextTokens) {
      const pattern = `%${token}%`;
      axisPromises.push(
        Promise.all([
          this.ilikeQuery("canonical_products.brand", pattern),
          this.ilikeQuery("canonical_products.official_name", pattern),
          this.ilikeQuery("model_sku", pattern),
        ]).then(([byBrand, byOfficialName, byVariant]) => rowsToMap([...byBrand, ...byOfficialName, ...byVariant])),
      );
    }

    const axisMaps = await Promise.all(axisPromises);
    return [...intersectMaps(axisMaps).values()];
  }
}
