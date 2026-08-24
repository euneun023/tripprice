import type { CatalogEntry } from "@core/services/catalogService";

/**
 * UI-only ordering over fields catalogService already computed
 * (comparison's winner leg / lastCheckedAt) - no new price/comparison
 * logic. Mirrors the same field access catalogService.listMeaningfulPriceGaps
 * and listRecentlyChecked use, just applied without their category-agnostic
 * "n-way only" / "top N" filtering, so 1-way and no-data entries stay in
 * the list (sorted to the back) instead of being dropped.
 */
export type SortKey = "diff" | "recent";

export function sortEntries(entries: CatalogEntry[], sort: SortKey): CatalogEntry[] {
  const copy = [...entries];
  if (sort === "recent") {
    return copy.sort((a, b) => {
      if (!a.lastCheckedAt) return 1;
      if (!b.lastCheckedAt) return -1;
      return b.lastCheckedAt > a.lastCheckedAt ? 1 : -1;
    });
  }
  return copy.sort((a, b) => savingsOf(b) - savingsOf(a));
}

function savingsOf(entry: CatalogEntry): number {
  const winner = entry.comparison.legs.find((l) => l.isWinner);
  return winner?.savingsVsHighestKrw ?? 0;
}
