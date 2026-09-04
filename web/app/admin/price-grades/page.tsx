import Link from "next/link";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { RISK_FLAG_LABELS } from "@core/domain/riskFlags";
import { listPriceMeritOverview, type PriceMeritRow, type RawPriceGrade } from "../lib/priceGrade";
import { formatKrw, formatPrice, formatCheckedDateTime, formatAsOf, productDisplayName } from "../../lib/format";

export const dynamic = "force-dynamic";

const GRADE_FILTERS = ["ALL", "A", "B", "C", "N/A"] as const;
type GradeFilter = (typeof GRADE_FILTERS)[number];

function matchesFilter(row: PriceMeritRow, filter: GradeFilter): boolean {
  if (filter === "ALL") return true;
  // "A" here means the actionable A's - a stale or risk-blocked A is still
  // rawPriceGrade "A" but won't show under this filter (it still shows
  // under ALL, badge intact) - see the approved spec for why.
  if (filter === "A") return row.rawPriceGrade === "A" && row.actionable;
  return row.rawPriceGrade === filter;
}

export default async function PriceGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string }>;
}) {
  const { grade: gradeParam } = await searchParams;
  const filter = (GRADE_FILTERS as readonly string[]).includes((gradeParam ?? "ALL").toUpperCase())
    ? ((gradeParam ?? "ALL").toUpperCase() as GradeFilter)
    : "ALL";

  const repos = createSupabaseRepositories();
  const allRows = await listPriceMeritOverview(repos);

  const rows = allRows
    .filter((r) => matchesFilter(r, filter))
    .sort((a, b) => (b.gapKrw ?? -Infinity) - (a.gapKrw ?? -Infinity));

  const counts: Record<GradeFilter, number> = {
    ALL: allRows.length,
    A: allRows.filter((r) => r.rawPriceGrade === "A" && r.actionable).length,
    B: allRows.filter((r) => r.rawPriceGrade === "B").length,
    C: allRows.filter((r) => r.rawPriceGrade === "C").length,
    "N/A": allRows.filter((r) => r.rawPriceGrade === "N/A").length,
  };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>가격 메리트 등급 ({allRows.length})</h1>
        <Link href="/admin/products" style={{ fontSize: 14, color: "#555" }}>
          ← 상품 관리로
        </Link>
      </div>

      <p style={{ color: "#888", fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        저장된 최근 KR/JP 판매가만으로 계산하는 read-only 목록입니다. 여기서 등급을 봐도 상품/가격 데이터는 바뀌지
        않습니다. &ldquo;A&rdquo; 필터는 신선하고(fresh) 위험 플래그가 없는(actionable) A만 보여줍니다 — stale이거나
        위험 플래그가 있는 A는 전체 보기에서 등급 옆 배지로 표시됩니다.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {GRADE_FILTERS.map((g) => (
          <Link
            key={g}
            href={g === "ALL" ? "/admin/price-grades" : `/admin/price-grades?grade=${encodeURIComponent(g)}`}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 13,
              textDecoration: "none",
              border: "1px solid #ccc",
              background: filter === g ? "#111" : "#fff",
              color: filter === g ? "#fff" : "#333",
            }}
          >
            {g === "ALL" ? "전체" : g} {counts[g]}
          </Link>
        ))}
      </div>

      {rows.length === 0 && <p style={{ color: "#888" }}>해당 조건의 상품이 없습니다.</p>}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #e2e2e2", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", background: "#fafafa" }}>
                {[
                  "상품",
                  "브랜드",
                  "KR 최저가",
                  "JP 가격",
                  "JP→KRW 환산",
                  "차액",
                  "차이율",
                  "등급",
                  "판정 이유",
                  "위험 경고",
                  "최근 갱신",
                  "적용 환율 · 기준시각",
                ].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.variant.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <Link href={`/admin/products/${row.product.id}`}>
                      {productDisplayName(row.product.brand, row.product.officialName)}
                    </Link>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{row.product.brand}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.krLeg ? formatKrw(row.krLeg.krwPrice) : "-"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.jpLeg ? formatPrice(row.jpLeg.price, row.jpLeg.currency) : "-"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.jpLeg ? formatKrw(row.jpLeg.krwPrice) : "-"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.gapKrw !== null ? formatKrw(row.gapKrw) : "-"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.gapPercent !== null ? `${row.gapPercent.toFixed(1)}%` : "-"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <GradeBadge grade={row.rawPriceGrade} actionable={row.actionable} />
                    {row.freshness === "stale" && <StaleBadge sides={row.staleSides} />}
                  </td>
                  <td style={{ padding: "8px 10px", color: "#666", minWidth: 220 }}>
                    {row.reason}
                    {row.error ? ` (${row.error})` : ""}
                  </td>
                  <td style={{ padding: "8px 10px", minWidth: 140 }}>
                    {row.riskWarnings.length === 0
                      ? "-"
                      : row.riskWarnings.map((f) => <RiskBadge key={f.type} label={RISK_FLAG_LABELS[f.type]} />)}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{formatCheckedDateTime(row.lastUpdatedAt)}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.fxRateUsed !== null ? (
                      <>
                        100엔={(row.fxRateUsed * 100).toFixed(1)}원
                        {row.fxAsOf && <div style={{ color: "#999", fontSize: 11 }}>{formatAsOf(row.fxAsOf)}</div>}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function GradeBadge({ grade, actionable }: { grade: RawPriceGrade; actionable: boolean }) {
  const palette: Record<RawPriceGrade, { bg: string; fg: string }> = {
    A: actionable ? { bg: "#e6f4ea", fg: "#1e7e34" } : { bg: "#f0f0f0", fg: "#888" },
    B: { bg: "#fff8e1", fg: "#a15c00" },
    C: { bg: "#f5f5f5", fg: "#888" },
    "N/A": { bg: "#f0f0f0", fg: "#aaa" },
  };
  const c = palette[grade];
  return (
    <span
      style={{
        display: "inline-block",
        fontWeight: 700,
        fontSize: 13,
        background: c.bg,
        color: c.fg,
        borderRadius: 4,
        padding: "2px 8px",
      }}
    >
      {grade}
    </span>
  );
}

function StaleBadge({ sides }: { sides: Array<"KR" | "JP"> }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        fontSize: 11,
        fontWeight: 600,
        background: "#fdecea",
        color: "#c0392b",
        borderRadius: 4,
        padding: "2px 6px",
      }}
      title={`${sides.join(", ")} 가격이 유효기간(stale_after_hours)을 넘겼습니다`}
    >
      오래된 가격
    </span>
  );
}

function RiskBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginRight: 4,
        marginBottom: 2,
        fontSize: 11,
        fontWeight: 600,
        background: "#fff4e5",
        color: "#a15c00",
        borderRadius: 4,
        padding: "2px 6px",
      }}
    >
      {label}
    </span>
  );
}
