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

export function proxy(req: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
