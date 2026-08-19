import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { searchRakutenCandidates, searchCoupangCandidates } from "@core/services/mappingService";
import { REVIEW_REASON_LABELS } from "@core/domain/types";
import { formatPrice, formatCheckedDateTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

const rakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
const coupangCreds = {
  accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
  secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
};

export default async function AdminProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string; source?: string; keyword?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const repos = createSupabaseRepositories();

  const product = await repos.canonicalProducts.getProduct(id);
  if (!product) notFound();

  const variants = await repos.canonicalProducts.listVariantsForProduct(id);
  const variantListings = await Promise.all(
    variants.map(async (variant) => ({ variant, listings: await repos.sourceListings.listByVariant(variant.id) })),
  );

  // search only ever runs for the variant/source/keyword explicitly requested via the GET form below -
  // nothing here auto-selects or auto-approves a candidate.
  let candidates: Array<{ externalId: string; externalIdType: string; name: string; price: number; currency: string; availability: boolean; sourceUrl: string }> = [];
  if (sp.variant && sp.source && sp.keyword) {
    if (sp.source === "rakuten") {
      const items = await searchRakutenCandidates(sp.keyword, rakutenCreds);
      candidates = items.map((it) => ({
        externalId: it.itemCode,
        externalIdType: "rakuten_item_code",
        name: it.itemName,
        price: it.itemPrice,
        currency: "JPY",
        availability: it.availability === 1,
        sourceUrl: it.itemUrl,
      }));
    } else if (sp.source === "coupang") {
      const items = await searchCoupangCandidates(sp.keyword, coupangCreds);
      candidates = items.map((it) => ({
        externalId: String(it.productId),
        externalIdType: "coupang_product_id",
        name: it.productName,
        price: it.productPrice,
        currency: "KRW",
        availability: true,
        sourceUrl: it.productUrl,
      }));
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ fontSize: 13, color: "#888" }}>{product.category}</div>
      <h1 style={{ fontSize: 22, margin: "0 0 20px" }}>
        {product.brand} {product.officialName}
      </h1>

      {variantListings.map(({ variant, listings }) => (
        <section key={variant.id} style={{ marginBottom: 32, border: "1px solid #e2e2e2", borderRadius: 8, background: "#fff", padding: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>
            Variant: {Object.keys(variant.variantAttributes ?? {}).length > 0
              ? Object.entries(variant.variantAttributes).map(([k, v]) => `${k}:${v}`).join(" / ")
              : (variant.displayName ?? "(기본)")}{" "}
            {variant.modelSku && <span style={{ color: "#999", fontWeight: 400 }}>· {variant.modelSku}</span>}
          </h2>

          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>소스</th>
                <th>externalId</th>
                <th>가격</th>
                <th>신뢰도</th>
                <th>상태</th>
                <th>확인시각</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "#999" }}>
                    아직 연결된 판매처가 없습니다.
                  </td>
                </tr>
              )}
              {listings.map((l) => (
                <tr key={l.id}>
                  <td>{l.sourceId}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{l.externalId}</td>
                  <td>{l.lastKnownPrice !== null ? formatPrice(l.lastKnownPrice, l.lastKnownCurrency ?? "KRW") : "-"}</td>
                  <td>{l.confidence}</td>
                  <td>
                    {l.reviewRequired ? (
                      <span style={{ color: "#c0392b" }}>{REVIEW_REASON_LABELS[l.reviewReason!] ?? l.reviewReason}</span>
                    ) : (
                      "정상"
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{formatCheckedDateTime(l.lastCheckedAt)}</td>
                  <td>
                    <form action={`/admin/api/listings/${l.id}/refresh`} method="POST">
                      <input type="hidden" name="redirectTo" value={`/admin/products/${id}`} />
                      <button type="submit" style={smallBtn}>
                        refresh
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <details open={sp.variant === variant.id}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "#555" }}>+ 판매처 후보 검색</summary>
            <form action={`/admin/products/${id}`} method="GET" style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <input type="hidden" name="variant" value={variant.id} />
              <select name="source" defaultValue={sp.variant === variant.id ? sp.source : "rakuten"} style={{ padding: 6 }}>
                <option value="rakuten">Rakuten</option>
                <option value="coupang">Coupang</option>
              </select>
              <input
                type="text"
                name="keyword"
                defaultValue={sp.variant === variant.id ? sp.keyword : ""}
                placeholder="검색어"
                style={{ padding: 6, flex: 1 }}
              />
              <button type="submit" style={smallBtn}>
                검색
              </button>
            </form>

            {sp.variant === variant.id && (
              <div style={{ display: "grid", gap: 8 }}>
                {candidates.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>검색 결과가 없습니다.</p>}
                {candidates.map((c) => (
                  <div key={c.externalId} style={{ border: "1px solid #eee", borderRadius: 6, padding: 10, fontSize: 13 }}>
                    <div style={{ marginBottom: 4 }}>{c.name}</div>
                    <div style={{ color: "#666", marginBottom: 6 }}>
                      {formatPrice(c.price, c.currency)} · {c.availability ? "재고 있음" : "품절"} · externalId=
                      <span style={{ fontFamily: "monospace" }}>{c.externalId}</span>
                    </div>
                    <div style={{ marginBottom: 6, wordBreak: "break-all" }}>
                      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {c.sourceUrl}
                      </a>
                    </div>
                    <form action="/admin/api/listings" method="POST" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="hidden" name="productVariantId" value={variant.id} />
                      <input type="hidden" name="sourceId" value={sp.source} />
                      <input type="hidden" name="externalId" value={c.externalId} />
                      <input type="hidden" name="externalIdType" value={c.externalIdType} />
                      <input type="hidden" name="sourceUrl" value={c.sourceUrl} />
                      <input type="hidden" name="searchKeywordUsed" value={sp.keyword} />
                      <input type="hidden" name="initialPrice" value={c.price} />
                      <input type="hidden" name="initialCurrency" value={c.currency} />
                      <input type="hidden" name="initialAvailability" value={String(c.availability)} />
                      <input type="hidden" name="redirectTo" value={`/admin/products/${id}`} />
                      <label style={{ fontSize: 12 }}>
                        신뢰도{" "}
                        <select name="confidence" defaultValue="estimated">
                          <option value="estimated">estimated (이름 매칭)</option>
                          <option value="verified">verified (SKU 일치 확인)</option>
                        </select>
                      </label>
                      <button type="submit" style={{ ...smallBtn, background: "#0a8f3c", color: "#fff" }}>
                        이 후보 승인
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </details>
        </section>
      ))}
    </main>
  );
}

const smallBtn = {
  padding: "6px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  background: "#fff",
};
