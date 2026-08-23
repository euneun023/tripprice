import Link from "next/link";
import type { CatalogEntry } from "@core/services/catalogService";
import { buildConclusion, legsByRegion } from "../lib/conclusion";
import { formatKrw } from "../../lib/format";
import { CountryMark } from "./Icons";
import { ProductImage } from "./ProductImage";

/**
 * The hero's signature card. The design reference hardcodes a single demo
 * product here; we use the real #1 entry from "가격 차이가 큰 상품" instead
 * (same data the section below it uses) so this never shows anything that
 * isn't already a real, currently-computed comparison.
 */
export function HeroSignatureCard({ entry, sourceRegion }: { entry: CatalogEntry; sourceRegion: Record<string, string> }) {
  const regionOf = (sourceId: string) => sourceRegion[sourceId];
  const conclusion = buildConclusion(entry.comparison, regionOf);
  const byRegion = legsByRegion(entry.comparison, regionOf);
  const winner = entry.comparison.legs.find((l) => l.isWinner);
  const winnerRegion = winner ? regionOf(winner.sourceId) : undefined;

  return (
    <Link href={`/products/${entry.variant.id}`} className="hero-card">
      <div className="hero-card-top">
        <ProductImage
          src={entry.variant.imageUrl}
          alt={`${entry.product.brand} ${entry.product.officialName}`}
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
          const leg = byRegion[region];
          if (!leg) return null;
          return (
            <div className="hc-row" key={region}>
              <CountryMark region={region} />
              <span className="hc-country">{region === "JP" ? "일본" : "한국"}</span>
              <div className="hc-price-wrap">
                <span className={`hc-price num${leg.isWinner ? " win" : ""}`}>{formatKrw(leg.krwPrice)}</span>
                {region === "JP" && (
                  <div className="hc-price-sub num">¥{leg.price.toLocaleString("ja-JP")} · 환율 적용</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hc-verdict-label">
        <CountryMark region={winnerRegion} />
        {conclusion.headline}
      </div>
      {conclusion.savingsLine && (
        <div className="hc-diff">
          <span className="hc-diff-num num">{conclusion.savingsLine.replace(/[^0-9,]/g, "")}</span>
          <span className="hc-diff-unit">{conclusion.savingsLine.replace(/[0-9,]/g, "").trim()}</span>
        </div>
      )}
    </Link>
  );
}
