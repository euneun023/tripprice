import type { Metadata } from "next";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { searchCatalog } from "@core/services/catalogService";
import { buildMetadata } from "../../lib/seo";
import { ProductCardGrid } from "../components/ProductCardGrid";
import { SearchBar } from "../components/SearchBar";

export const dynamic = "force-dynamic";

// Query-driven results pages are noindex,follow: the q= combinations are
// unbounded (so indexing them is pure duplicate/thin-content risk) but the
// page still links to real product pages, so crawlers should keep following
// those links rather than being blocked from the page entirely.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q = "" } = await searchParams;
  const query = q.trim();

  return buildMetadata({
    title: query ? `"${query}" 검색 결과 | 얼마차이` : "상품 검색 | 얼마차이",
    description: "얼마차이에서 한국과 일본의 상품 가격을 검색하고 비교하세요.",
    path: "/search",
    noindex: true,
  });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const repos = createSupabaseRepositories();
  const entries = query ? await searchCatalog(repos, query) : [];

  return (
    <>
      <section className="wrap browse-head">
        <SearchBar defaultValue={query} />
        {query && (
          <>
            <h1 className="browse-title" style={{ marginTop: 22 }}>
              &ldquo;{query}&rdquo; 검색 결과
            </h1>
            <p className="browse-sub">{entries.length}개의 상품을 찾았어요</p>
          </>
        )}
      </section>

      <section className="wrap browse-body">
        {query ? (
          <ProductCardGrid
            entries={entries}
            variant="grid"
            emptyText="검색 결과가 없어요"
            emptyHint="상품명, 브랜드 또는 모델명을 다시 확인해보세요."
          />
        ) : (
          <p style={{ color: "var(--slate-400)", fontSize: 13.5, padding: "24px 0" }}>
            상품명, 브랜드, 모델명으로 검색해보세요.
          </p>
        )}
      </section>
    </>
  );
}
