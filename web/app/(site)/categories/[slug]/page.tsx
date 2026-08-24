import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listByCategory } from "@core/services/catalogService";
import { findCategory } from "../../../lib/categories";
import { sortEntries, type SortKey } from "../../lib/sort";
import { ProductCardGrid } from "../../components/ProductCardGrid";

export const dynamic = "force-dynamic";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "diff", label: "가격 차이 큰 순" },
  { key: "recent", label: "최근 가격 확인 순" },
];

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { slug } = await params;
  const category = findCategory(slug);
  if (!category) notFound();

  const { sort: sortParam } = await searchParams;
  const sort: SortKey = sortParam === "recent" ? "recent" : "diff";

  const repos = createSupabaseRepositories();
  const [entries, sources] = await Promise.all([
    listByCategory(repos, category.dbCategory),
    repos.sources.listAll(),
  ]);
  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));
  const sorted = sortEntries(entries, sort);

  return (
    <>
      <section className="wrap browse-head">
        <h1 className="browse-title">{category.label}</h1>
        <p className="browse-sub">
          한국·일본 가격을 비교한 {category.label} {entries.length}개
        </p>
        {entries.length > 0 && (
          <div className="sort-group">
            {SORT_OPTIONS.map((opt) => (
              <Link
                key={opt.key}
                href={opt.key === "diff" ? `/categories/${slug}` : `/categories/${slug}?sort=${opt.key}`}
                className={`sort-pill${sort === opt.key ? " active" : ""}`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="wrap browse-body">
        <ProductCardGrid
          entries={sorted}
          sourceRegion={sourceRegion}
          variant="grid"
          emptyText="이 카테고리에는 아직 등록된 상품이 없어요. 데이터가 준비되는 대로 채워집니다."
        />
      </section>
    </>
  );
}
