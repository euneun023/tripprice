"use client";

import { SearchIcon } from "./Icons";
import { GA_MEASUREMENT_ID, trackSearchSubmit } from "../../lib/analytics";

/**
 * Same GET-form search bar used by both the Home hero and /search's own bar.
 * "hero" renders Home's markup (no defaultValue, bare "search-bar" class);
 * "page" (default) is /search's own re-search bar.
 *
 * Search UX takes priority over analytics: the native GET navigation is
 * never held up for search_submit. trackSearchSubmit uses
 * transport_type: "beacon" so a request already queued survives the
 * unload, but some loss is accepted since this isn't a core KPI.
 */
export function SearchBar({
  defaultValue = "",
  variant = "page",
}: {
  defaultValue?: string;
  variant?: "hero" | "page";
}) {
  function handleSubmit() {
    if (!GA_MEASUREMENT_ID) return;
    trackSearchSubmit();
  }

  return (
    <form
      action="/search"
      method="GET"
      className={variant === "page" ? "search-bar search-bar--page" : "search-bar"}
      onSubmit={handleSubmit}
    >
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
