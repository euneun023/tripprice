/**
 * Read-model assembly for the admin UI. Every mutation the admin UI performs
 * goes through the existing services (mappingService.approveListing,
 * refreshService.refreshOneListing/refreshApprovedListings) - nothing here
 * duplicates matching or refresh logic, this file only shapes data for
 * display.
 */
import type { Repositories } from "../repository/types";
import type { CanonicalProduct, ProductVariant, SourceListing, PriceHistoryEntry } from "../domain/types";

export interface AdminVariantRow {
  variant: ProductVariant;
  listings: SourceListing[];
  reviewRequiredCount: number;
}

export interface AdminProductRow {
  product: CanonicalProduct;
  variants: AdminVariantRow[];
}

export async function listProductsOverview(
  repos: Pick<Repositories, "canonicalProducts" | "sourceListings">,
): Promise<AdminProductRow[]> {
  const products = await repos.canonicalProducts.listAllProducts();
  return Promise.all(
    products.map(async (product) => {
      const variants = await repos.canonicalProducts.listVariantsForProduct(product.id);
      const variantRows = await Promise.all(
        variants.map(async (variant) => {
          const listings = await repos.sourceListings.listByVariant(variant.id);
          return {
            variant,
            listings,
            reviewRequiredCount: listings.filter((l) => l.reviewRequired).length,
          };
        }),
      );
      return { product, variants: variantRows };
    }),
  );
}

export interface AdminReviewRow {
  listing: SourceListing;
  variant: ProductVariant | null;
  product: CanonicalProduct | null;
  previousPrice: PriceHistoryEntry | null;
}

export async function listReviewQueueWithContext(
  repos: Pick<Repositories, "sourceListings" | "canonicalProducts" | "priceHistory">,
): Promise<AdminReviewRow[]> {
  const queue = await repos.sourceListings.listReviewQueue();
  return Promise.all(
    queue.map(async (listing) => {
      const variant = await repos.canonicalProducts.getVariant(listing.productVariantId);
      const product = variant ? await repos.canonicalProducts.getProduct(variant.canonicalProductId) : null;
      const history = await repos.priceHistory.listForListing(listing.id, 2);
      // history[0] is the current value (already reflected in listing.lastKnownPrice); history[1] is the prior one
      const previousPrice = history[1] ?? null;
      return { listing, variant, product, previousPrice };
    }),
  );
}
