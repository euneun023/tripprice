import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { approveListing } from "@core/services/mappingService";

function adminUserFromRequest(req: NextRequest): string {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length));
    return decoded.split(":")[0] || "admin-ui";
  }
  return "admin-ui";
}

/**
 * This is the ONLY place a source_listing gets created from the admin UI -
 * always via approveListing() (src/services/mappingService.ts), which
 * itself refuses to overwrite an existing mapping. Nothing here decides
 * which candidate is "correct"; that was already decided by a human
 * clicking a specific "이 후보 승인" button on /admin/products/[id].
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const redirectTo = String(form.get("redirectTo") ?? "/admin/products");

  try {
    const repos = createSupabaseRepositories();
    await approveListing(repos, {
      productVariantId: String(form.get("productVariantId")),
      sourceId: String(form.get("sourceId")),
      externalId: String(form.get("externalId")),
      externalIdType: String(form.get("externalIdType")),
      sourceUrl: String(form.get("sourceUrl") ?? "") || null,
      searchKeywordUsed: String(form.get("searchKeywordUsed") ?? ""),
      approvedBy: adminUserFromRequest(req),
      confidence: (String(form.get("confidence")) as "verified" | "estimated") ?? "estimated",
      initialPrice: Number(form.get("initialPrice")),
      initialCurrency: String(form.get("initialCurrency")),
      initialAvailability: String(form.get("initialAvailability")) === "true",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "approve failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
}
