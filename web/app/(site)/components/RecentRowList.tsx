import Link from "next/link";
import type { CatalogEntry } from "@core/services/catalogService";
import { buildConclusion } from "../lib/conclusion";
import { formatKrw } from "../../lib/format";
import { ChevronRightIcon } from "./Icons";
import { ProductImage } from "./ProductImage";
import { findCategory } from "../../lib/categories";

export function RecentRowList({ entries, sourceRegion }: { entries: CatalogEntry[]; sourceRegion: Record<string, string> }) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--slate-400)", fontSize: 13, padding: "20px 0" }}>아직 확인된 상품이 없어요.</p>;
  }

  return (
    <div className="recent-list">
      {entries.map((entry) => {
        const conclusion = buildConclusion(entry.comparison, (sourceId) => sourceRegion[sourceId]);
        const isMuted = conclusion.tone === "close" || conclusion.tone === "single" || conclusion.tone === "no-data";
        const winner = entry.comparison.legs.find((l) => l.isWinner);
        const categoryLabel = findCategory(entry.product.category)?.label ?? entry.product.category;

        return (
          <Link key={entry.variant.id} href={`/products/${entry.variant.id}`} className="recent-row">
            <ProductImage
              src={entry.variant.imageUrl}
              alt={`${entry.product.brand} ${entry.product.officialName}`}
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
              {winner && !isMuted ? (
                <>
                  <span className="num">{formatKrw(winner.savingsVsHighestKrw)}</span> 차이
                </>
              ) : (
                conclusion.cardLine
              )}
            </div>
            <ChevronRightIcon />
          </Link>
        );
      })}
    </div>
  );
}
