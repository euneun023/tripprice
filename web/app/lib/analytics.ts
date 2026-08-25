import { sendGAEvent } from "@next/third-parties/google";

/**
 * Single source of truth for "is GA configured" - deliberately NOT behind
 * "use client" so the server-rendered (site) layout can import this same
 * constant (as a plain value, not a client reference) to decide whether to
 * render <GoogleAnalytics> at all. Unset -> the script never loads and
 * every track* below is a no-op (no console warnings from the underlying
 * @next/third-parties helper either, since we never call it).
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function track(name: string, params?: object) {
  if (!GA_MEASUREMENT_ID) return;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) clean[key] = value;
  }
  sendGAEvent("event", name, clean);
}

/** Shared shape for the two "this is a specific product" events - deliberately
 * just enough to segment by product/category/comparison outcome, never the
 * price, FX rate, or full product name (see task's "과도하게 보내지 마세요"). */
interface ProductEventParams {
  product_id: string;
  variant_id: string;
  category: string;
  comparison_mode: string;
  winner_market?: string;
}

/** Home/Category/Search product card clicked. */
export function trackSelectItem(params: ProductEventParams) {
  track("select_item", params);
}

/** Product Detail page entered. */
export function trackViewItem(params: ProductEventParams) {
  track("view_item", params);
}

/** Seller "바로가기" clicked - the main business KPI. */
export function trackSellerClick(params: {
  product_id: string;
  variant_id: string;
  category: string;
  source: string;
  market: string;
}) {
  track("seller_click", params);
}

/**
 * Search executed. No query text is sent - see task's PII guidance.
 *
 * The search form does a native GET navigation right after this fires.
 * gtag.js batches outgoing hits instead of sending each one immediately, so
 * firing this and navigating in the same tick loses the event - confirmed
 * empirically with headless Chromium: an idle page with nothing else
 * happening still took several seconds for gtag to flush a custom event to
 * the network, versus milliseconds for the automatic page_view. `gtag`'s
 * own `event_callback` does NOT signal real dispatch (it fires in ~3ms
 * regardless of whether the hit ever reaches the network, also confirmed
 * empirically), so it's not used here - only `transport_type: "beacon"`,
 * which is the one thing that's actually guaranteed to survive a page
 * unload if the browser has already queued the request. SearchBar.tsx pairs
 * this with a short fixed delay before navigating for real; see the comment
 * there for why full delivery still isn't 100% guaranteed.
 */
export function trackSearchSubmit() {
  track("search_submit", { transport_type: "beacon" });
}
