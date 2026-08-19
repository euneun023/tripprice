import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { searchCatalog } from "@core/services/catalogService";
import { EntryList } from "../components/EntryList";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const repos = createSupabaseRepositories();
  const [entries, sources] = await Promise.all([
    q.trim() ? searchCatalog(repos, q) : Promise.resolve([]),
    repos.sources.listAll(),
  ]);
  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h1 className="display" style={{ fontSize: 20, margin: "0 0 16px" }}>
        {q ? `"${q}" 검색 결과` : "검색어를 입력해주세요"}
      </h1>
      {q.trim() && (
        <EntryList entries={entries} sourceRegion={sourceRegion} emptyText="일치하는 상품이 없습니다. 상품명, 브랜드, 모델명으로 검색해보세요." />
      )}
    </main>
  );
}
