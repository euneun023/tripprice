import type { CatalogEntry } from "@core/services/catalogService";
import { buildConclusion } from "../lib/conclusion";
import { formatKrw, productDisplayName } from "../../lib/format";
import { ChevronRightIcon } from "./Icons";
import { ProductImage } from "./ProductImage";
import { TrackedProductLink } from "./TrackedProductLink";
import { findCategory } from "../../lib/categories";

export function RecentRowList({ entries }: { entries: CatalogEntry[] }) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--slate-400)", fontSize: 13, padding: "20px 0" }}>아직 확인된 상품이 없어요.</p>;
  }

  return (
    <div className="recent-list">
      {entries.map((entry) => {
        const { marketComparison } = entry;
        const conclusion = buildConclusion(marketComparison);
        // "muted" (de-emphasized) styling for anything that isn't a clean
        // verified 2-market comparison - Phase 2-F1: an estimated-confidence
        // or duplicate-market result never gets the bold "차이" treatment
        // single/no-data already didn't.
        const isMuted = marketComparison.mode !== "comparable";
        const winnerLeg = marketComparison.mode === "comparable" ? marketComparison.legs.find((l) => l.isWinner) : undefined;
        const categoryLabel = findCategory(entry.product.category)?.label ?? entry.product.category;

        return (
          <TrackedProductLink
            key={entry.variant.id}
            href={`/products/${entry.variant.id}`}
            className="recent-row"
            selectItem={{
              product_id: entry.product.id,
              variant_id: entry.variant.id,
              category: entry.product.category,
              comparison_mode: marketComparison.mode,
              winner_market: winnerLeg?.marketKey,
            }}
          >
            <ProductImage
              src={entry.variant.imageUrl}
              alt={productDisplayName(entry.product.brand, entry.product.officialName)}
              className="recent-thumb"
              sizes="50px"
            />
            <div className="recent-mid">
              <div className="recent-name">{entry.product.officialName}</div>
              <div className="recent-cat">
                {entry.product.brand} · {categoryLabel}
              </div>
            </div>
            <div className={`recent-concl${isMuted ? " muted" : ""}`}>
              {winnerLeg && !isMuted ? (
                <>
                  <span className="num">{formatKrw(winnerLeg.savingsVsHighestKrw)}</span> 차이
                </>
              ) : (
                conclusion.cardLine
              )}
            </div>
            <ChevronRightIcon />
          </TrackedProductLink>
        );
      })}
    </div>
  );
}
