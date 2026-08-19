/**
 * App-level browse taxonomy (UI labels + routing slugs), not a schema
 * constraint - canonical_products.category stays free text in the DB
 * (see supabase/migrations/0001_init.sql). This list is what the home page
 * offers as entry points; a category with zero real listings still routes
 * correctly, it just renders an empty state instead of being hidden or
 * backfilled with fake data.
 */
export interface CategoryDef {
  slug: string;
  label: string;
  /** value stored in canonical_products.category */
  dbCategory: string;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: "electronics", label: "전자제품", dbCategory: "electronics" },
  { slug: "diving", label: "다이빙", dbCategory: "diving" },
  { slug: "fashion", label: "패션/스니커즈", dbCategory: "fashion" },
  { slug: "beauty", label: "뷰티", dbCategory: "beauty" },
];

export function findCategory(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
