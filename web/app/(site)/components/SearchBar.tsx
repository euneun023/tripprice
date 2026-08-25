"use client";

import type { FormEvent } from "react";
import { SearchIcon } from "./Icons";
import { GA_MEASUREMENT_ID, trackSearchSubmit } from "../../lib/analytics";

/**
 * Same GET-form search bar used by both the Home hero and /search's own bar.
 * "hero" renders Home's markup (no defaultValue, bare "search-bar" class);
 * "page" (default) is /search's own re-search bar.
 *
 * onSubmit holds the native GET navigation for a short beat: firing
 * search_submit and navigating in the same tick reliably loses the event -
 * gtag.js batches outgoing hits instead of sending immediately, and the
 * page unloads before that batch flushes (confirmed empirically with
 * headless Chromium: a custom event took multiple seconds to reach the
 * network on an otherwise-idle page). There's no reliable "the hit was
 * actually sent" signal to wait for from the browser (gtag's own
 * event_callback fires within a few ms regardless of real network delivery,
 * also confirmed empirically) - this is a fixed, best-effort delay, not a
 * guarantee. trackSearchSubmit uses transport_type: "beacon" so a
 * request that IS already in flight survives the unload either way.
 */
export function SearchBar({
  defaultValue = "",
  variant = "page",
}: {
  defaultValue?: string;
  variant?: "hero" | "page";
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // GA not configured -> don't touch the native submit at all, so
    // behavior stays byte-for-byte identical to before this feature existed.
    if (!GA_MEASUREMENT_ID) return;
    e.preventDefault();
    const form = e.currentTarget;
    trackSearchSubmit();
    setTimeout(() => form.submit(), 500);
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
