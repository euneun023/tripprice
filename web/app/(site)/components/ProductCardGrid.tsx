import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogEntry } from "@core/services/catalogService";
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
export function ProductCardGrid({ entries, sourceRegion }: { entries: CatalogEntry[]; sourceRegion: Record<string, string> }) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--slate-400)", fontSize: 13, padding: "20px 0" }}>아직 비교할 상품이 없어요.</p>;
  }

  return (
    <div className="product-grid">
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

function PricesLine({ kr, jp }: { kr?: { krwPrice: number }; jp?: { krwPrice: number; price: number } }) {
  return (
    <div className="pcard-prices num">
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
  );
}
