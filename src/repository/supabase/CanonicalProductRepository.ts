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

    const [byProduct, byVariant] = await Promise.all([
      this.db
        .from("product_variants")
        .select("*, canonical_products!inner(*)")
        .or(`brand.ilike.${q},official_name.ilike.${q}`, { referencedTable: "canonical_products" }),
      this.db.from("product_variants").select("*, canonical_products!inner(*)").ilike("model_sku", q),
    ]);
    if (byProduct.error) throw byProduct.error;
    if (byVariant.error) throw byVariant.error;

    const seen = new Map<string, ProductWithVariant>();
    for (const row of [...(byProduct.data ?? []), ...(byVariant.data ?? [])]) {
      const mapped = rowToProductWithVariant(row);
      seen.set(mapped.variant.id, mapped);
    }
    return [...seen.values()];
  }
}
