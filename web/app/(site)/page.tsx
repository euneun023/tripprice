import Link from "next/link";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listMeaningfulPriceGaps, listRecentlyChecked } from "@core/services/catalogService";
import { CATEGORIES } from "../lib/categories";
import { EntryList } from "./components/EntryList";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const repos = createSupabaseRepositories();

  const [gaps, recent, sources] = await Promise.all([
    listMeaningfulPriceGaps(repos, 6),
    listRecentlyChecked(repos, 6),
    repos.sources.listAll(),
  ]);

  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));

  return (
    <main>
      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "56px 20px 40px" }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>여행 가격비교</p>
          <h1 className="display" style={{ fontSize: "clamp(28px, 6vw, 40px)", lineHeight: 1.25, margin: "0 0 16px" }}>
            한국에서 살까,
            <br />
            일본에서 살까?
          </h1>
          <p style={{ fontSize: 16, color: "var(--ink-soft)", margin: "0 0 28px", maxWidth: 420 }}>
            여행 가기 전, 실제로 확인된 가격으로 비교해보세요. 해외가 항상 싼 건 아니에요 — 확인된 가격만
            보여드립니다.
          </p>
          <form action="/search" method="GET" style={{ display: "flex", maxWidth: 420 }}>
            <input
              type="text"
              name="q"
              placeholder="예: AirPods Pro 3, Garmin Venu 3"
              style={{
                flex: 1,
                padding: "13px 16px",
                border: "1px solid var(--line-strong)",
                borderRight: "none",
                borderRadius: "4px 0 0 4px",
                fontSize: 15,
                background: "#fff",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "0 20px",
                border: "1px solid var(--ink)",
                background: "var(--ink)",
                color: "var(--paper)",
                borderRadius: "0 4px 4px 0",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              검색
            </button>
          </form>
        </div>
      </section>

      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "22px 20px", display: "flex", gap: 22, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${c.slug}`}
              style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", borderBottom: "2px solid var(--line-strong)", paddingBottom: 2 }}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 640, margin: "0 auto", padding: "36px 20px 12px" }}>
        <h2 className="eyebrow" style={{ marginBottom: 4 }}>가격차가 큰 상품</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px" }}>
          같은 상품인데 어디서 사느냐에 따라 차이가 확실한 것들이에요.
        </p>
        <EntryList entries={gaps} sourceRegion={sourceRegion} emptyText="아직 2곳 이상에서 가격이 확인된 상품이 없습니다." />
      </section>

      <section style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 56px" }}>
        <h2 className="eyebrow" style={{ marginBottom: 12 }}>최근 확인된 상품</h2>
        <EntryList entries={recent} sourceRegion={sourceRegion} showTimestamp emptyText="아직 확인된 상품이 없습니다." />
      </section>
    </main>
  );
}
