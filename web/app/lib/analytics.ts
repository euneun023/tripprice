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
 * The search form does a native GET navigation right after this fires, with
 * no delay - search UX takes priority over analytics delivery here.
 * `transport_type: "beacon"` is used so a request already queued by the
 * browser survives the unload, but some loss is accepted since this isn't a
 * core KPI.
 */
export function trackSearchSubmit() {
  track("search_submit", { transport_type: "beacon" });
}
