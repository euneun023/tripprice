import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { offersFromListings, groupIntoMarketQuotes, compareMarkets, type MarketQuote, type MarketComparisonLeg } from "@core/services/marketQuoteService";
import { convertToKrw } from "@core/domain/pricing";
import { isHttpUrl } from "@core/domain/url";
import type { SourceListing } from "@core/domain/types";
import { REVIEW_REASON_LABELS } from "@core/domain/types";
import { buildConclusion, quoteByRegion } from "../../lib/conclusion";
import {
  formatPrice,
  formatKrw,
  formatCheckedDate,
  formatCheckedDateTime,
  formatAsOf,
  CONFIDENCE_LABEL,
  SHIPPING_STATUS_LABEL,
  RAKUTEN_SHIPPING_STATUS_LABEL,
  RAKUTEN_INTERNATIONAL_SHIPPING_NOTE,
  productDisplayName,
  formatVariantAttributeEntries,
} from "../../../lib/format";
import { sourceDisplayName } from "../../../lib/sourceDisplay";
import { buildMetadata, absoluteUrl } from "../../../lib/seo";
import { BackIcon, CountryMark } from "../../components/Icons";
import { ProductImage } from "../../components/ProductImage";
import { ViewItemTracker } from "../../components/ViewItemTracker";
import { TrackedSellerLink } from "../../components/TrackedSellerLink";

export const dynamic = "force-dynamic";

const REGION_KO: Record<string, string> = { KR: "한국", JP: "일본", INTL: "해외직구" };

// Shared by generateMetadata and the page body (React dedupes calls with the
// same argument within one request) so adding metadata doesn't double the
// product/variant reads against Supabase.
const getProductAndVariant = cache(async (variantId: string) => {
  const repos = createSupabaseRepositories();
  const variant = await repos.canonicalProducts.getVariant(variantId);
  if (!variant) return null;
  const product = await repos.canonicalProducts.getProduct(variant.canonicalProductId);
  if (!product) return null;
  return { product, variant };
});

/** brand + official name (deduped via productDisplayName), plus real
 * distinguishing variant attributes (never fabricated) so sibling variants
 * of one product don't share a <title>. */
function productVariantName(product: { brand: string; officialName: string }, variant: { variantAttributes: Record<string, string>; displayName: string | null }): string {
  const base = productDisplayName(product.brand, product.officialName);
  const attrs = formatVariantAttributeEntries(variant.variantAttributes).map(([, v]) => v);
  const suffix = attrs.length > 0 ? ` (${attrs.join(" · ")})` : variant.displayName ? ` (${variant.displayName})` : "";
  return `${base}${suffix}`.trim();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id: variantId } = await params;
  const data = await getProductAndVariant(variantId);
  if (!data) return {};

  const { product, variant } = data;
  const name = productVariantName(product, variant);

  // Title stays product-name-first and stable: winner/savings figures change
  // on every refresh, so they're deliberately kept out of title/description
  // to avoid an unstable search snippet.
  return buildMetadata({
    title: `${name} 한국·일본 가격 비교 | 얼마차이`,
    description: `${name}의 한국과 일본 판매가격을 원화 기준으로 비교하세요. 최근 확인 가격과 적용 환율을 확인할 수 있습니다.`,
    path: `/products/${variant.id}`,
    image: variant.imageUrl,
  });
}

export default async function ProductVariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: variantId } = await params;
  const repos = createSupabaseRepositories();

  const data = await getProductAndVariant(variantId);
  if (!data) notFound();
  const { product, variant } = data;

  const [listings, sources] = await Promise.all([
    repos.sourceListings.listByVariant(variantId),
    repos.sources.listAll(),
  ]);

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const regionOf = (sourceId: string) => sourceById.get(sourceId)?.region;
  const listingById = new Map(listings.map((l) => [l.id, l]));

  // Phase 2-F1: eligibility -> groupBy(region) -> MarketQuote -> compare,
  // replacing the old leg-based compareVariant()/legsByRegion() pair (see
  // src/services/marketQuoteService.ts's header comment) - a market with 2+
  // still-eligible active listings can no longer be silently reduced to
  // "the cheapest one", and an `estimated`-confidence match can no longer
  // read as a savings claim.
  const marketQuotes = groupIntoMarketQuotes(offersFromListings(listings, regionOf));
  const marketComparison = await compareMarkets(marketQuotes);

  const conclusion = buildConclusion(marketComparison);
  const byRegion = quoteByRegion(marketComparison); // {KR?: MarketQuote, JP?: MarketQuote, ...}
  const legByRegion: Partial<Record<string, MarketComparisonLeg>> = Object.fromEntries(
    marketComparison.legs.map((l) => [l.marketKey, l]),
  );
  // A market whose only active listing was excluded SOLELY because it's
  // under review (not because of a missing price/currency/availability) -
  // PriceRow's default "판매처를 아직 확인하지 못했어요" would misleadingly
  // read as "we found nothing here" rather than "we found something but
  // it's being re-verified". This flags that distinction so PriceRow can say
  // "확인 중" instead.
  const pendingReviewByRegion: Partial<Record<"KR" | "JP", true>> = {};
  for (const region of ["KR", "JP"] as const) {
    const quote = byRegion[region];
    if (
      quote?.status === "no-eligible-offer" &&
      quote.excludedOffersWithReasons.some((e) => e.reasons.length === 1 && e.reasons[0] === "review_required")
    ) {
      pendingReviewByRegion[region] = true;
    }
  }
  const fxLeg = marketComparison.legs.find((l) => l.fxRateUsed !== null);
  // Shipping cost handling, 2nd pass (safety fix): we never know an actual
  // fee, only included/separate/unknown per listing - so the comparison
  // figures above are always "상품가 기준"(product-price basis) whenever ANY
  // compared leg isn't a CONFIRMED total. A Rakuten leg is NEVER confirmed
  // here, regardless of its own shippingStatus - that value only ever
  // describes the seller's JP-domestic postage display (RakutenItem.postageFlag),
  // never whether shipping to Korea is resolved (see src/adapters/rakuten.ts's
  // deriveRakutenShippingStatus() and src/services/candidateEvaluationService.ts's
  // shipping gate, which apply the exact same rule). Only considers legs
  // actually in the comparison (marketComparison.legs), never the excluded
  // out-of-stock rows.
  const shippingUnconfirmedForComparison =
    marketComparison.legs.length > 0 &&
    marketComparison.legs.some((l) => {
      const listing = listingById.get(l.offer.sourceListingId);
      if (!listing) return true;
      if (listing.sourceId === "rakuten") return true;
      return listing.shippingStatus !== "included";
    });

  // real out-of-stock listings that groupIntoMarketQuotes excludes from ranking -
  // still shown, per spec, as "품절 · 비교 제외" rows, never as a fake price.
  // KRW conversion reuses the same convertToKrw() the comparison service uses -
  // no separate FX math for this row.
  const outOfStockListings = await Promise.all(
    listings
      .filter((l) => l.lastKnownPrice !== null && l.lastKnownAvailability === false)
      .map(async (listing) => {
        const conv = await convertToKrw(listing.lastKnownPrice!, listing.lastKnownCurrency ?? "KRW");
        return { listing, krwPrice: conv.krwPrice };
      }),
  );

  const mostRecentCheck = listings
    .map((l) => l.lastCheckedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  const variantAttrs = formatVariantAttributeEntries(variant.variantAttributes);
  const variantLabel = variantAttrs.length > 0 ? variantAttrs.map(([k, v]) => `${k}: ${v}`).join(" · ") : variant.displayName;

  // We are a comparison service, not the seller - every Offer's `seller` is
  // the actual marketplace (Rakuten/Coupang), never "얼마차이", and prices
  // are each offer's real source-currency price, not the KRW conversion
  // shown in the UI. Built from every eligible offer across ALL MarketQuotes
  // (not just marketComparison.legs) so a market still needing review
  // (duplicate-review-required) doesn't silently drop out of structured data
  // just because the UI won't compare it yet. Skipped entirely when there's
  // no real price data to describe rather than emitting a Product with zero
  // offers.
  const jsonLdOffers = [
    ...marketQuotes.flatMap((q) => q.eligibleOffers).map((offer) => {
      const source = sourceById.get(offer.sourceId);
      return {
        "@type": "Offer",
        priceCurrency: offer.currency,
        price: offer.price,
        availability: "https://schema.org/InStock",
        ...(isHttpUrl(offer.sourceUrl) ? { url: offer.sourceUrl } : {}),
        seller: { "@type": "Organization", name: source ? sourceDisplayName(source) : offer.sourceId },
      };
    }),
    ...outOfStockListings.map(({ listing }) => {
      const source = sourceById.get(listing.sourceId);
      return {
        "@type": "Offer",
        priceCurrency: listing.lastKnownCurrency ?? "KRW",
        price: listing.lastKnownPrice,
        availability: "https://schema.org/OutOfStock",
        ...(isHttpUrl(listing.sourceUrl) ? { url: listing.sourceUrl } : {}),
        seller: { "@type": "Organization", name: source ? sourceDisplayName(source) : listing.sourceId },
      };
    }),
  ];

  const jsonLd =
    jsonLdOffers.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: productVariantName(product, variant),
          brand: { "@type": "Brand", name: product.brand },
          ...(variant.imageUrl ? { image: [variant.imageUrl] } : {}),
          ...(absoluteUrl(`/products/${variant.id}`) ? { url: absoluteUrl(`/products/${variant.id}`) } : {}),
          offers: jsonLdOffers,
        }
      : null;

  return (
    <>
      {jsonLd && (
        // </script> (or any "<") inside a string field (e.g. an official_name)
        // would otherwise close the script tag early and inject markup - <
        // is valid inside a JSON string and still parses to "<" as JSON-LD.
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}
      <ViewItemTracker
        product_id={product.id}
        variant_id={variant.id}
        category={product.category}
        comparison_mode={marketComparison.mode}
        winner_market={marketComparison.mode === "comparable" ? marketComparison.legs.find((l) => l.isWinner)?.marketKey : undefined}
      />

      <div className="wrap pd-topbar">
        <Link href="/" className="back-link">
          <BackIcon />
          목록으로
        </Link>
      </div>

      <div className="wrap pd-grid">
        <ProductImage
          src={variant.imageUrl}
          alt={productDisplayName(product.brand, product.officialName)}
          className="pd-media"
          sizes="(min-width: 880px) 460px, 100vw"
        />

        <div>
          <div className="pd-brand">{product.brand}</div>
          <div className="pd-name">{product.officialName}</div>
          <div className="pd-variant">
            {variantLabel}
            {variant.modelSku ? ` · 모델명 ${variant.modelSku}` : ""}
          </div>

          <div className="verdict-label">
            <CountryMark region={undefined} />
            <span>{conclusion.headline}</span>
          </div>

          <div className="verdict-big">
            {marketComparison.mode === "comparable" && conclusion.diffLine ? (
              <>
                <span className="verdict-num num">
                  {formatKrw(marketComparison.legs.find((l) => l.isWinner)!.savingsVsHighestKrw).replace("원", "")}
                </span>
                <span className="verdict-unit">원 차이</span>
              </>
            ) : marketComparison.mode === "comparable" ? (
              <span className="verdict-num plain num">{conclusion.cardLine}</span>
            ) : marketComparison.legs[0] ? (
              <span className="verdict-num plain num">{formatKrw(marketComparison.legs[0].krwPrice)}</span>
            ) : (
              <span className="verdict-num plain num">가격 정보 없음</span>
            )}
          </div>

          <div className="verdict-note">
            {byRegion.KR?.status === "single" && byRegion.JP?.status === "single" ? (
              <>
                한국 <b className="num">{formatKrw(legByRegion.KR!.krwPrice)}</b> · 일본{" "}
                <b className="num">{formatKrw(legByRegion.JP!.krwPrice)}</b>
              </>
            ) : marketComparison.mode === "single-market" ? (
              "다른 시장의 비교 가능한 판매처를 아직 확인하지 못했어요"
            ) : marketComparison.mode === "duplicate-review-required" ? (
              "판매처 확인이 필요해 가격을 표시하지 않았어요"
            ) : (
              ""
            )}
          </div>

          {conclusion.disclosure && <div className="fx-note">{conclusion.disclosure}</div>}

          <div className="price-rows">
            {(["KR", "JP"] as const).map((region) => {
              const quote = byRegion[region];
              const leg = legByRegion[region];
              return (
                <PriceRow
                  key={region}
                  region={region}
                  quote={quote}
                  leg={leg}
                  listing={leg ? listingById.get(leg.offer.sourceListingId) : undefined}
                  source={leg ? sourceById.get(leg.offer.sourceId) : undefined}
                  pendingReview={!!pendingReviewByRegion[region]}
                  highlightWinner={marketComparison.mode === "comparable"}
                  productId={product.id}
                  variantId={variant.id}
                  category={product.category}
                />
              );
            })}
            {outOfStockListings.map(({ listing, krwPrice }) => (
              <OutOfStockRow key={listing.id} listing={listing} krwPrice={krwPrice} source={sourceById.get(listing.sourceId)} />
            ))}
          </div>

          <div className="pd-meta-foot">
            모델번호 {variant.modelSku ?? "확인 안 됨"}
            {listings
              .filter((l) => l.lastKnownPrice !== null)
              .map((l) => (
                <span key={l.id}>
                  <br />
                  {REGION_KO[regionOf(l.sourceId) ?? ""] ?? l.sourceId}: {formatCheckedDateTime(l.lastSuccessAt)} ·{" "}
                  {CONFIDENCE_LABEL[l.confidence]}
                  {l.reviewRequired && ` · 검수 필요(${REVIEW_REASON_LABELS[l.reviewReason!] ?? l.reviewReason})`}
                </span>
              ))}
          </div>

          {fxLeg && fxLeg.fxRateUsed !== null && (
            <div className="fx-note">
              환율 100엔 = {(fxLeg.fxRateUsed * 100).toFixed(1)}원 적용 · JPY → KRW 환산 · {formatAsOf(fxLeg.fxAsOf)}
            </div>
          )}

          {shippingUnconfirmedForComparison && (
            <div className="fx-note">위 비교·가격 차이는 상품가 기준이며 배송비는 포함되지 않았습니다.</div>
          )}

          <div className="pd-note">
            가격은 온라인 판매처 공개 정보를 기준으로 확인 시점에 산정하며, 환율 및 판매처 가격 변경 시 실제
            금액과 차이가 있을 수 있습니다. 해외 배송비가 별도로 부과될 수 있으며 실제 총 결제금액은
            판매처에서 확인해 주세요.
          </div>
        </div>
      </div>
    </>
  );
}

function PriceRow({
  region,
  quote,
  leg,
  listing,
  source,
  pendingReview,
  highlightWinner,
  productId,
  variantId,
  category,
}: {
  region: "KR" | "JP";
  quote: MarketQuote | undefined;
  /** present only when quote.status === "single" */
  leg: MarketComparisonLeg | undefined;
  listing: SourceListing | undefined;
  source: { id: string; name: string } | undefined;
  /** true when a listing exists for this region but was excluded SOLELY
   * because it's under review - shown as "확인 중", distinct from truly
   * never having found a seller here. */
  pendingReview: boolean;
  /** only true for marketComparison.mode === "comparable" (F0: never imply
   * a "cheaper market" for a duplicate/unverified comparison). */
  highlightWinner: boolean;
  productId: string;
  variantId: string;
  category: string;
}) {
  if (quote?.status === "duplicate-review-required") {
    return (
      <div className="prow prow--muted">
        <CountryMark region={region} />
        <div className="prow-label">{REGION_KO[region]} 판매처가 여러 곳 확인돼 검수가 필요해요</div>
      </div>
    );
  }

  if (!leg || !listing) {
    return (
      <div className="prow prow--muted">
        <CountryMark region={region} />
        <div className="prow-label">
          {pendingReview ? `${REGION_KO[region]} 가격 확인 중이에요` : `${REGION_KO[region]} 판매처를 아직 확인하지 못했어요`}
        </div>
      </div>
    );
  }

  return (
    <div className={`prow${highlightWinner && leg.isWinner ? " prow--win" : ""}`}>
      <CountryMark region={region} />
      <div className="prow-label">
        <b>{REGION_KO[region]}</b> · {source ? sourceDisplayName(source) : listing.sourceId}
      </div>
      <div className="prow-price-wrap">
        <div className="prow-price num">{formatKrw(leg.krwPrice)}</div>
        <div className="prow-price-sub num">
          {leg.fxRateUsed !== null ? `${formatPrice(leg.offer.price!, leg.offer.currency!)} · 환율 적용 · ` : ""}
          {listing.sourceId === "rakuten"
            ? `${RAKUTEN_SHIPPING_STATUS_LABEL[listing.shippingStatus] ?? RAKUTEN_SHIPPING_STATUS_LABEL.unknown} · ${RAKUTEN_INTERNATIONAL_SHIPPING_NOTE}`
            : SHIPPING_STATUS_LABEL[listing.shippingStatus] ?? SHIPPING_STATUS_LABEL.unknown}
        </div>
      </div>
      {isHttpUrl(listing.sourceUrl) && (
        <TrackedSellerLink
          className="prow-cta"
          href={listing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          sellerClick={{
            product_id: productId,
            variant_id: variantId,
            category,
            source: listing.sourceId,
            market: region,
          }}
        >
          바로가기
        </TrackedSellerLink>
      )}
    </div>
  );
}

function OutOfStockRow({
  listing,
  krwPrice,
  source,
}: {
  listing: SourceListing;
  krwPrice: number;
  source: { name: string; region: string } | undefined;
}) {
  const isJpy = listing.lastKnownCurrency !== "KRW";
  return (
    <div className="prow prow--muted">
      <CountryMark region={source?.region} />
      <div className="prow-label">
        <b>{REGION_KO[source?.region ?? ""] ?? listing.sourceId}</b> · 품절 · 비교 제외
      </div>
      <div className="prow-price-wrap">
        <div className="prow-price strike num">{formatKrw(krwPrice)}</div>
        <div className="prow-price-sub num">
          {isJpy ? `${formatPrice(listing.lastKnownPrice ?? 0, listing.lastKnownCurrency ?? "KRW")} · 환율 적용 · ` : ""}
          {listing.sourceId === "rakuten"
            ? `${RAKUTEN_SHIPPING_STATUS_LABEL[listing.shippingStatus] ?? RAKUTEN_SHIPPING_STATUS_LABEL.unknown} · ${RAKUTEN_INTERNATIONAL_SHIPPING_NOTE}`
            : SHIPPING_STATUS_LABEL[listing.shippingStatus] ?? SHIPPING_STATUS_LABEL.unknown}
        </div>
      </div>
    </div>
  );
}
