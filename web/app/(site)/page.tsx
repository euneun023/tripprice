import Link from "next/link";
import { createSupabaseRepositories } from "@core/repository/supabase/index";
import { listMeaningfulPriceGaps, listRecentlyChecked } from "@core/services/catalogService";
import { CATEGORIES } from "../lib/categories";
import { HeroSignatureCard } from "./components/HeroSignatureCard";
import { ProductCardGrid } from "./components/ProductCardGrid";
import { RecentRowList } from "./components/RecentRowList";
import { CAT_ICON, SearchIcon } from "./components/Icons";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const repos = createSupabaseRepositories();

  const [gaps, recent, sources] = await Promise.all([
    listMeaningfulPriceGaps(repos, 8),
    listRecentlyChecked(repos, 6),
    repos.sources.listAll(),
  ]);

  const sourceRegion = Object.fromEntries(sources.map((s) => [s.id, s.region]));
  const heroEntry = gaps[0];

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1>
              한국에서 살까,
              <br />
              일본에서 살까?
            </h1>
            <p className="lead">여행 전에 가격부터 비교하세요.</p>
            <p className="sub">같은 상품의 한국·일본 가격 차이를 한눈에 확인해보세요.</p>
            <form action="/search" method="GET" className="search-bar">
              <SearchIcon color="#9AA3B2" size={17} />
              <input type="text" name="q" placeholder="상품명, 브랜드, 모델명으로 검색해보세요" />
              <button type="submit" className="search-btn">
                <SearchIcon color="#fff" size={15} />
                검색
              </button>
            </form>
            <div className="hero-foot">한국 · 일본 온라인 판매가를 환율 적용 원화 기준으로 바로 비교해드려요</div>
          </div>

          <div className="hero-stage">
            {heroEntry ? (
              <HeroSignatureCard entry={heroEntry} sourceRegion={sourceRegion} />
            ) : (
              <div style={{ padding: 24, color: "var(--slate-400)", fontSize: 13 }}>
                아직 비교할 상품이 없어요.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="cat-row">
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/categories/${c.slug}`} className="cat-pill">
              {CAT_ICON[c.slug]}
              {c.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <div className="block-head">
            <div>
              <div className="block-title">가격 차이가 큰 상품</div>
              <div className="block-sub">최근 확인 기준으로, 판매처 간 가격 차이가 큰 상품이에요</div>
            </div>
          </div>
          <ProductCardGrid entries={gaps} sourceRegion={sourceRegion} />
        </div>
      </section>

      <section className="block alt">
        <div className="wrap">
          <div className="block-head">
            <div className="block-title">최근 가격을 확인한 상품</div>
          </div>
          <RecentRowList entries={recent} sourceRegion={sourceRegion} />
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="foot-logo">
            <span className="logo-a">얼마</span>
            <span className="logo-b">차이</span>
          </div>
          <div className="foot-desc">한국·일본 온라인 판매가를 비교해 얼마나 차이 나는지 알려드리는 가격비교 서비스입니다.</div>
          <div className="foot-disclaimer">
            표시된 가격은 각 온라인 판매처가 공개한 정보를 기준으로 확인 시점에 산정한 참고용 정보이며, 일본
            가격은 확인 시점의 환율을 적용해 원화로 환산해 보여드립니다. 환율 변동이나 판매처 가격 변경에 따라
            실제 결제 금액과 차이가 있을 수 있습니다. © 얼마차이
          </div>
        </div>
      </footer>
    </>
  );
}
