/**
 * Public-display policy: which sources' API-derived data (prices, stock,
 * seller URLs, listing images) may be rendered on PUBLIC pages.
 *
 * Why this exists: being able to call a source's API, or having a human
 * approve a product match, says nothing about whether we are allowed to
 * store/republish that source's data publicly (or next to another
 * marketplace's affiliate link). Those are three independent conditions:
 *   1. match approval      -> source_listings.confidence / approved_by
 *   2. price is current    -> source_listings.last_success_at / review_required
 *   3. data-use permission -> THIS policy (explicit, operator-managed)
 *
 * Default is DENY: a missing, empty or malformed PUBLIC_PRICE_SOURCES
 * env var means no source is public. No source - Rakuten, Coupang, or any
 * future one - is ever implicitly allowed. Nothing here touches the DB:
 * stored listings, price_history, matching and scheduled refresh keep
 * working exactly as before; only the public read path filters.
 *
 * Server-only: read from process.env at request time (public pages are
 * force-dynamic), so changing the env var on the running service takes
 * effect without a rebuild, and is reverted the same way.
 */

export const PUBLIC_PRICE_SOURCES_ENV = "PUBLIC_PRICE_SOURCES";

export interface PublicDisplayPolicy {
  /** lowercase source ids (sources.id) whose data may be shown publicly */
  readonly allowedSourceIds: ReadonlySet<string>;
}

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Parses a comma-separated allowlist of sources.id values, e.g.
 * "coupang" or "coupang,rakuten". Tokens are trimmed and lowercased.
 * Anything that isn't a plain source id (including "*", "all", "true")
 * is ignored - there is deliberately no wildcard.
 */
export function parsePublicPriceSources(raw: string | null | undefined): PublicDisplayPolicy {
  const allowed = new Set<string>();
  if (typeof raw === "string") {
    for (const token of raw.split(",")) {
      const id = token.trim().toLowerCase();
      if (id === "all" || id === "true") continue;
      if (SOURCE_ID_PATTERN.test(id)) allowed.add(id);
    }
  }
  return { allowedSourceIds: allowed };
}

export function publicDisplayPolicyFromEnv(env: Record<string, string | undefined> = process.env): PublicDisplayPolicy {
  return parsePublicPriceSources(env[PUBLIC_PRICE_SOURCES_ENV]);
}

export function isSourcePublic(policy: PublicDisplayPolicy, sourceId: string): boolean {
  return policy.allowedSourceIds.has(sourceId.toLowerCase());
}

/** Keeps only listings whose source is explicitly allowed. Never mutates its input. */
export function filterPublicListings<T extends { sourceId: string }>(listings: readonly T[], policy: PublicDisplayPolicy): T[] {
  return listings.filter((l) => isSourcePublic(policy, l.sourceId));
}

/**
 * Image hosts known to serve a given source's API-provided images
 * (product_variants.image_url is backfilled from approved listings - see
 * src/scripts/backfill-variant-images.ts - so it carries the same
 * data-use question as the price itself). A host matches if it equals an
 * entry or is a subdomain of it.
 */
export const SOURCE_IMAGE_HOSTS: Readonly<Record<string, readonly string[]>> = {
  rakuten: ["rakuten.co.jp", "r10s.jp"],
  coupang: ["coupang.com", "coupangcdn.com"],
};

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Returns the image URL only if its host belongs to an allowed source.
 * An image from an unknown host has no known provenance, so it is treated
 * as unconfirmed and withheld too (default deny) - the UI already has a
 * placeholder for a null image.
 */
export function publicImageUrl(url: string | null | undefined, policy: PublicDisplayPolicy): string | null {
  if (!url) return null;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const sourceId of policy.allowedSourceIds) {
    const hosts = SOURCE_IMAGE_HOSTS[sourceId];
    if (hosts?.some((suffix) => hostMatches(host, suffix))) return url;
  }
  return null;
}

/** Copy of a variant with imageUrl passed through publicImageUrl(). */
export function withPublicImage<V extends { imageUrl: string | null }>(variant: V, policy: PublicDisplayPolicy): V {
  const imageUrl = publicImageUrl(variant.imageUrl, policy);
  return imageUrl === variant.imageUrl ? variant : { ...variant, imageUrl };
}
