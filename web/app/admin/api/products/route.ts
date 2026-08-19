import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRepositories } from "@core/repository/supabase/index";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const category = String(form.get("category") ?? "").trim();
  const brand = String(form.get("brand") ?? "").trim();
  const officialName = String(form.get("officialName") ?? "").trim();
  const modelSku = String(form.get("modelSku") ?? "").trim() || null;
  const displayName = String(form.get("displayName") ?? "").trim() || null;

  if (!category || !brand || !officialName) {
    return NextResponse.json({ error: "category, brand, officialName은 필수입니다." }, { status: 400 });
  }

  const repos = createSupabaseRepositories();
  const product = await repos.canonicalProducts.createProduct({ category, brand, officialName });
  await repos.canonicalProducts.createVariant({
    canonicalProductId: product.id,
    variantAttributes: {},
    modelSku,
    displayName,
  });

  return NextResponse.redirect(new URL(`/admin/products/${product.id}`, req.url), { status: 303 });
}
