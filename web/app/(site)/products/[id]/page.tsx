import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { compareVariant, type ComparisonLeg } from "@core/services/comparisonService";
import { convertToKrw } from "@core/domain/pricing";
import type { Source, SourceListing } from "@core/domain/types";
import { REVIEW_REASON_LABELS } from "@core/domain/types";
import { buildConclusion } from "../../lib/conclusion";
import {
  formatPrice,
  formatKrw,
  formatCheckedDate,
  formatCheckedDateTime,
  REGION_LABEL,
  CONFIDENCE_LABEL,
} from "../../../lib/format";

// This page always reads live DB state - never statically cached.
export const dynamic = "force-dynamic";

interface DisplayRow {
  listing: SourceListing;
  source: Source | undefined;
  krwPrice: number;
  leg: ComparisonLeg | undefined; // present only if this listing participated in the ranked comparison
}

export default async function ProductVariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: variantId } = await params;
  const repos = createSupabaseRepositories();

  const variant = await repos.canonicalProducts.getVariant(variantId);
  if (!variant) notFound();

  const [product, listings, sources, comparison] = await Promise.all([
    repos.canonicalProducts.getProduct(variant.canonicalProductId),
    repos.sourceListings.listByVariant(variantId),
    repos.sources.listAll(),
    compareVariant(repos, variantId),
  ]);

  if (!product) notFound();

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const legByListingId = new Map(comparison.legs.map((l) => [l.sourceListingId, l]));

  const rows: DisplayRow[] = await Promise.all(
    listings
      .filter((l) => l.lastKnownPrice !== null)
      .map(async (listing) => {
        const leg = legByListingId.get(listing.id);
        let krwPrice = leg?.krwPrice ?? 0;
        if (!leg) {
          const conv = await convertToKrw(listing.lastKnownPrice!, listing.lastKnownCurrency ?? "KRW");
          krwPrice = conv.krwPrice;
        }
        return { listing, source: sourceById.get(listing.sourceId), krwPrice, leg };
      }),
  );

  rows.sort((a, b) => {
    if (a.leg?.isWinner) return -1;
    if (b.leg?.isWinner) return 1;
    if (!a.leg && b.leg) return 1;
    if (a.leg && !b.leg) return -1;
    return a.krwPrice - b.krwPrice;
  });

  const conclusion = buildConclusion(comparison, (sourceId) => sourceById.get(sourceId)?.region);
  const mostRecentCheck = rows
    .map((r) => r.listing.lastCheckedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  const variantLabel =
    Object.keys(variant.variantAttributes ?? {}).length > 0
      ? Object.entries(variant.variantAttributes)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")
      : variant.displayName;

  const verdictTone = conclusion.tone; // "kr" | "jp" | "intl" | "single" | "no-data" | "close"

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "0 20px 64px" }}>
      {/* 1. identity */}
      <div style={{ paddingTop: 28 }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>{product.category}</p>
        <h1 className="display" style={{ fontSize: "clamp(22px, 5vw, 28px)", margin: "0 0 4px", lineHeight: 1.3 }}>
          {product.brand} {product.officialName}
        </h1>
        {variantLabel && <p style={{ color: "var(--ink-soft)", fontSize: 15, margin: 0 }}>{variantLabel}</p>}
      </div>

      {/* 2+3. verdict + savings - the thing a traveler needs in the first 3 seconds */}
      <section
        style={{
          marginTop: 20,
          padding: "24px 22px",
          borderRadius: 6,
          background: verdictTone === "kr" || verdictTone === "jp" ? "var(--accent-bg)" : "var(--paper-raised)",
          border: "1px solid " + (verdictTone === "kr" || verdictTone === "jp" ? "transparent" : "var(--line)"),
        }}
      >
        <p className="display" style={{ fontSize: 21, margin: "0 0 10px", lineHeight: 1.35 }}>
          {conclusion.headline}
        </p>

        {comparison.mode === "n-way" && (
          <div style={{ display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap", marginBottom: conclusion.savingsLine ? 10 : 0 }}>
            {rows
              .filter((r) => r.leg)
              .slice(0, 2)
              .map((r) => (
                <div key={r.listing.id}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {REGION_LABEL[r.source?.region ?? ""] ?? r.listing.sourceId}
                  </div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>
                    {formatKrw(r.krwPrice)}
                  </div>
                </div>
              ))}
          </div>
        )}

        {conclusion.savingsLine && (
          <p
            className="num"
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              color: verdictTone === "close" ? "var(--muted)" : "var(--accent-ink)",
            }}
          >
            {(verdictTone === "kr" || verdictTone === "jp") && "▼ "}
            {conclusion.savingsLine}
          </p>
        )}

        {mostRecentCheck && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
            {formatCheckedDate(mostRecentCheck)} 기준 · 판매처 {rows.length}곳
          </p>
        )}
      </section>

      {/* 4+5. per-source price / stock, ranked */}
      <section style={{ marginTop: 32 }}>
        <h2 className="eyebrow" style={{ marginBottom: 4 }}>판매처별 가격</h2>
        <div className="ledger">
          {rows.map((row) => {
            const isOutOfStock = row.listing.lastKnownAvailability === false;
            const isWinner = !!row.leg?.isWinner;
            return (
              <div key={row.listing.id} className="ledger-row" data-winner={isWinner} data-muted={isOutOfStock}>
                <div className="ledger-row__main">
                  <div className="ledger-row__eyebrow">
                    {REGION_LABEL[row.source?.region ?? ""] ?? row.listing.sourceId} · {row.source?.name ?? row.listing.sourceId}
                  </div>
                  <div className="ledger-row__title" style={{ whiteSpace: "normal" }}>
                    {isOutOfStock
                      ? "품절 · 비교 제외"
                      : row.listing.reviewRequired
                        ? `검수 필요 · ${REVIEW_REASON_LABELS[row.listing.reviewReason!] ?? row.listing.reviewReason}`
                        : isWinner
                          ? "현재 확인된 판매처 중 최저가"
                          : row.leg
                            ? `+${formatKrw(row.leg.diffFromWinnerKrw)} 더 비쌈`
                            : "재고 있음"}
                  </div>
                  {row.listing.sourceUrl && (
                    <a
                      href={row.listing.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: "var(--accent-ink)", fontWeight: 600 }}
                    >
                      구매처 이동 →
                    </a>
                  )}
                </div>
                <div className="ledger-row__price">
                  <div className="num ledger-row__price-num">{formatPrice(row.listing.lastKnownPrice ?? 0, row.listing.lastKnownCurrency ?? "KRW")}</div>
                  <div className="num" style={{ fontSize: 12, color: "var(--muted)" }}>{formatKrw(row.krwPrice)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 8. secondary meta - present but visually quiet */}
      <section style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
        <h2 className="eyebrow" style={{ marginBottom: 10 }}>상품 정보</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 8, columnGap: 16, fontSize: 13, margin: 0 }}>
          {variant.modelSku && (
            <>
              <dt style={{ color: "var(--muted)" }}>모델번호</dt>
              <dd style={{ margin: 0, fontFamily: "var(--font-number)" }}>{variant.modelSku}</dd>
            </>
          )}
          <dt style={{ color: "var(--muted)" }}>확인 기준</dt>
          <dd style={{ margin: 0 }}>
            쿠폰·회원가·포인트·카드 프로모션은 반영되지 않을 수 있어요. 표시된 가격은 마지막 확인 시각 기준입니다.
          </dd>
          {rows.map((r) => (
            <>
              <dt key={r.listing.id + "-l"} style={{ color: "var(--muted)" }}>
                {REGION_LABEL[r.source?.region ?? ""] ?? r.listing.sourceId}
              </dt>
              <dd key={r.listing.id + "-v"} style={{ margin: 0 }}>
                {CONFIDENCE_LABEL[r.listing.confidence]} · {formatCheckedDateTime(r.listing.lastCheckedAt)}
              </dd>
            </>
          ))}
        </dl>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16 }}>
          이 비교는 실제로 확인된 판매가만으로 계산됩니다. 제휴·광고 여부는 순위에 영향을 주지 않습니다.
        </p>
      </section>
    </main>
  );
}
