import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { refreshApprovedListings } from "@core/services/refreshService";

const rakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
const coupangCreds = {
  accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
  secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
};

/** "전체 refresh 실행" button - reuses refreshApprovedListings() per source, unchanged from Phase 1. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const redirectTo = String(form.get("redirectTo") ?? "/admin/reviews");

  const repos = createSupabaseRepositories();
  const deps = { repos, rakutenCreds, coupangCreds };
  await refreshApprovedListings(deps, { sourceId: "rakuten", limit: 50 });
  await refreshApprovedListings(deps, { sourceId: "coupang", limit: 50 });

  return NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
}
