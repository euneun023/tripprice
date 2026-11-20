import type { ShippingStatus } from "../domain/types";
import { isHttpUrl } from "../domain/url";
import type { CsvRow } from "./csv";

export const FEED_HEADERS = ["advertiser_id", "id", "title", "brand", "gtin", "mpn", "link", "price", "sale_price", "sale_price_effective_date", "availability", "condition", "color", "size", "item_group_id"];
export const REVIEW_HEADERS = ["상품 ID", "GTIN", "모델번호", "한국 피드 적용가(KRW)", "일본 피드 적용가(JPY)", "한국 공식 표시가(KRW)", "일본 공식 표시가(JPY)", "한국 상품 상태", "일본 상품 상태", "한국 피드 상품 링크", "일본 피드 상품 링크", "확인일(KST)", "비교 처리"];
export interface WauAudit {
  id: string; title: string; match: string; evidenceDate: string;
  krFeedPrice: number | null; jpFeedPrice: number | null;
  krObservedPrice: number | null; jpObservedPrice: number | null;
  krPriceDelta: number | null; jpPriceDelta: number | null;
  krAvailability: boolean | null; jpAvailability: boolean | null;
  snapshotVerified: boolean; issues: string[];
  publicationAllowed: false; publicationHolds: string[];
  shippingStatus: ShippingStatus;
}
function requireHeaders(rows: CsvRow[], headers: string[]) {
  if (!rows.length || headers.some(h => !(h in rows[0]))) throw new Error("Missing required CSV columns or empty input");
}
function index(rows: CsvRow[], key: string): Map<string, CsvRow> {
  const out = new Map<string, CsvRow>();
  for (const row of rows) {
    if (!row[key] || out.has(row[key])) throw new Error(`Missing or duplicate key: ${key}`);
    out.set(row[key], row);
  }
  return out;
}
export function validGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const sum = [...value.slice(0, -1)].reverse().reduce((n, c, i) => n + Number(c) * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}
function number(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null;
}
function money(value: string, currency: string): number | null {
  const m = /^(\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(value);
  return m && m[2] === currency ? number(m[1]) : null;
}
function effectivePrice(row: CsvRow, currency: string, issues: string[]): number | null {
  const regular = money(row.price, currency);
  if (regular === null) { issues.push("INVALID_PRICE_OR_CURRENCY"); return null; }
  if (!row.sale_price) return regular;
  const sale = money(row.sale_price, currency);
  if (sale === null || sale > regular) { issues.push("INVALID_SALE_PRICE"); return null; }
  // No trustworthy feed retrieval timestamp: never guess a promotion window.
  if (row.sale_price_effective_date) { issues.push("SALE_WINDOW_REQUIRES_REVIEW"); return null; }
  return sale;
}
function availability(status: string): boolean | null {
  if (status.includes("품절")) return false;
  return status === "구매 버튼 확인" ? true : null;
}
function dateValid(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}
function productUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const u = new URL(value);
  return u.protocol === "https:" && u.hostname === "wauglobal.com" && !u.username && !u.password && !u.port && /^\/(?:ko\/|ja\/)?products\/[^/]+/.test(u.pathname);
}

/** Local evidence reconciliation ONLY. Never creates domain listings or writes to DB. */
export function auditWau(kr: CsvRow[], jp: CsvRow[], review: CsvRow[], asOf: string): WauAudit[] {
  requireHeaders(kr, FEED_HEADERS); requireHeaders(jp, FEED_HEADERS); requireHeaders(review, REVIEW_HEADERS);
  if (!dateValid(asOf)) throw new Error("Invalid audit date");
  const k = index(kr, "id"), j = index(jp, "id"), r = index(review, "상품 ID");
  const ids = [...new Set([...k.keys(), ...j.keys(), ...r.keys()])].sort();
  return ids.map(id => {
    const a = k.get(id), b = j.get(id), e = r.get(id), issues: string[] = [];
    let match = "UNVERIFIED";
    if (!a || !b || !e) issues.push("MISSING_LOCALE_OR_REVIEW");
    if (a && b) {
      const identity = ["advertiser_id", "brand", "gtin", "mpn", "color", "size", "item_group_id", "condition"];
      if (a.advertiser_id !== "124878" || a.brand !== "WAU" || identity.some(f => a[f] !== b[f])) issues.push("IDENTITY_CONFLICT");
      else if (a.gtin && !validGtin(a.gtin)) issues.push("INVALID_GTIN");
      else match = a.gtin ? "GTIN_AND_FEED_ID" : a.mpn ? "BRAND_MPN_AND_FEED_ID" : "FEED_ID_ONLY";
      if (match === "FEED_ID_ONLY") issues.push("IDENTIFIER_REVIEW_REQUIRED");
      if (a.condition !== "new" || b.condition !== "new") issues.push("CONDITION_NOT_NEW");
      if (!productUrl(a.link) || !productUrl(b.link)) issues.push("INVALID_SOURCE_URL");
      else if (!new URL(a.link).pathname.startsWith("/ko/products/") || !new URL(b.link).pathname.startsWith("/ja/products/")) issues.push("LOCALE_LINK_UNCONFIRMED");
    }
    if (a && b && e && (e.GTIN !== a.gtin || e['모델번호'] !== a.mpn || e['한국 피드 상품 링크'] !== a.link || e['일본 피드 상품 링크'] !== b.link)) issues.push("REVIEW_IDENTITY_OR_URL_DRIFT");
    if (e?.['비교 처리'] === "가격 비교 후보에서 제외") issues.push("MANUAL_EXCLUSION");
    const krFeedPrice = a ? effectivePrice(a, "KRW", issues) : null;
    const jpFeedPrice = b ? effectivePrice(b, "JPY", issues) : null;
    const krObservedPrice = e ? number(e['한국 공식 표시가(KRW)']) : null;
    const jpObservedPrice = e ? number(e['일본 공식 표시가(JPY)']) : null;
    if (krObservedPrice === null || jpObservedPrice === null) issues.push("MISSING_OBSERVED_PRICE");
    if (e && (number(e['한국 피드 적용가(KRW)']) !== krFeedPrice || number(e['일본 피드 적용가(JPY)']) !== jpFeedPrice)) issues.push("REVIEW_FEED_PRICE_DRIFT");
    const krAvailability = availability(e?.['한국 상품 상태'] ?? ""), jpAvailability = availability(e?.['일본 상품 상태'] ?? "");
    if (krAvailability === false || jpAvailability === false) issues.push("OUT_OF_STOCK");
    if (krAvailability === null || jpAvailability === null) issues.push("PURCHASE_NOT_VERIFIED");
    if ([e?.['한국 상품 상태'], e?.['일본 상품 상태']].some(s => s?.includes("404"))) issues.push("BROKEN_FEED_LINK");
    if ((krAvailability === false && a?.availability === "in_stock") || (jpAvailability === false && b?.availability === "in_stock")) issues.push("FEED_STOCK_CONTRADICTION");
    if (a && b && (a.availability !== "in_stock" || b.availability !== "in_stock")) issues.push("FEED_NOT_IN_STOCK");
    if (!e || !dateValid(e['확인일(KST)']) || e['확인일(KST)'] > asOf) issues.push("INVALID_EVIDENCE_DATE");
    else if (e['확인일(KST)'] < asOf) issues.push("HISTORICAL_EVIDENCE_RECHECK");
    const krPriceDelta = krObservedPrice !== null && krFeedPrice !== null ? krObservedPrice - krFeedPrice : null;
    const jpPriceDelta = jpObservedPrice !== null && jpFeedPrice !== null ? jpObservedPrice - jpFeedPrice : null;
    // A mismatch invalidates the feed for display, but does not erase a supplied observation.
    const priceMismatch = (krPriceDelta !== null && krPriceDelta !== 0) || (jpPriceDelta !== null && jpPriceDelta !== 0);
    const snapshotVerified = issues.length === 0;
    if (priceMismatch) issues.push("FEED_PRICE_MISMATCH");
    return { id, title: a?.title ?? b?.title ?? "", match, evidenceDate: e?.['확인일(KST)'] ?? "",
      krFeedPrice, jpFeedPrice, krObservedPrice, jpObservedPrice, krPriceDelta, jpPriceDelta,
      krAvailability, jpAvailability, snapshotVerified, issues: [...new Set(issues)],
      publicationAllowed: false, publicationHolds: ["RIGHTS_UNCONFIRMED", "MARKET_COUNTRY_UNCONFIRMED", "FEED_FETCH_TIME_UNKNOWN", "CHECKOUT_TOTAL_UNCONFIRMED"], shippingStatus: "unknown" };
  });
}
