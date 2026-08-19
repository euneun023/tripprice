import Link from "next/link";
import { CATEGORIES } from "../../lib/categories";

/** Server Component - search is a plain GET form, zero client JS. */
export function Header() {
  return (
    <header style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-raised)" }}>
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "16px 20px",
          display: "flex",
          gap: 24,
          alignItems: "center",
        }}
      >
        <Link
          href="/"
          className="display"
          style={{ fontSize: 18, color: "var(--ink)", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          한국일까 일본일까
        </Link>

        <nav style={{ display: "flex", gap: 18, fontSize: 14 }}>
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/categories/${c.slug}`} style={{ color: "var(--ink-soft)" }}>
              {c.label}
            </Link>
          ))}
        </nav>

        <form action="/search" method="GET" style={{ marginLeft: "auto", minWidth: 0 }}>
          <input
            type="text"
            name="q"
            placeholder="상품명, 브랜드, 모델명 검색"
            style={{
              padding: "8px 12px",
              border: "1px solid var(--line-strong)",
              borderRadius: 4,
              fontSize: 14,
              width: "min(240px, 40vw)",
              background: "#fff",
              color: "var(--ink)",
            }}
          />
        </form>
      </div>
    </header>
  );
}
