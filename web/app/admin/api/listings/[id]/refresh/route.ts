import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { refreshOneListing } from "@core/services/refreshService";

const rakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
const coupangCreds = {
  accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
  secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
};

/** Individual "refresh" button - reuses refreshOneListing() unchanged, no re-implementation of the re-identify/review logic. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const redirectTo = String(form.get("redirectTo") ?? "/admin/reviews");

  const repos = createSupabaseRepositories();
  const listing = await repos.sourceListings.getById(id);

  if (!listing) {
    return NextResponse.json({ error: "listing not found or inactive" }, { status: 404 });
  }

  await refreshOneListing(listing, { repos, rakutenCreds, coupangCreds });

  return NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
}
