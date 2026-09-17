import type { CatalogEntry } from "@core/services/catalogService";
import { buildConclusion, quoteByRegion } from "../lib/conclusion";
import { formatKrw, productDisplayName } from "../../lib/format";
import { CountryMark } from "./Icons";
import { ProductImage } from "./ProductImage";
import { TrackedProductLink } from "./TrackedProductLink";

/**
 * The hero's signature card. The design reference hardcodes a single demo
 * product here; we use the real #1 entry from "가격 차이가 큰 상품" instead
 * (same data the section below it uses) so this never shows anything that
 * isn't already a real, currently-computed comparison. Phase 2-F1: never
 * claims a "최저가"/"가장 저렴해요" - see conclusion.ts.
 */
export function HeroSignatureCard({ entry }: { entry: CatalogEntry }) {
  const { marketComparison } = entry;
  const conclusion = buildConclusion(marketComparison);
  const byRegion = quoteByRegion(marketComparison);
  const winnerLeg = marketComparison.mode === "comparable" ? marketComparison.legs.find((l) => l.isWinner) : undefined;

  return (
    <TrackedProductLink
      href={`/products/${entry.variant.id}`}
      className="hero-card"
      selectItem={{
        product_id: entry.product.id,
        variant_id: entry.variant.id,
        category: entry.product.category,
        comparison_mode: marketComparison.mode,
        winner_market: winnerLeg?.marketKey,
      }}
    >
      <div className="hero-card-top">
        <ProductImage
          src={entry.variant.imageUrl}
          alt={productDisplayName(entry.product.brand, entry.product.officialName)}
          className="hero-card-img"
          sizes="64px"
        />
        <div className="hero-card-name-wrap">
          <div className="hero-card-brand">{entry.product.brand}</div>
          <div className="hero-card-name">{entry.product.officialName}</div>
        </div>
      </div>

      <div className="hc-rows">
        {(["JP", "KR"] as const).map((region) => {
          const quote = byRegion[region];
          const offer = quote?.status === "single" ? quote.representativeOffer : null;
          const leg = marketComparison.legs.find((l) => l.marketKey === region);
          if (!offer || !leg) return null;
          return (
            <div className="hc-row" key={region}>
              <CountryMark region={region} />
              <span className="hc-country">{region === "JP" ? "일본" : "한국"}</span>
              <div className="hc-price-wrap">
                <span className={`hc-price num${marketComparison.mode === "comparable" && leg.isWinner ? " win" : ""}`}>
                  {formatKrw(leg.krwPrice)}
                </span>
                {region === "JP" && <div className="hc-price-sub num">¥{offer.price!.toLocaleString("ja-JP")} · 환율 적용</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hc-verdict-label">
        <CountryMark region={undefined} />
        {conclusion.headline}
      </div>
      {conclusion.diffLine && (
        <div className="hc-diff">
          <span className="hc-diff-num num">{conclusion.diffLine.replace(/[^0-9,]/g, "")}</span>
          <span className="hc-diff-unit">{conclusion.diffLine.replace(/[0-9,]/g, "").trim()}</span>
        </div>
      )}
    </TrackedProductLink>
  );
}
