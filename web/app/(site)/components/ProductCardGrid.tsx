import type { ReactNode } from "react";
import type { CatalogEntry } from "@core/services/catalogService";
import type { MarketQuote } from "@core/services/marketQuoteService";
import { buildConclusion, quoteByRegion } from "../lib/conclusion";
import { formatKrw, productDisplayName } from "../../lib/format";
import { CountryMark } from "./Icons";
import { ProductImage } from "./ProductImage";
import { TrackedProductLink } from "./TrackedProductLink";
import { findCategory } from "../../lib/categories";

/**
 * Compact grid card - the "가격 차이가 큰 상품" home section. Every string and
 * number here comes straight from entry.marketComparison (marketQuoteService's
 * output, via buildConclusion()) - this component only picks layout for
 * numbers/text that already exist. Phase 2-F1: never claims a "최저가"/
 * "가장 저렴해요"/"N원 절약" - see conclusion.ts's own header comment for why.
 */
export function ProductCardGrid({
  entries,
  variant = "carousel",
  emptyText = "아직 비교할 상품이 없어요.",
  emptyHint,
}: {
  entries: CatalogEntry[];
  /** "carousel" = Home's horizontal-scroll row (default, unchanged). "grid" =
   * a wrapping grid (4 desktop / 3 tablet / 2 mobile) for browse pages
   * (category/search) - same .pcard markup, just a different container. */
  variant?: "carousel" | "grid";
  emptyText?: string;
  /** second empty-state line, e.g. search's "다시 확인해보세요" hint. Only
   * present -> renders the larger centered empty state; absent -> keeps
   * Home's original plain-text empty row untouched. */
  emptyHint?: string;
}) {
  if (entries.length === 0) {
    if (emptyHint) {
      return (
        <div className="browse-empty">
          <div className="browse-empty-title">{emptyText}</div>
          <div className="browse-empty-hint">{emptyHint}</div>
        </div>
      );
    }
    return <p style={{ color: "var(--slate-400)", fontSize: 13, padding: "20px 0" }}>{emptyText}</p>;
  }

  return (
    <div className={variant === "grid" ? "browse-grid" : "product-grid"}>
      {entries.map((entry) => (
        <ProductCard key={entry.variant.id} entry={entry} />
      ))}
    </div>
  );
}

function ProductCard({ entry }: { entry: CatalogEntry }) {
  const { product, variant, marketComparison } = entry;
  const conclusion = buildConclusion(marketComparison);
  const byRegion = quoteByRegion(marketComparison);
  const kr = byRegion.KR;
  const jp = byRegion.JP;
  const categoryLabel = findCategory(product.category)?.label ?? product.category;
  const winnerLeg = marketComparison.mode === "comparable" ? marketComparison.legs.find((l) => l.isWinner) : undefined;

  let diffBlock: ReactNode;
  let priceBlock: ReactNode;

  if (marketComparison.mode === "comparable") {
    diffBlock = conclusion.diffLine ? (
      <div className="pcard-diff num">
        {conclusion.diffLine.replace(/[^0-9,]/g, "")}
        <span className="unit"> 차이</span>
      </div>
    ) : (
      <div className="pcard-diff flat num">가격 차이가 거의 없어요</div>
    );
    priceBlock = <PricesLine kr={kr} jp={jp} />;
  } else if (marketComparison.mode === "comparable-unverified") {
    diffBlock = <div className="pcard-diff flat num">{conclusion.cardLine}</div>;
    priceBlock = <PricesLine kr={kr} jp={jp} />;
  } else if (marketComparison.mode === "single-market") {
    const only = marketComparison.legs[0];
    diffBlock = <div className="pcard-diff plain num">{only ? formatKrw(only.krwPrice) : "가격 정보 없음"}</div>;
    priceBlock = <div className="pcard-prices">{conclusion.cardLine}</div>;
  } else {
    // duplicate-review-required | no-data
    diffBlock = <div className="pcard-diff plain num">{conclusion.cardLine}</div>;
    priceBlock = <div className="pcard-prices">{conclusion.cardLine}</div>;
  }

  return (
    <TrackedProductLink
      href={`/products/${variant.id}`}
      className="pcard"
      selectItem={{
        product_id: product.id,
        variant_id: variant.id,
        category: product.category,
        comparison_mode: marketComparison.mode,
        winner_market: winnerLeg?.marketKey,
      }}
    >
      <ProductImage src={variant.imageUrl} alt={productDisplayName(product.brand, product.officialName)} className="pmedia" sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 60vw" />
      <div className="pcard-body">
        <div className="pcard-brand">
          {product.brand} · {categoryLabel}
        </div>
        <div className="pcard-name">{product.officialName}</div>
        <div className="pcard-label">
          <CountryMark region={undefined} />
          {conclusion.headline}
        </div>
        {diffBlock}
        {priceBlock}
      </div>
    </TrackedProductLink>
  );
}

/**
 * Two renderings of the same KR/JP quotes, toggled by CSS breakpoint (no
 * client JS): a single compact line (Home's carousel, tablet/desktop
 * browse-grid - unchanged) and a one-market-per-line stack (browse-grid's
 * mobile 2-column layout only, see .browse-grid .pcard-prices-stack in
 * site.css), which reads better at that width than cramming KR+JP+¥ into
 * one line. Only renders a price for a market whose MarketQuote actually
 * resolved to a single eligible offer (status "single") - a market still
 * needing review (duplicate) or with nothing eligible shows nothing here.
 */
function PricesLine({ kr, jp }: { kr?: MarketQuote; jp?: MarketQuote }) {
  const krOffer = kr?.status === "single" ? kr.representativeOffer : null;
  const jpOffer = jp?.status === "single" ? jp.representativeOffer : null;
  if (!krOffer && !jpOffer) return null;

  return (
    <>
      <div className="pcard-prices pcard-prices--compact num">
        {krOffer && (
          <>
            KR <b>{formatKrw(krOffer.price!)}</b>
          </>
        )}
        {krOffer && jpOffer && " · "}
        {jpOffer && (
          <>
            JP <b>{formatKrw(jpOffer.price!)}</b>
          </>
        )}
      </div>
      <div className="pcard-prices-stack num">
        {krOffer && (
          <div className="pcard-price-row">
            <div className="pcard-price-main">
              <span className="pcard-price-region">KR</span>
              <span className="pcard-price-value">{formatKrw(krOffer.price!)}</span>
            </div>
          </div>
        )}
        {jpOffer && (
          <div className="pcard-price-row">
            <div className="pcard-price-main">
              <span className="pcard-price-region">JP</span>
              <span className="pcard-price-value">¥{jpOffer.price!.toLocaleString("ja-JP")}</span>
            </div>
            <div className="pcard-price-fx">환율 적용</div>
          </div>
        )}
      </div>
    </>
  );
}
