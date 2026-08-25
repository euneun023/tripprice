import type { Metadata } from "next";

export const SITE_NAME = "얼마차이";

/**
 * No production domain is configured yet. Until NEXT_PUBLIC_SITE_URL is set,
 * canonical/OG URLs and the sitemap are omitted entirely rather than falling
 * back to localhost or a guessed domain - a wrong canonical is worse than no
 * canonical.
 */
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
export const SITE_URL = rawSiteUrl ? rawSiteUrl.replace(/\/+$/, "") : undefined;

export function absoluteUrl(path: string): string | undefined {
  if (!SITE_URL) return undefined;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Shared shape for the four public routes' metadata: title/description plus
 * canonical + Open Graph, both gated on SITE_URL being configured. `image`
 * must already be an absolute URL (product photos are hotlinked from the
 * source marketplace's own CDN, so they resolve without SITE_URL).
 */
export function buildMetadata(opts: {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  noindex?: boolean;
}): Metadata {
  const { title, description, path, image, noindex } = opts;

  const meta: Metadata = { title, description };

  if (SITE_URL) {
    meta.alternates = { canonical: path };
  }

  if (noindex) {
    meta.robots = { index: false, follow: true };
  }

  meta.openGraph = {
    title,
    description,
    siteName: SITE_NAME,
    locale: "ko_KR",
    type: "website",
    ...(SITE_URL ? { url: path } : {}),
    ...(image ? { images: [{ url: image }] } : {}),
  };

  return meta;
}
