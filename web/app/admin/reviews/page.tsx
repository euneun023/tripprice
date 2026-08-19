import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listReviewQueueWithContext } from "@core/services/adminService";
import { REVIEW_REASON_LABELS } from "@core/domain/types";
import { formatPrice, formatCheckedDateTime } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const repos = createSupabaseRepositories();
  const rows = await listReviewQueueWithContext(repos);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>검수 필요 ({rows.length})</h1>
        <form action="/admin/api/refresh-all" method="POST">
          <input type="hidden" name="redirectTo" value="/admin/reviews" />
          <button type="submit" style={{ background: "#111", color: "#fff", padding: "8px 14px", borderRadius: 6, border: "none", fontSize: 14, cursor: "pointer" }}>
            전체 refresh 실행
          </button>
        </form>
      </div>

      {rows.length === 0 && <p style={{ color: "#888" }}>검수가 필요한 항목이 없습니다.</p>}

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map(({ listing, variant, product, previousPrice }) => (
          <div key={listing.id} style={{ border: "1px solid #e2e2e2", borderRadius: 8, background: "#fff", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <span
                  style={{
                    display: "inline-block",
                    background: "#fdecea",
                    color: "#c0392b",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 4,
                    padding: "2px 8px",
                    marginBottom: 6,
                  }}
                >
                  {REVIEW_REASON_LABELS[listing.reviewReason!] ?? listing.reviewReason}
                </span>
                <div style={{ fontWeight: 700 }}>
                  {product ? `${product.brand} ${product.officialName}` : "(상품 정보 없음)"}
                </div>
                <div style={{ fontSize: 12, color: "#999" }}>
                  {listing.sourceId} · externalId=<span style={{ fontFamily: "monospace" }}>{listing.externalId}</span>
                </div>
              </div>
              <form action={`/admin/api/listings/${listing.id}/refresh`} method="POST">
                <input type="hidden" name="redirectTo" value="/admin/reviews" />
                <button type="submit" style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer", height: "fit-content" }}>
                  이 항목만 refresh
                </button>
              </form>
            </div>

            <table style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <th style={{ width: 120 }}>기존 가격</th>
                  <td>
                    {previousPrice && previousPrice.price !== null
                      ? formatPrice(previousPrice.price, previousPrice.currency ?? "KRW")
                      : "이력 없음"}
                  </td>
                  <th style={{ width: 120 }}>현재 가격</th>
                  <td>
                    {listing.lastKnownPrice !== null
                      ? formatPrice(listing.lastKnownPrice, listing.lastKnownCurrency ?? "KRW")
                      : "-"}
                  </td>
                </tr>
                <tr>
                  <th>last_checked_at</th>
                  <td>{formatCheckedDateTime(listing.lastCheckedAt)}</td>
                  <th>last_success_at</th>
                  <td>{formatCheckedDateTime(listing.lastSuccessAt)}</td>
                </tr>
                {variant && (
                  <tr>
                    <th>variant</th>
                    <td colSpan={3}>
                      {Object.keys(variant.variantAttributes ?? {}).length > 0
                        ? Object.entries(variant.variantAttributes).map(([k, v]) => `${k}:${v}`).join(" / ")
                        : (variant.displayName ?? "(기본)")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </main>
  );
}
