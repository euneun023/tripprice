import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listByCategory } from "@core/services/catalogService";
import { findCategory } from "../../../lib/categories";
import { buildMetadata } from "../../../lib/seo";
import { sortEntries, type SortKey } from "../../lib/sort";
import { ProductCardGrid } from "../../components/ProductCardGrid";

export const dynamic = "force-dynamic";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "diff", label: "가격 차이 큰 순" },
  { key: "recent", label: "최근 가격 확인 순" },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = findCategory(slug);
  if (!category) return {};

  return buildMetadata({
    title: `${category.label} 한국·일본 가격 비교 | 얼마차이`,
    description: `${category.label} 카테고리에서 한국과 일본의 동일 상품 가격을 원화 기준으로 비교하세요.`,
    path: `/categories/${category.slug}`,
  });
}

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
  const entries = await listByCategory(repos, category.dbCategory);
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
          variant="grid"
          emptyText="이 카테고리에는 아직 등록된 상품이 없어요. 데이터가 준비되는 대로 채워집니다."
        />
      </section>
    </>
  );
}
