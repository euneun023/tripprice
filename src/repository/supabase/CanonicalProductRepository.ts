import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalProductRepository, ProductWithVariant } from "../types";
import { rowToCanonicalProduct, rowToProductVariant } from "./mappers";

function rowToProductWithVariant(row: any): ProductWithVariant {
  const { canonical_products, ...variantRow } = row;
  return {
    product: rowToCanonicalProduct(canonical_products),
    variant: rowToProductVariant(variantRow),
  };
}

export class SupabaseCanonicalProductRepository implements CanonicalProductRepository {
  constructor(private db: SupabaseClient) {}

  async createProduct(input: { category: string; brand: string; officialName: string }) {
    const { data, error } = await this.db
      .from("canonical_products")
      .insert({ category: input.category, brand: input.brand, official_name: input.officialName })
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

  async searchProducts(query: string): Promise<ProductWithVariant[]> {
    const q = `%${query}%`;

    // Three parameterized single-column filters instead of one .or() built
    // from a raw PostgREST filter-syntax string - .or()'s string is parsed
    // by PostgREST itself (comma separates conditions, parens group them),
    // so splicing user input into it let a query containing those characters
    // escape the intended brand/official_name filter and inject extra
    // conditions. .ilike()/.eq() always send the column separately from the
    // value (see the .eq("canonical_products.category", ...) call above),
    // so the value can never be reinterpreted as filter syntax, no matter
    // what characters it contains.
    const [byBrand, byOfficialName, byVariant] = await Promise.all([
      this.db
        .from("product_variants")
        .select("*, canonical_products!inner(*)")
        .ilike("canonical_products.brand", q),
      this.db
        .from("product_variants")
        .select("*, canonical_products!inner(*)")
        .ilike("canonical_products.official_name", q),
      this.db.from("product_variants").select("*, canonical_products!inner(*)").ilike("model_sku", q),
    ]);
    if (byBrand.error) throw byBrand.error;
    if (byOfficialName.error) throw byOfficialName.error;
    if (byVariant.error) throw byVariant.error;

    const seen = new Map<string, ProductWithVariant>();
    for (const row of [...(byBrand.data ?? []), ...(byOfficialName.data ?? []), ...(byVariant.data ?? [])]) {
      const mapped = rowToProductWithVariant(row);
      seen.set(mapped.variant.id, mapped);
    }
    return [...seen.values()];
  }
}
