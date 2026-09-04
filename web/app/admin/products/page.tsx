import Link from "next/link";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listProductsOverview } from "@core/services/adminService";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const repos = createSupabaseRepositories();
  const rows = await listProductsOverview(repos);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>상품 관리 ({rows.length})</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/admin/price-grades" style={{ alignSelf: "center", fontSize: 14, color: "#555" }}>
            가격 메리트 등급 보기 →
          </Link>
          <Link
            href="/admin/products/new"
            style={{ background: "#111", color: "#fff", padding: "8px 14px", borderRadius: 6, textDecoration: "none", fontSize: 14 }}
          >
            + 새 상품 등록
          </Link>
        </div>
      </div>

      {rows.length === 0 && <p style={{ color: "#888" }}>등록된 상품이 없습니다.</p>}

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map(({ product, variants }) => (
          <div key={product.id} style={{ border: "1px solid #e2e2e2", borderRadius: 8, background: "#fff", padding: 16 }}>
            <div style={{ fontSize: 12, color: "#999" }}>{product.category}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {product.brand} {product.officialName}
            </div>
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>모델번호</th>
                  <th>연결된 판매처</th>
                  <th>검수 필요</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {variants.map(({ variant, listings, reviewRequiredCount }) => (
                  <tr key={variant.id}>
                    <td>
                      {Object.keys(variant.variantAttributes ?? {}).length > 0
                        ? Object.entries(variant.variantAttributes)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(" / ")
                        : variant.displayName ?? "(기본)"}
                    </td>
                    <td>{variant.modelSku ?? "-"}</td>
                    <td>{listings.length}곳</td>
                    <td>
                      {reviewRequiredCount > 0 ? (
                        <span style={{ color: "#c0392b", fontWeight: 600 }}>{reviewRequiredCount}건</span>
                      ) : (
                        <span style={{ color: "#999" }}>없음</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/admin/products/${product.id}`}>관리</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </main>
  );
}
