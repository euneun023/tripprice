import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal admin protection: HTTP Basic Auth checked against server-only env
 * vars. No session table, no cookies, no new Supabase Auth setup - deemed
 * appropriate for a single/small-operator internal tool at this stage (see
 * conversation: proposed before implementing). ADMIN_USER/ADMIN_PASSWORD
 * never reach the browser bundle - this file only runs server-side.
 */
export function proxy(req: NextRequest) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse("Admin auth is not configured (ADMIN_USER/ADMIN_PASSWORD missing).", { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    if (user === expectedUser && pass === expectedPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
