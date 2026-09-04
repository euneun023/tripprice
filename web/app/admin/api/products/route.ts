import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { isProductType } from "@core/domain/searchAliases";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const category = String(form.get("category") ?? "").trim();
  const brand = String(form.get("brand") ?? "").trim();
  const officialName = String(form.get("officialName") ?? "").trim();
  const productType = String(form.get("productType") ?? "").trim();
  const modelSku = String(form.get("modelSku") ?? "").trim() || null;
  const displayName = String(form.get("displayName") ?? "").trim() || null;

  if (!category || !brand || !officialName) {
    return NextResponse.json({ error: "category, brand, officialName은 필수입니다." }, { status: 400 });
  }
  // Defense-in-depth: the admin form only ever POSTs one of the <select>
  // options below, but this route re-validates server-side rather than
  // trusting that - a raw POST (not through the form) must not be able to
  // write an arbitrary product_type string.
  if (!isProductType(productType)) {
    return NextResponse.json({ error: "product_type이 허용된 값이 아닙니다." }, { status: 400 });
  }

  const repos = createSupabaseRepositories();
  const product = await repos.canonicalProducts.createProduct({ category, brand, officialName, productType });
  await repos.canonicalProducts.createVariant({
    canonicalProductId: product.id,
    variantAttributes: {},
    modelSku,
    displayName,
  });

  return NextResponse.redirect(new URL(`/admin/products/${product.id}`, req.url), { status: 303 });
}
