import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/seo";

// /search is intentionally allowed here (not disallowed) even though it's
// noindex - crawlers need to be able to reach it to see the noindex,follow
// tag and follow its product links. Blocking it in robots.txt instead would
// hide that tag and cut off link discovery through search result pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin"],
    },
    ...(SITE_URL ? { sitemap: `${SITE_URL}/sitemap.xml` } : {}),
  };
}
