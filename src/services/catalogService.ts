/**
 * Browse/search aggregation for the home and category pages. Winner/savings
 * numbers always come from compareVariant() (src/services/comparisonService.ts)
 * - nothing here recomputes a price ranking. This file only sorts/filters
 * using that service's output, so there is exactly one place price-winner
 * logic lives.
 */
import type { Repositories } from "../repository/types";
import type { CanonicalProduct, ProductVariant, SourceListing } from "../domain/types";
import { compareVariant, type ComparisonResult } from "./comparisonService";

export interface CatalogEntry {
  product: CanonicalProduct;
  variant: ProductVariant;
  listings: SourceListing[];
  comparison: ComparisonResult;
  lastCheckedAt: string | null;
}

async function buildEntry(
  repos: Pick<Repositories, "sourceListings">,
  product: CanonicalProduct,
  variant: ProductVariant,
): Promise<CatalogEntry> {
  const [listings, comparison] = await Promise.all([
    repos.sourceListings.listByVariant(variant.id),
    compareVariant(repos, variant.id),
  ]);
  const lastCheckedAt =
    listings
      .map((l) => l.lastCheckedAt)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  return { product, variant, listings, comparison, lastCheckedAt };
}

export async function listByCategory(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings">,
  category: string,
): Promise<CatalogEntry[]> {
  const pairs = await repos.canonicalProducts.listVariantsByCategory(category);
  return Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, product, variant)));
}

export async function searchCatalog(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings">,
  query: string,
): Promise<CatalogEntry[]> {
  if (!query.trim()) return [];
  const pairs = await repos.canonicalProducts.searchProducts(query.trim());
  return Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, product, variant)));
}

/** Products where comparing sources actually matters - biggest savings first. */
export async function listMeaningfulPriceGaps(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings">,
  limit = 5,
): Promise<CatalogEntry[]> {
  const pairs = await repos.canonicalProducts.listAllVariants();
  const entries = await Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, product, variant)));
  return entries
    .filter((e) => e.comparison.mode === "n-way")
    .sort((a, b) => {
      const aSavings = a.comparison.legs.find((l) => l.isWinner)?.savingsVsHighestKrw ?? 0;
      const bSavings = b.comparison.legs.find((l) => l.isWinner)?.savingsVsHighestKrw ?? 0;
      return bSavings - aSavings;
    })
    .slice(0, limit);
}

export async function listRecentlyChecked(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings">,
  limit = 5,
): Promise<CatalogEntry[]> {
  const pairs = await repos.canonicalProducts.listAllVariants();
  const entries = await Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, product, variant)));
  return entries
    .filter((e) => e.lastCheckedAt !== null)
    .sort((a, b) => (b.lastCheckedAt! > a.lastCheckedAt! ? 1 : -1))
    .slice(0, limit);
}
