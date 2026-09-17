/**
 * Browse/search aggregation for the home and category pages. This file only
 * sorts/filters using another service's output, never recomputes a price
 * ranking itself.
 *
 * Phase 2-F1 attached `marketComparison` (src/services/marketQuoteService.ts)
 * per entry, for the product-facing UI (ProductCardGrid) to render without
 * ever picking-cheapest-of-duplicates or implying a "winner" market itself.
 * Phase 2-F1.2: `listMeaningfulPriceGaps()` below now sorts/filters by
 * `marketComparison` too (previously the legacy leg-based `comparison`,
 * i.e. compareVariant()/comparisonService.ts - see that function's own
 * comment for why). `comparison` is kept on CatalogEntry only because
 * `listByCategory`/`searchCatalog`/`listRecentlyChecked` don't need a price
 * ranking at all, and nothing outside this file still reads it for a public
 * "가격 차이" claim - admin's own price grading (web/app/admin/lib/priceGrade.ts)
 * calls compareVariant() itself directly and doesn't go through CatalogEntry.
 */
import type { Repositories } from "../repository/types";
import type { CanonicalProduct, ProductVariant, Region, Source, SourceListing } from "../domain/types";
import { compareVariant, type ComparisonResult } from "./comparisonService";
import { buildMarketComparison, type MarketComparisonResult } from "./marketQuoteService";

export interface CatalogEntry {
  product: CanonicalProduct;
  variant: ProductVariant;
  listings: SourceListing[];
  comparison: ComparisonResult;
  marketComparison: MarketComparisonResult;
  lastCheckedAt: string | null;
}

async function buildEntry(
  repos: Pick<Repositories, "sourceListings">,
  regionOf: (sourceId: string) => Region | undefined,
  product: CanonicalProduct,
  variant: ProductVariant,
): Promise<CatalogEntry> {
  const [listings, comparison] = await Promise.all([
    repos.sourceListings.listByVariant(variant.id),
    compareVariant(repos, variant.id),
  ]);
  const marketComparison = await buildMarketComparison(listings, regionOf);
  const lastCheckedAt =
    listings
      .map((l) => l.lastCheckedAt)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  return { product, variant, listings, comparison, marketComparison, lastCheckedAt };
}

async function regionResolver(repos: Pick<Repositories, "sources">): Promise<(sourceId: string) => Region | undefined> {
  const sources = await repos.sources.listAll();
  const sourceById = new Map<string, Source>(sources.map((s) => [s.id, s]));
  return (sourceId: string) => sourceById.get(sourceId)?.region;
}

export async function listByCategory(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources">,
  category: string,
): Promise<CatalogEntry[]> {
  const [pairs, regionOf] = await Promise.all([repos.canonicalProducts.listVariantsByCategory(category), regionResolver(repos)]);
  return Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, regionOf, product, variant)));
}

export async function searchCatalog(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources">,
  query: string,
): Promise<CatalogEntry[]> {
  if (!query.trim()) return [];
  const [pairs, regionOf] = await Promise.all([repos.canonicalProducts.searchProducts(query.trim()), regionResolver(repos)]);
  return Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, regionOf, product, variant)));
}

/**
 * Products where comparing sources actually matters - biggest savings first.
 * This is the public "가격 차이가 큰 상품" surface (Home's hero card is
 * literally this list's #1 entry - see web/app/(site)/page.tsx) so it's
 * held to the same bar as everything else public: only a verified
 * comparable MarketQuote pair (mode "comparable" && headlineAllowed - both
 * markets' representative offer confidence="verified", no duplicate
 * market) counts as a real gap. Phase 2-F1.2: previously used the legacy
 * leg-based `comparison` field (compareVariant()'s own "n-way" mode has no
 * concept of confidence or duplicate offers), which the F1.1 sanity gate
 * found could rank an `estimated`-confidence match - even hero-pick it -
 * ahead of `verified` ones on a savings figure the public UI no longer even
 * displays for that entry.
 */
export async function listMeaningfulPriceGaps(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources">,
  limit = 5,
): Promise<CatalogEntry[]> {
  const [pairs, regionOf] = await Promise.all([repos.canonicalProducts.listAllVariants(), regionResolver(repos)]);
  const entries = await Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, regionOf, product, variant)));
  return entries
    .filter((e) => e.marketComparison.mode === "comparable" && e.marketComparison.headlineAllowed)
    .sort((a, b) => {
      const aSavings = a.marketComparison.legs.find((l) => l.isWinner)?.savingsVsHighestKrw ?? 0;
      const bSavings = b.marketComparison.legs.find((l) => l.isWinner)?.savingsVsHighestKrw ?? 0;
      return bSavings - aSavings;
    })
    .slice(0, limit);
}

export async function listRecentlyChecked(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources">,
  limit = 5,
): Promise<CatalogEntry[]> {
  const [pairs, regionOf] = await Promise.all([repos.canonicalProducts.listAllVariants(), regionResolver(repos)]);
  const entries = await Promise.all(pairs.map(({ product, variant }) => buildEntry(repos, regionOf, product, variant)));
  return entries
    .filter((e) => e.lastCheckedAt !== null)
    .sort((a, b) => (b.lastCheckedAt! > a.lastCheckedAt! ? 1 : -1))
    .slice(0, limit);
}
