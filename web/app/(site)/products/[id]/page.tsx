import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { compareVariant } from "@core/services/comparisonService";
import { convertToKrw } from "@core/domain/pricing";
import { isHttpUrl } from "@core/domain/url";
import type { SourceListing } from "@core/domain/types";
import { REVIEW_REASON_LABELS } from "@core/domain/types";
import { buildConclusion, legsByRegion } from "../../lib/conclusion";
import {
  formatPrice,
  formatKrw,
  formatCheckedDate,
  formatCheckedDateTime,
  formatAsOf,
  CONFIDENCE_LABEL,
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

  const [listings, sources, comparison] = await Promise.all([
    repos.sourceListings.listByVariant(variantId),
    repos.sources.listAll(),
    compareVariant(repos, variantId),
  ]);

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const regionOf = (sourceId: string) => sourceById.get(sourceId)?.region;
  const listingById = new Map(listings.map((l) => [l.id, l]));

  const conclusion = buildConclusion(comparison, regionOf);
  const byRegion = legsByRegion(comparison, regionOf); // {KR?: leg, JP?: leg, ...}
  const winner = comparison.legs.find((l) => l.isWinner);
  const winnerRegion = winner ? regionOf(winner.sourceId) : undefined;
  const fxLeg = comparison.legs.find((l) => l.fxRateUsed !== null);
  // Splits "일본에서 사는 게 가장 저렴해요" into a bold place name + the rest,
  // so KR and JP winners get identical (symmetric) headline treatment -
  // falls back to the plain sentence for close/single/no-data tones, which
  // don't start with a place name.
  const winnerPlace = winnerRegion ? REGION_KO[winnerRegion] : undefined;

  // real out-of-stock listings that compareVariant excludes from ranking -
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
  // are each leg's real source-currency price, not the KRW conversion shown
  // in the UI. Skipped entirely when there's no real price data to describe
  // (comparison.mode === "no-data" and nothing out of stock either) rather
  // than emitting a Product with zero offers.
  const jsonLdOffers = [
    ...comparison.legs.map((leg) => {
      const source = sourceById.get(leg.sourceId);
      return {
        "@type": "Offer",
        priceCurrency: leg.currency,
        price: leg.price,
        availability: "https://schema.org/InStock",
        ...(isHttpUrl(listingById.get(leg.sourceListingId)?.sourceUrl)
          ? { url: listingById.get(leg.sourceListingId)!.sourceUrl }
          : {}),
        seller: { "@type": "Organization", name: source ? sourceDisplayName(source) : leg.sourceId },
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
        comparison_mode={comparison.mode}
        winner_market={winnerRegion}
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
            <CountryMark region={winnerRegion} />
            <span>
              {winnerPlace && conclusion.headline.startsWith(winnerPlace) ? (
                <>
                  <span className="verdict-place">{winnerPlace}</span>
                  {conclusion.headline.slice(winnerPlace.length)}
                </>
              ) : (
                conclusion.headline
              )}
            </span>
          </div>

          <div className="verdict-big">
            {(conclusion.tone === "kr" || conclusion.tone === "jp") && winner ? (
              <>
                <span className="verdict-num num">{formatKrw(winner.savingsVsHighestKrw).replace("원", "")}</span>
                <span className="verdict-unit">원 차이</span>
              </>
            ) : conclusion.tone === "close" && winner ? (
              <span className="verdict-num plain num">{conclusion.savingsLine}</span>
            ) : comparison.legs[0] ? (
              <span className="verdict-num plain num">{formatKrw(comparison.legs[0].krwPrice)}</span>
            ) : (
              <span className="verdict-num plain num">가격 정보 없음</span>
            )}
          </div>

          <div className="verdict-note">
            {byRegion.KR && byRegion.JP ? (
              <>
                한국 <b className="num">{formatKrw(byRegion.KR.krwPrice)}</b> · 일본{" "}
                <b className="num">{formatKrw(byRegion.JP.krwPrice)}</b>
              </>
            ) : comparison.mode === "single" ? (
              "다른 시장의 비교 가능한 판매처를 아직 확인하지 못했어요"
            ) : (
              ""
            )}
          </div>

          <div className="price-rows">
            {(["KR", "JP"] as const).map((region) => (
              <PriceRow
                key={region}
                region={region}
                leg={byRegion[region]}
                listing={byRegion[region] ? listingById.get(byRegion[region]!.sourceListingId) : undefined}
                source={byRegion[region] ? sourceById.get(byRegion[region]!.sourceId) : undefined}
                productId={product.id}
                variantId={variant.id}
                category={product.category}
              />
            ))}
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

          <div className="pd-note">
            가격은 온라인 판매처 공개 정보를 기준으로 확인 시점에 산정하며, 환율 및 판매처 가격 변경 시 실제
            금액과 차이가 있을 수 있습니다.
          </div>
        </div>
      </div>
    </>
  );
}

function PriceRow({
  region,
  leg,
  listing,
  source,
  productId,
  variantId,
  category,
}: {
  region: "KR" | "JP";
  leg: ReturnType<typeof legsByRegion>[string] | undefined;
  listing: SourceListing | undefined;
  source: { id: string; name: string } | undefined;
  productId: string;
  variantId: string;
  category: string;
}) {
  if (!leg || !listing) {
    return (
      <div className="prow prow--muted">
        <CountryMark region={region} />
        <div className="prow-label">{REGION_KO[region]} 판매처를 아직 확인하지 못했어요</div>
      </div>
    );
  }

  return (
    <div className={`prow${leg.isWinner ? " prow--win" : ""}`}>
      <CountryMark region={region} />
      <div className="prow-label">
        <b>{REGION_KO[region]}</b> · {source ? sourceDisplayName(source) : listing.sourceId}
      </div>
      <div className="prow-price-wrap">
        <div className="prow-price num">{formatKrw(leg.krwPrice)}</div>
        {leg.fxRateUsed !== null && (
          <div className="prow-price-sub num">{formatPrice(leg.price, leg.currency)} · 환율 적용</div>
        )}
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
        {isJpy && (
          <div className="prow-price-sub num">
            {formatPrice(listing.lastKnownPrice ?? 0, listing.lastKnownCurrency ?? "KRW")} · 환율 적용
          </div>
        )}
      </div>
    </div>
  );
}
