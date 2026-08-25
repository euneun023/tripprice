import type { MetadataRoute } from "next";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { CATEGORIES } from "./lib/categories";
import { SITE_URL } from "./lib/seo";

// Regenerated per request (matches the rest of the site's `force-dynamic`
// public pages) so newly added products show up without a redeploy.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No production domain configured yet - emitting sitemap entries with no
  // real base URL would be actively wrong, so return nothing until
  // NEXT_PUBLIC_SITE_URL is set (see app/lib/seo.ts).
  if (!SITE_URL) return [];

  const repos = createSupabaseRepositories();
  const pairs = await repos.canonicalProducts.listAllVariants();

  const productEntries: MetadataRoute.Sitemap = pairs.map(({ product, variant }) => ({
    url: `${SITE_URL}/products/${variant.id}`,
    lastModified: product.updatedAt,
  }));

  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.map((c) => ({
    url: `${SITE_URL}/categories/${c.slug}`,
  }));

  return [{ url: `${SITE_URL}/` }, ...categoryEntries, ...productEntries];
}
