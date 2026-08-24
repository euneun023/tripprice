import { SearchIcon } from "./Icons";

/** Same GET-form search bar as the Home hero (zero client JS), reused here
 * so /search can re-run a search with an edited query. */
export function SearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form action="/search" method="GET" className="search-bar search-bar--page">
      <SearchIcon color="#9AA3B2" size={17} />
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="상품명, 브랜드, 모델명으로 검색해보세요"
      />
      <button type="submit" className="search-btn">
        <SearchIcon color="#fff" size={15} />
        검색
      </button>
    </form>
  );
}
