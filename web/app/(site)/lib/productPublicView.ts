import type { Region, Source, SourceListing } from "@core/domain/types";
import type { MarketQuote } from "@core/services/marketQuoteService";
import { filterPublicListings, type PublicDisplayPolicy } from "@core/domain/publicDisplay";
import { isHttpUrl } from "@core/domain/url";
import { sourceDisplayName } from "../../lib/sourceDisplay";

/**
 * Server-side gate for the public product page: the ONLY place the page
 * turns raw repository listings into something it renders. Everything the
 * page derives afterwards (MarketQuotes, price rows, out-of-stock rows,
 * "확인" timestamps, FX note, JSON-LD, analytics comparison_mode, metadata)
 * is computed from `listings` here, never from the raw input.
 *
 * `withheldRegions` lists markets that DO have stored listings, all of them
 * from sources not allowed by the public-display policy - so the page can say
 * "no public price here" instead of the misleading "no seller found yet".
 * It carries no price, URL or source name.
 */
export interface PublicProductListings {
  listings: SourceListing[];
  withheldRegions: Region[];
}

export function preparePublicListings(
  rawListings: readonly SourceListing[],
  sources: readonly Pick<Source, "id" | "region">[],
  policy: PublicDisplayPolicy,
): PublicProductListings {
  const listings = filterPublicListings(rawListings, policy);
  const regionById = new Map(sources.map((s) => [s.id, s.region]));
  const publicRegions = new Set(listings.map((l) => regionById.get(l.sourceId)));
  const withheld = new Set<Region>();
  for (const l of rawListings) {
    const region = regionById.get(l.sourceId);
    if (region && !publicRegions.has(region)) withheld.add(region);
  }
  return { listings, withheldRegions: [...withheld] };
}

export interface JsonLdOffer {
  "@type": "Offer";
  priceCurrency: string | null;
  price: number | null;
  availability: string;
  url?: string;
  seller: { "@type": "Organization"; name: string };
}

/**
 * schema.org Offer list for the product page's JSON-LD. Callers must pass
 * MarketQuotes / out-of-stock listings that were built from
 * preparePublicListings().listings - this function does no filtering of its
 * own, so a non-public source can only appear here if the caller skipped
 * that gate (which the page's static test guards against).
 */
export function buildJsonLdOffers(
  marketQuotes: readonly MarketQuote[],
  outOfStockListings: readonly SourceListing[],
  sourceById: ReadonlyMap<string, Source>,
): JsonLdOffer[] {
  const sellerName = (sourceId: string) => {
    const source = sourceById.get(sourceId);
    return source ? sourceDisplayName(source) : sourceId;
  };
  return [
    ...marketQuotes
      .flatMap((q) => q.eligibleOffers)
      .map(
        (offer): JsonLdOffer => ({
          "@type": "Offer",
          priceCurrency: offer.currency,
          price: offer.price,
          availability: "https://schema.org/InStock",
          ...(isHttpUrl(offer.sourceUrl) ? { url: offer.sourceUrl } : {}),
          seller: { "@type": "Organization", name: sellerName(offer.sourceId) },
        }),
      ),
    ...outOfStockListings.map(
      (listing): JsonLdOffer => ({
        "@type": "Offer",
        priceCurrency: listing.lastKnownCurrency ?? "KRW",
        price: listing.lastKnownPrice,
        availability: "https://schema.org/OutOfStock",
        ...(isHttpUrl(listing.sourceUrl) ? { url: listing.sourceUrl } : {}),
        seller: { "@type": "Organization", name: sellerName(listing.sourceId) },
      }),
    ),
  ];
}
