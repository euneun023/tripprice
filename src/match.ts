/**
 * Generic result-matching helpers: pick the item whose name contains the
 * canonical product's model/SKU, optionally excluding accessory/set terms.
 * Not tied to any category OR source - every source has a different field
 * for "the product name" (Rakuten: itemName, Coupang: productName, ...),
 * so these take a nameOf() accessor instead of assuming a field name.
 */

/**
 * Keep letters (any script - Latin, Kana, Kanji, Hangul...) and digits only.
 * Earlier version stripped to [a-zA-Z0-9], which silently discarded
 * Japanese-only match terms (normalized to ""). Fixed via unicode property
 * escapes so non-Latin product names/terms work the same way.
 */
export function normalize(s: string): string {
  return s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function pickItemBySku<T>(
  items: T[],
  sku: string,
  nameOf: (item: T) => string,
): T | undefined {
  const target = normalize(sku);
  if (!target) return undefined;
  return items.find((item) => normalize(nameOf(item)).includes(target));
}

export interface TermMatchOptions {
  /** all of these (normalized) must appear in the item name */
  requiredTerms: string[];
  /** if any of these (normalized) appear, the item is rejected - for filtering out accessories/sets/other variants */
  excludeTerms?: string[];
}

export interface TermMatchResult<T> {
  matched: T | undefined;
  /** items that satisfied requiredTerms but got knocked out by excludeTerms - evidence for the accessory/false-positive check */
  excluded: T[];
}

export function pickItemByTerms<T>(
  items: T[],
  options: TermMatchOptions,
  nameOf: (item: T) => string,
): TermMatchResult<T> {
  const required = options.requiredTerms.map(normalize).filter(Boolean);
  const excluded_ = (options.excludeTerms ?? []).map(normalize).filter(Boolean);

  const excluded: T[] = [];
  let matched: T | undefined;

  for (const item of items) {
    const name = normalize(nameOf(item));
    if (!required.every((t) => name.includes(t))) continue;
    if (excluded_.some((t) => name.includes(t))) {
      excluded.push(item);
      continue;
    }
    if (!matched) matched = item;
  }

  return { matched, excluded };
}
