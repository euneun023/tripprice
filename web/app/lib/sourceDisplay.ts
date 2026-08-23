/**
 * User-facing channel name for a source - never the raw sources.name, which
 * is an internal/API-facing label (e.g. "Rakuten Ichiba (Item Search API)").
 * Matches by source id first (stable, e.g. "rakuten"), falling back to name,
 * so a future source without an entry here still shows something (its raw
 * name) instead of disappearing.
 */
const SOURCE_DISPLAY_NAMES: { match: RegExp; label: string }[] = [
  { match: /rakuten/i, label: "라쿠텐" },
  { match: /coupang/i, label: "쿠팡" },
];

export function sourceDisplayName(source: { id: string; name: string }): string {
  for (const { match, label } of SOURCE_DISPLAY_NAMES) {
    if (match.test(source.id) || match.test(source.name)) return label;
  }
  return source.name;
}
