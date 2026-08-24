import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { searchCatalog } from "@core/services/catalogService";
import { ProductCardGrid } from "../components/ProductCardGrid";
import { SearchBar } from "../components/SearchBar";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const repos = createSupabaseRepositories();
  const [entries, sources] = await Promise.all([
    query ? searchCatalog(repos, query) : Promise.resolve([]),
    repos.sources.listAll(),
  ]);
  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));

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
            sourceRegion={sourceRegion}
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
