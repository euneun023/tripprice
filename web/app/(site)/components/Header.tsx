import Link from "next/link";
import { CATEGORIES } from "../../lib/categories";
import { SearchIcon } from "./Icons";

/** Server Component - search is a plain GET form, zero client JS. */
export function Header() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="logo">
          <span className="logo-a">얼마</span>
          <span className="logo-b">차이</span>
        </Link>
        <div className="nav-links">
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/categories/${c.slug}`}>
              {c.label}
            </Link>
          ))}
        </div>
        <Link href="/search" className="nav-search-btn" aria-label="검색">
          <SearchIcon />
        </Link>
      </div>
    </nav>
  );
}
