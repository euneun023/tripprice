import Link from "next/link";
import type { CatalogEntry } from "@core/services/catalogService";
import { buildConclusion } from "../lib/conclusion";
import { formatCheckedDate, formatKrw } from "../../lib/format";

/**
 * The site's signature list: a ledger, not a card grid. Reused on the home
 * page (price-gap / recently-checked) and, unstyled beyond this, on
 * category and search pages too - one consistent visual language for
 * "here's a product and its verdict."
 */
export function EntryList({
  entries,
  emptyText,
  sourceRegion,
  showTimestamp,
}: {
  entries: CatalogEntry[];
  emptyText: string;
  sourceRegion: Record<string, string>;
  /** recently-checked list emphasizes the check date instead of the verdict line */
  showTimestamp?: boolean;
}) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>{emptyText}</p>;
  }

  return (
    <div className="ledger">
      {entries.map((entry) => {
        const conclusion = buildConclusion(entry.comparison, (sourceId) => sourceRegion[sourceId]);
        const winner = entry.comparison.legs.find((l) => l.isWinner);
        return (
          <Link key={entry.variant.id} href={`/products/${entry.variant.id}`} className="ledger-row">
            <div className="ledger-row__main">
              <div className="ledger-row__eyebrow">{entry.product.category}</div>
              <div className="ledger-row__title">
                {entry.product.brand} {entry.product.officialName}
              </div>
              <div className="ledger-row__verdict" data-tone={conclusion.tone === "close" || conclusion.tone === "single" ? undefined : "save"}>
                {showTimestamp ? `${formatCheckedDate(entry.lastCheckedAt)} · ${conclusion.cardLine}` : conclusion.cardLine}
              </div>
            </div>
            {winner && (
              <div className="ledger-row__price">
                <div className="num ledger-row__price-num">{formatKrw(winner.krwPrice)}</div>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
