import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal admin protection: HTTP Basic Auth checked against server-only env
 * vars. No session table, no cookies, no new Supabase Auth setup - deemed
 * appropriate for a single/small-operator internal tool at this stage (see
 * conversation: proposed before implementing). ADMIN_USER/ADMIN_PASSWORD
 * never reach the browser bundle - this file only runs server-side.
 */
function hasValidBasicAuth(req: NextRequest, expectedUser: string, expectedPass: string): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) return false;
  const decoded = atob(authHeader.slice("Basic ".length));
  const separatorIndex = decoded.indexOf(":");
  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  return user === expectedUser && pass === expectedPass;
}

/**
 * CSRF defense for the state-changing admin/api POSTs: Basic Auth alone
 * doesn't stop a cross-site form/fetch, since browsers attach saved
 * credentials automatically. Compares the request's own Origin against
 * req.nextUrl.host (derived from the incoming request, not a hardcoded
 * domain) so this keeps working across *.run.app and any custom domain
 * without code changes. Sec-Fetch-Site is a secondary signal for browsers
 * that omit Origin on some same-site requests. Only unsafe methods
 * (anything but GET/HEAD/OPTIONS) are checked - page loads are unaffected.
 */
function isSameOriginRequest(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === req.nextUrl.host;
    } catch {
      return false;
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  // Neither header present (older browser or non-browser client, e.g. curl):
  // can't prove cross-site, so don't block - Basic Auth remains the primary
  // control for those clients.
  return true;
}

/**
 * Basic Auth + CSRF for /admin/* only. Returns a response to short-circuit
 * with (401/403/500), or null to let the request continue - callers must
 * only invoke this for admin paths, since it always demands credentials.
 */
function adminGate(req: NextRequest): NextResponse | null {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse("Admin auth is not configured (ADMIN_USER/ADMIN_PASSWORD missing).", { status: 500 });
  }

  if (!hasValidBasicAuth(req, expectedUser, expectedPass)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="admin"' },
    });
  }

  if (!isSameOriginRequest(req)) {
    return new NextResponse("Cross-site request blocked", { status: 403 });
  }

  return null;
}

/**
 * Enforced CSP. Rolled out first as Content-Security-Policy-Report-Only so
 * real traffic could surface violations before anything was actually
 * blocked - verified clean (0 violations) against production traffic before
 * this switch to the enforcing Content-Security-Policy header. Policy
 * content itself is unchanged from the Report-Only version.
 *
 * script-src: nonce + 'strict-dynamic' instead of 'unsafe-inline' - every
 * page in this app is already `force-dynamic` (Supabase reads happen per
 * request), which is the precondition Next.js documents for nonce-based CSP
 * to work at all (nonces are applied during server rendering; a statically
 * generated page has no per-request nonce to inject). googletagmanager.com
 * is listed for gtag.js itself (confirmed by reading
 * node_modules/@next/third-parties/dist/google/ga.js - <GoogleAnalytics>
 * renders exactly one external script from that host plus one inline script,
 * both of which accept the nonce prop we thread through from here).
 *
 * style-src-attr: 'unsafe-inline' is a real, currently-necessary exception -
 * this app uses React's `style={{...}}` prop extensively (confirmed via grep
 * across 10+ files, including public site pages), which renders as an inline
 * `style=""` HTML attribute. CSP nonces only cover <style> elements/<link>,
 * never inline style attributes (no mechanism exists for that in the spec),
 * so there's no way to allow these without 'unsafe-inline' short of removing
 * every inline style prop. Scoped to style-src-attr specifically (not a
 * blanket style-src 'unsafe-inline') so injecting a whole <style> block via
 * XSS is still blocked - style-src itself stays 'self' only.
 *
 * img-src/connect-src: only GA4's own domains, scoped down from Google's
 * full recommended CSP list (developers.google.com/tag-platform/security/
 * guides/csp) by dropping every ads/remarketing-only origin
 * (doubleclick.net, googlesyndication.com, generic google.<TLD>) - this app
 * sets ad_storage: 'denied' unconditionally (see (site)/layout.tsx) and has
 * no ads/remarketing use of GA4 at all. Product images never need a source
 * here: next/image is used without `unoptimized` anywhere (confirmed via
 * grep), so the browser only ever requests the same-origin /_next/image
 * proxy - Rakuten/Coupang's CDN hostnames in next.config.mjs's
 * remotePatterns are fetched server-side only.
 *
 * 'unsafe-eval' is deliberately absent: nothing in this app's own code uses
 * eval/new Function, and Next's own CSP guide confirms neither Next nor
 * React need it in production (only React's dev-mode error reconstruction
 * does).
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com",
    "font-src 'self'",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  // Public paths never run the admin gate at all - it's only even called
  // for /admin/*, so a public page can't accidentally start demanding
  // credentials just because this file's matcher now covers it too.
  if (isAdminPath) {
    const blocked = adminGate(req);
    if (blocked) return blocked;
  }

  // A fresh, unguessable nonce per request (crypto.randomUUID() - CSPRNG,
  // ~122 bits of randomness), applied to every matched request including
  // /admin/* once auth/CSRF above have passed.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Set on the outgoing *request* headers too (not just the response) so
  // Next.js's own server rendering - which reads
  // Content-Security-Policy[-Report-Only] off the request to auto-apply the
  // nonce to its own framework/RSC scripts - sees it, and so Server
  // Components can read x-nonce via headers() to pass into our own
  // <Script>/<GoogleAnalytics> nonce props.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except Next's own static/image-optimizer assets and the
      // favicon - those never render HTML/script and don't need a nonce or
      // admin gating. /admin/* (pages and /admin/api/*) stays included.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        // Next `<Link>` prefetch requests - no real page render happens for
        // these, so no nonce is needed and there's nothing to gate.
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
