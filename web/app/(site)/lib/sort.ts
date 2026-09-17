import type { CatalogEntry } from "@core/services/catalogService";

/**
 * UI-only ordering over fields catalogService already computed
 * (marketComparison's winner leg / lastCheckedAt) - no new price/comparison
 * logic.
 *
 * Phase 2-F1.2: "diff" no longer reads the legacy leg-based `comparison`
 * field (see the F1.1 sanity gate this follows - it could rank an
 * `estimated`-confidence match above a `verified` one using a "savings"
 * figure the public UI no longer even displays for that entry). Only
 * mode === "comparable" && headlineAllowed (both markets' representative
 * offer confidence="verified", no duplicate market - see
 * marketQuoteService.ts) counts as a real, disclosable gap; everything else
 * (comparable-unverified / single-market / duplicate-review-required /
 * no-data) keeps its existing relative order, placed after every verified
 * entry, rather than being force-ranked by a number nothing here can vouch
 * for.
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

  const verified = copy.filter((e) => verifiedGapKrw(e) !== null);
  const rest = copy.filter((e) => verifiedGapKrw(e) === null);
  verified.sort((a, b) => verifiedGapKrw(b)! - verifiedGapKrw(a)!);
  return [...verified, ...rest];
}

/** null unless this entry is a verified comparable comparison - see the
 * header comment above for why that's the only case a real gap exists. */
function verifiedGapKrw(entry: CatalogEntry): number | null {
  const { marketComparison } = entry;
  if (marketComparison.mode !== "comparable" || !marketComparison.headlineAllowed) return null;
  const winner = marketComparison.legs.find((l) => l.isWinner);
  return winner?.savingsVsHighestKrw ?? null;
}
