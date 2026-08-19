import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listByCategory } from "@core/services/catalogService";
import { findCategory } from "../../../lib/categories";
import { EntryList } from "../../components/EntryList";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = findCategory(slug);
  if (!category) notFound();

  const repos = createSupabaseRepositories();
  const [entries, sources] = await Promise.all([listByCategory(repos, category.dbCategory), repos.sources.listAll()]);
  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
      <h1 className="display" style={{ fontSize: 22, margin: "0 0 16px" }}>{category.label}</h1>
      <EntryList
        entries={entries}
        sourceRegion={sourceRegion}
        emptyText="이 카테고리에는 아직 등록된 상품이 없습니다. 데이터가 준비되는 대로 채워집니다."
      />
    </main>
  );
}
