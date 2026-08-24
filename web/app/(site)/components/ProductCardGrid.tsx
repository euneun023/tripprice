import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogEntry } from "@core/services/catalogService";
import type { ComparisonLeg } from "@core/services/comparisonService";
import { buildConclusion, legsByRegion } from "../lib/conclusion";
import { formatKrw } from "../../lib/format";
import { CountryMark } from "./Icons";
import { ProductImage } from "./ProductImage";
import { findCategory } from "../../lib/categories";

/**
 * Compact grid card - the "가격 차이가 큰 상품" home section. Winner,
 * savings, and comparison mode all come straight from entry.comparison
 * (comparisonService output); this component only picks words/layout for
 * numbers that already exist.
 */
export function ProductCardGrid({
  entries,
  sourceRegion,
  variant = "carousel",
  emptyText = "아직 비교할 상품이 없어요.",
  emptyHint,
}: {
  entries: CatalogEntry[];
  sourceRegion: Record<string, string>;
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
        <ProductCard key={entry.variant.id} entry={entry} sourceRegion={sourceRegion} />
      ))}
    </div>
  );
}

function ProductCard({ entry, sourceRegion }: { entry: CatalogEntry; sourceRegion: Record<string, string> }) {
  const { product, variant, comparison } = entry;
  const regionOf = (sourceId: string) => sourceRegion[sourceId];
  const conclusion = buildConclusion(comparison, regionOf);
  const byRegion = legsByRegion(comparison, regionOf);
  const kr = byRegion.KR;
  const jp = byRegion.JP;
  const categoryLabel = findCategory(product.category)?.label ?? product.category;

  let diffBlock: ReactNode;
  let priceBlock: ReactNode;

  if (conclusion.tone === "kr" || conclusion.tone === "jp") {
    const winner = comparison.legs.find((l) => l.isWinner)!;
    diffBlock = (
      <div className="pcard-diff num">
        {formatKrw(winner.savingsVsHighestKrw).replace("원", "")}
        <span className="unit">원 차이</span>
      </div>
    );
    priceBlock = <PricesLine kr={kr} jp={jp} />;
  } else if (conclusion.tone === "close") {
    diffBlock = <div className="pcard-diff flat num">{conclusion.savingsLine}</div>;
    priceBlock = <PricesLine kr={kr} jp={jp} />;
  } else {
    // single (or no-data, defensively)
    const only = comparison.legs[0];
    diffBlock = <div className="pcard-diff plain num">{only ? formatKrw(only.krwPrice) : "가격 정보 없음"}</div>;
    priceBlock = <div className="pcard-prices">다른 시장의 판매처를 아직 확인하지 못했어요</div>;
  }

  return (
    <Link href={`/products/${variant.id}`} className="pcard">
      <ProductImage src={variant.imageUrl} alt={`${product.brand} ${product.officialName}`} className="pmedia" sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 60vw" />
      <div className="pcard-body">
        <div className="pcard-brand">
          {product.brand} · {categoryLabel}
        </div>
        <div className="pcard-name">{product.officialName}</div>
        <div className="pcard-label">
          <CountryMark region={conclusion.tone === "kr" ? "KR" : conclusion.tone === "jp" ? "JP" : undefined} />
          {conclusion.headline}
        </div>
        {diffBlock}
        {priceBlock}
      </div>
    </Link>
  );
}

/**
 * Two renderings of the same KR/JP legs, toggled by CSS breakpoint (no
 * client JS): a single compact line (Home's carousel, tablet/desktop
 * browse-grid - unchanged) and a one-market-per-line stack (browse-grid's
 * mobile 2-column layout only, see .browse-grid .pcard-prices-stack in
 * site.css), which reads better at that width than cramming KR+JP+¥ into
 * one line.
 */
function PricesLine({ kr, jp }: { kr?: ComparisonLeg; jp?: ComparisonLeg }) {
  return (
    <>
      <div className="pcard-prices pcard-prices--compact num">
        {kr && (
          <>
            KR <b>{formatKrw(kr.krwPrice)}</b>
          </>
        )}
        {kr && jp && " · "}
        {jp && (
          <>
            JP <b>{formatKrw(jp.krwPrice)}</b>{" "}
            <span style={{ color: "var(--slate-400)", fontWeight: 500 }}>(¥{jp.price.toLocaleString("ja-JP")})</span>
          </>
        )}
      </div>
      <div className="pcard-prices-stack num">
        {kr && (
          <div className="pcard-price-row">
            <div className="pcard-price-main">
              <span className="pcard-price-region">KR</span>
              <span className="pcard-price-value">{formatKrw(kr.krwPrice)}</span>
            </div>
          </div>
        )}
        {jp && (
          <div className="pcard-price-row">
            <div className="pcard-price-main">
              <span className="pcard-price-region">JP</span>
              <span className="pcard-price-value">{formatKrw(jp.krwPrice)}</span>
            </div>
            {jp.fxRateUsed !== null && (
              <div className="pcard-price-fx">¥{jp.price.toLocaleString("ja-JP")} · 환율 적용</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
