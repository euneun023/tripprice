/**
 * 다이빙 PoC 가격 갱신 스크립트 - 6개 판매 페이지(#13/#18/#19 x KR/JP)의
 * 지정 옵션 가격을 읽어 링크별 상태 파일에 기록한다. 기준: f84066c,
 * URL·옵션은 2026-11-16 실제 브라우저 확인 기록 (diving-price-targets.json).
 *
 * 구조 (테스트 가능한 순수 로직과 네트워크 부분을 분리):
 *   - readers (사이트 유형별, Playwright):
 *       wix_listed     13-KR  옵션 선택기 없는 기본형 전용 페이지의 공개 단가.
 *                            색상·재고는 페이지에서 확인한 것으로 기록하지 않는다.
 *                            선택기가 생기면 실패(unexpected_option_selector).
 *       cafe24_total   18/19-KR  지정 옵션을 순서대로 선택한 뒤 1개의
 *                            '총 상품금액'만 읽는다. 옵션 행의 정가는 쓰지 않는다.
 *       rakuten_button 13/18/19-JP  옵션 버튼 클릭 후 "선택됨" 표시를 확인하고
 *                            그 뒤의 표시 가격을 읽는다. 선택 확인 실패 시
 *                            페이지 대표가를 옵션 가격으로 저장하지 않는다.
 *                            itemCode(예: 417225)가 있으면 페이지에서 먼저 확인.
 *   - applyReading(): PageReading + 이전 상태 -> 새 상태 + 이벤트 (순수 함수)
 *       * 성공: 가격·통화·확인된 옵션·성공 시각 기록, 가격 변경 감지
 *       * 실패: lastSuccess(마지막 성공 가격·시각) 보존, lastFailure에 시각·이유
 *       * 통화/옵션/수량/가격 기준/품번 불일치, 옵션 선택 미확인은 실패 처리
 *
 * 저장 위치 (기존 결과 JSON·검수 이력과 분리, gitignore 대상):
 *   local-results/diving-price-refresh/state.json          링크별 최신 상태
 *   local-results/diving-price-refresh/runs/<시각>.json     실행별 기록
 *   local-results/diving-price-refresh/debug/<시각>/<id>.*  실패 페이지 스냅샷
 *
 * 사용:
 *   npx tsx src/scripts/refresh-diving-prices.ts run [--targets=<json>] [--state=<json>] [--only=13-KR,19-JP] [--headed]
 *   npx tsx src/scripts/refresh-diving-prices.ts show [--state=<json>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// ---------------------------------------------------------------- types

export type Market = "KR" | "JP";
export type Currency = "KRW" | "JPY";
export type PriceBasis = "listed_price" | "total_product_amount";
export type ReaderKind = "wix_listed" | "cafe24_total" | "rakuten_button";

export interface OptionAxisSpec {
  axis: string;
  /** 선택지/버튼 텍스트에서 찾을 토큰 (토큰 경계 매칭). */
  accept: string[];
  /** true면 해당 선택지가 페이지에 없을 때 상품명에 토큰이 있는지로 대신 확인. */
  ifPresent?: boolean;
}

export interface OptionSpec {
  label: string;
  /** select: 축마다 선택하고 선택 표시를 확인. no_selector_page: 옵션 선택기
   * 없는 단일 상품 페이지 - 옵션 값은 확인하지 않은 것으로 기록. */
  mode: "select" | "no_selector_page";
  axes: OptionAxisSpec[];
  /** 관측 텍스트에 있으면 다른 변형(예: Peregrine TX)으로 보고 불일치. */
  reject: string[];
  /** 상품명/페이지에 있어야 하는 토큰 (예: Peregrine). */
  titleMustInclude?: string[];
  /** 페이지에서 확인해야 하는 상품 품번 (예: 417225). */
  itemCode?: string;
}

export interface PriceTarget {
  id: string;
  n: number;
  market: Market;
  title: string;
  url: string | null;
  currency: Currency;
  priceBasis: PriceBasis;
  reader: ReaderKind;
  option: OptionSpec;
  /** false면 재고 문구를 읽지 않고 "확인 안 함"으로 기록. */
  stockCheck: boolean;
}

export type FailureReason =
  | "url_missing"
  | "fetch_failed"
  | "http_status"
  | "browser_unavailable"
  | "option_control_not_found"
  | "option_value_not_found"
  | "option_not_confirmed"
  | "unexpected_option_selector"
  | "item_code_mismatch"
  | "price_not_found"
  | "price_invalid"
  | "currency_mismatch"
  | "option_mismatch"
  | "quantity_mismatch"
  | "price_basis_mismatch";

export type OptionConfirmation = "selected_and_displayed" | "no_selector_page";

export interface SuccessfulReading {
  ok: true;
  price: number;
  currency: Currency;
  basis: PriceBasis;
  optionConfirmation: OptionConfirmation;
  /** 페이지에서 선택이 확인된 옵션 텍스트 (no_selector_page면 빈 배열). */
  selectedOptions: string[];
  /** 상품명(title/h1) - titleMustInclude/reject 검사용. */
  productTitle: string;
  /** 페이지에서 확인된 품번 (itemCode 대상만). */
  itemCodeFound?: string;
  /** 페이지에 있던 재고/납기 문구 (원문 그대로). null=문구 없음. */
  stockNote: string | null;
  stockChecked: boolean;
  quantity: number;
  source: string;
}

export type PageReading = SuccessfulReading | { ok: false; reason: FailureReason; detail: string };

export interface SuccessRecord {
  price: number;
  currency: Currency;
  at: string;
  optionConfirmation: OptionConfirmation;
  selectedOptions: string[];
  productTitle: string;
  itemCodeFound?: string;
  /** "확인 안 함" | "문구 없음" | 원문 */
  stockNote: string;
  source: string;
}

export interface FailureRecord {
  at: string;
  reason: FailureReason;
  detail: string;
}

export interface LinkState {
  id: string;
  n: number;
  market: Market;
  url: string | null;
  optionLabel: string;
  currency: Currency;
  priceBasis: PriceBasis;
  lastSuccess: SuccessRecord | null;
  lastFailure: FailureRecord | null;
  lastAttemptAt: string | null;
  lastAttemptOk: boolean | null;
  /** 성공 읽기에서 가격이 바뀐 이력 (최근 20건). */
  priceChanges: { at: string; from: number; to: number }[];
}

export type RefreshEvent =
  | { id: string; type: "first_success"; price: number; currency: Currency; stockNote: string }
  | { id: string; type: "unchanged"; price: number; currency: Currency; stockNote: string }
  | { id: string; type: "price_changed"; from: number; to: number; currency: Currency; stockNote: string }
  | { id: string; type: "failed"; reason: FailureReason; detail: string; preservedPrice: number | null; preservedAt: string | null };

// ---------------------------------------------------------- option check

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 토큰 경계 매칭: "S"가 "SLS"/"GPS" 안에서 잡히지 않도록 앞뒤가 라틴
 * 문자·숫자가 아닐 때만 일치 ("사이즈S", "S사이즈", "(S)" 는 일치). */
export function containsToken(text: string, token: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(token)}(?![A-Za-z0-9])`, "i").test(text);
}

/** 옵션 검증. select 모드는 "선택이 확인된 옵션 텍스트"만 근거로 쓴다
 * (상품명에 우연히 들어간 토큰으로 옵션을 확인하지 않는다 - ifPresent 축 예외). */
export function checkOption(spec: OptionSpec, r: Pick<SuccessfulReading, "selectedOptions" | "productTitle" | "optionConfirmation">): { ok: true } | { ok: false; detail: string } {
  const all = [...r.selectedOptions, r.productTitle].join(" | ");
  const rejected = spec.reject.filter((x) => containsToken(all, x));
  if (rejected.length) return { ok: false, detail: `다른 변형 표기 발견(${rejected.join(", ")}) - 지정 옵션 "${spec.label}"` };
  const missingTitle = (spec.titleMustInclude ?? []).filter((x) => !containsToken(r.productTitle, x));
  if (missingTitle.length) return { ok: false, detail: `상품명에 ${missingTitle.join(", ")} 없음: "${r.productTitle}"` };
  if (spec.mode === "no_selector_page") {
    return r.optionConfirmation === "no_selector_page" ? { ok: true } : { ok: false, detail: "옵션 선택기 없는 페이지로 기대했으나 다른 방식으로 읽힘" };
  }
  const selected = r.selectedOptions.join(" | ");
  const missing = spec.axes.filter(
    (a) => !a.accept.some((tok) => containsToken(selected, tok)) && !(a.ifPresent && a.accept.some((tok) => containsToken(r.productTitle, tok))),
  );
  if (missing.length) {
    return { ok: false, detail: `지정 옵션 "${spec.label}"의 ${missing.map((m) => m.axis).join(", ")} 값이 선택된 옵션(${selected || "없음"})에 없음` };
  }
  return { ok: true };
}

// ----------------------------------------------------------- core logic

export function initialState(t: PriceTarget): LinkState {
  return {
    id: t.id,
    n: t.n,
    market: t.market,
    url: t.url,
    optionLabel: t.option.label,
    currency: t.currency,
    priceBasis: t.priceBasis,
    lastSuccess: null,
    lastFailure: null,
    lastAttemptAt: null,
    lastAttemptOk: null,
    priceChanges: [],
  };
}

/** 리딩을 검증해 실패 사유로 바꾼다 (성공 리딩이라도 기준에 안 맞으면 실패). */
export function validateReading(t: PriceTarget, r: PageReading): PageReading {
  if (!r.ok) return r;
  if (!Number.isSafeInteger(r.price) || r.price <= 0) return { ok: false, reason: "price_invalid", detail: `읽은 가격 ${r.price}이(가) 양의 정수가 아님` };
  if (r.currency !== t.currency) return { ok: false, reason: "currency_mismatch", detail: `기대 ${t.currency}, 관측 ${r.currency}` };
  if (r.basis !== t.priceBasis) return { ok: false, reason: "price_basis_mismatch", detail: `기대 ${t.priceBasis}, 관측 ${r.basis} (${r.source})` };
  if (r.quantity !== 1) return { ok: false, reason: "quantity_mismatch", detail: `수량 ${r.quantity} - 지정 옵션 1개 기준이어야 함` };
  if (t.option.itemCode && r.itemCodeFound?.toUpperCase() !== t.option.itemCode.toUpperCase()) {
    return { ok: false, reason: "item_code_mismatch", detail: `품번 ${t.option.itemCode} 미확인 (관측: ${r.itemCodeFound ?? "없음"})` };
  }
  if (t.option.mode === "select" && r.optionConfirmation !== "selected_and_displayed") {
    return { ok: false, reason: "option_not_confirmed", detail: "옵션 선택 표시가 확인되지 않아 대표가를 옵션 가격으로 쓰지 않음" };
  }
  const opt = checkOption(t.option, r);
  if (!opt.ok) return { ok: false, reason: "option_mismatch", detail: opt.detail };
  return r;
}

function stockNoteOf(r: SuccessfulReading): string {
  if (!r.stockChecked) return "확인 안 함";
  return r.stockNote ?? "문구 없음";
}

export function applyReading(t: PriceTarget, prev: LinkState | undefined, raw: PageReading, now: Date): { state: LinkState; event: RefreshEvent } {
  const at = now.toISOString();
  const base: LinkState = {
    ...(prev ?? initialState(t)),
    url: t.url,
    optionLabel: t.option.label,
    currency: t.currency,
    priceBasis: t.priceBasis,
    lastAttemptAt: at,
  };
  const r = validateReading(t, raw);

  if (!r.ok) {
    const state: LinkState = { ...base, lastAttemptOk: false, lastFailure: { at, reason: r.reason, detail: r.detail } };
    return {
      state,
      event: { id: t.id, type: "failed", reason: r.reason, detail: r.detail, preservedPrice: state.lastSuccess?.price ?? null, preservedAt: state.lastSuccess?.at ?? null },
    };
  }

  const stockNote = stockNoteOf(r);
  const success: SuccessRecord = {
    price: r.price,
    currency: r.currency,
    at,
    optionConfirmation: r.optionConfirmation,
    selectedOptions: r.selectedOptions,
    productTitle: r.productTitle,
    itemCodeFound: r.itemCodeFound,
    stockNote,
    source: r.source,
  };
  const before = base.lastSuccess;
  const priceChanges = before && before.price !== r.price ? [...base.priceChanges, { at, from: before.price, to: r.price }].slice(-20) : base.priceChanges;
  const state: LinkState = { ...base, lastAttemptOk: true, lastSuccess: success, priceChanges };
  const event: RefreshEvent = !before
    ? { id: t.id, type: "first_success", price: r.price, currency: r.currency, stockNote }
    : before.price !== r.price
      ? { id: t.id, type: "price_changed", from: before.price, to: r.price, currency: r.currency, stockNote }
      : { id: t.id, type: "unchanged", price: r.price, currency: r.currency, stockNote };
  return { state, event };
}

// ------------------------------------------------- HTML/text extraction

/** "1,234,000원" / "￥98,000" / "98,000円" -> 정수. 실패 시 undefined. */
export function parseMoney(s: string): number | undefined {
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** 정적 HTML에서 상품 표시가격: JSON-LD offers.price -> itemprop=price ->
 * product:price:amount 메타 순. */
export function extractListedPrice(html: string): { price: number; currency?: string; source: string } | undefined {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findOffer(JSON.parse(m[1]));
      if (found) return { ...found, source: "json-ld" };
    } catch {
      /* 깨진 JSON-LD는 무시 */
    }
  }
  const itemprop = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  const itemCur = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i);
  if (itemprop) {
    const p = parseMoney(itemprop[1].split(".")[0]);
    if (p) return { price: p, currency: itemCur?.[1], source: "itemprop" };
  }
  const meta = html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i);
  const metaCur = html.match(/property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i);
  if (meta) {
    const p = parseMoney(meta[1].split(".")[0]);
    if (p) return { price: p, currency: metaCur?.[1], source: "meta" };
  }
  return undefined;
}

function findOffer(node: unknown): { price: number; currency?: string } | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = findOffer(x);
      if (f) return f;
    }
    return undefined;
  }
  const o = node as Record<string, unknown>;
  if (o.price != null && (o["@type"] === "Offer" || o.priceCurrency != null)) {
    const p = parseMoney(String(o.price).split(".")[0]);
    if (p) return { price: p, currency: typeof o.priceCurrency === "string" ? o.priceCurrency : undefined };
  }
  for (const k of ["offers", "@graph", "mainEntity"]) {
    const f = findOffer(o[k]);
    if (f) return f;
  }
  return undefined;
}

const TOTAL_LABELS = ["총 상품금액", "총상품금액", "총 상품 금액", "TOTAL"];

/** '총 상품금액' 영역 텍스트에서 금액과 수량을 읽는다. Cafe24 형식
 * "총 상품금액(수량) : 1,250,000원 (1개)" / "TOTAL : 1,250,000 (1개)".
 * 금액이 0(옵션 미선택)이거나 라벨이 없으면 undefined. */
export function extractTotalProductAmount(text: string): { price: number; quantity?: number } | undefined {
  for (const label of TOTAL_LABELS) {
    const idx = text.indexOf(label);
    if (idx < 0) continue;
    const after = text.slice(idx + label.length, idx + label.length + 120);
    const m = after.match(/([\d,]+)\s*원/) ?? after.match(/[:：]\s*([\d,]+)\s*\(\s*\d+\s*개\s*\)/);
    if (!m) continue;
    const price = parseMoney(m[1]);
    if (!price) return undefined;
    const q = after.match(/\(\s*(\d+)\s*개\s*\)/);
    return { price, quantity: q ? Number(q[1]) : undefined };
  }
  return undefined;
}

/** 재고/납기 확인이 필요하다는 문구 (원문 그대로 기록용). */
const STOCK_NOTE_PATTERNS = [/재고\s*확인\s*필요[^\n]{0,40}/, /在庫確認[^\n]{0,40}/, /在庫を確認[^\n]{0,40}/, /お取り寄せ[^\n]{0,40}/, /取り寄せ[^\n]{0,40}/, /要確認[^\n]{0,40}/];

export function findStockNote(text: string): string | null {
  const notes: string[] = [];
  for (const re of STOCK_NOTE_PATTERNS) {
    const m = text.match(re);
    if (m && !notes.some((n) => n.includes(m[0].trim()) || m[0].includes(n))) notes.push(m[0].trim());
  }
  return notes.length ? notes.join(" / ") : null;
}

/** 품번을 토큰 경계로 찾는다 (417225가 1417225 안에서 잡히지 않게). */
export function findItemCode(text: string, code: string): string | undefined {
  const m = text.match(new RegExp(`(?<![A-Za-z0-9])${escapeRe(code)}(?![A-Za-z0-9])`, "i"));
  return m ? m[0] : undefined;
}

// -------------------------------------------------------- browser readers

/* 페이지 안에서 실행되는 코드는 문자열로 넘긴다 - tsx 변환이 넣는 헬퍼
 * (__name 등)가 브라우저 쪽에 없어 함수 객체를 넘기면 깨진다. */

/** 토큰과 텍스트가 정확히 같은(앞뒤 공백·"品切れ" 등 제외) 클릭 가능한 옵션
 * 버튼을 찾아 data-dpr-pick 속성을 붙인다. 가장 안쪽 요소를 고른다. */
const MARK_BUTTON_IN_PAGE = String.raw`function (args) {
  var accept = args.accept, mark = args.mark;
  var norm = function (s) { return (s || "").replace(/\s+/g, " ").trim(); };
  var clickableSel = "button,[role=button],[role=radio],[role=option],label,li,a,span,div,input[type=radio]";
  var nodes = Array.prototype.slice.call(document.querySelectorAll(clickableSel));
  var visible = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (var k = 0; k < accept.length; k++) {
    var tok = accept[k].toLowerCase();
    var hits = nodes.filter(function (el) {
      var t = norm(el.tagName === "INPUT" ? el.value : el.innerText).toLowerCase();
      return t === tok && visible(el);
    });
    hits = hits.filter(function (el) { return !hits.some(function (o) { return o !== el && el.contains(o); }); });
    var enabled = hits.filter(function (el) {
      var b = el.closest("button,[role=button],[role=radio],[role=option],label,li");
      return !(b && (b.disabled || b.getAttribute("aria-disabled") === "true"));
    });
    if (enabled.length) { enabled[0].setAttribute("data-dpr-pick", mark); return { text: norm(enabled[0].innerText || enabled[0].value), count: enabled.length }; }
  }
  return null;
}`;

/** 클릭한 버튼이 "선택됨"으로 표시됐는지 확인: aria-pressed/checked/selected,
 * 체크된 radio, 또는 selected/active/checked/current 계열 클래스. */
const IS_MARK_SELECTED_IN_PAGE = String.raw`function (mark) {
  var el = document.querySelector("[data-dpr-pick='" + mark + "']");
  if (!el) return { selected: false, how: "element gone" };
  for (var n = el, d = 0; n && d < 4; n = n.parentElement, d++) {
    var a = n.getAttribute && (n.getAttribute("aria-pressed") || n.getAttribute("aria-checked") || n.getAttribute("aria-selected"));
    if (a === "true") return { selected: true, how: "aria on <" + n.tagName.toLowerCase() + ">" };
    var radio = n.tagName === "INPUT" ? n : n.querySelector && n.querySelector("input[type=radio],input[type=checkbox]");
    if (radio && radio.checked) return { selected: true, how: "checked input" };
    if (n.tagName === "LABEL" && n.htmlFor) { var i = document.getElementById(n.htmlFor); if (i && i.checked) return { selected: true, how: "checked input (label for)" }; }
    var cls = typeof n.className === "string" ? n.className : "";
    if (/(^|[\s_-])(is-?)?(selected|active|checked|current)([\s_-]|$)/i.test(cls)) return { selected: true, how: "class '" + cls + "'" };
  }
  return { selected: false, how: "no selected marker" };
}`;

/** 가격 표시 요소들 중 가장 큰 글자의 "N円" 값 (포인트·送料·クーポン 문구 제외). */
const READ_DISPLAYED_JPY_IN_PAGE = String.raw`function () {
  var best = null;
  var nodes = Array.prototype.slice.call(document.querySelectorAll("[class*=price],[class*=Price],[id*=price],[id*=Price]"));
  nodes.forEach(function (el) {
    var r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return;
    var t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 60 || /ポイント|送料|クーポン|相当|還元|獲得|pt/i.test(t)) return;
    var m = t.match(/([\d,]+)\s*円/); if (!m) return;
    var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (!best || fs > best.fs) best = { fs: fs, text: m[1] };
  });
  return best ? best.text : null;
}`;

type Page = any;
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

export async function launchBrowser(opts: { headed?: boolean } = {}): Promise<Browser | undefined> {
  try {
    const require = createRequire(import.meta.url);
    const pw = require("playwright");
    // 클라우드 세션처럼 HTTPS_PROXY가 있으면 브라우저도 같은 프록시를 쓴다. 로컬 PC에선 보통 없음.
    const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
    return await pw.chromium.launch({ headless: !opts.headed, ...(proxyServer ? { proxy: { server: proxyServer } } : {}) });
  } catch {
    return undefined;
  }
}

async function openPage(browser: Browser, url: string): Promise<{ page: Page } | { fail: PageReading }> {
  const page = await browser.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    const status: number | undefined = res?.status();
    if (status !== undefined && status >= 400) {
      await page.close().catch(() => undefined);
      return { fail: { ok: false, reason: "http_status", detail: `HTTP ${status}` } };
    }
    return { page };
  } catch (err) {
    await page.close().catch(() => undefined);
    return { fail: { ok: false, reason: "fetch_failed", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) } };
  }
}

async function productTitleOf(page: Page): Promise<string> {
  const h1 = await page.locator("h1").first().innerText({ timeout: 3000 }).catch(() => "");
  const title = await page.title().catch(() => "");
  return [h1, title].filter(Boolean).join(" | ").replace(/\s+/g, " ").trim();
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText : ''");
}

/** 13-KR: 옵션 선택기 없는 Wix 상품 페이지의 공개 단가. */
async function readWixListed(page: Page, t: PriceTarget): Promise<PageReading> {
  const selectorCount: number = await page.evaluate(
    `document.querySelectorAll("select,[data-hook*='dropdown'],[data-hook*='options'],[data-hook*='color-picker'],[data-hook*='product-colors']").length`,
  );
  if (selectorCount > 0) return { ok: false, reason: "unexpected_option_selector", detail: `옵션 선택기 ${selectorCount}개 발견 - 기본형 전용 페이지 가정이 깨짐` };
  const displayed: string | null = await page
    .locator("[data-hook='formatted-primary-price']")
    .first()
    .innerText({ timeout: 3000 })
    .catch(() => null);
  let price = displayed ? parseMoney(displayed) : undefined;
  let source = "wix formatted-primary-price";
  let currency: string | undefined = displayed && /₩|원|KRW/.test(displayed) ? "KRW" : undefined;
  if (!price) {
    const listed = extractListedPrice(await page.content());
    if (!listed) return { ok: false, reason: "price_not_found", detail: "공개 단가(formatted-primary-price/JSON-LD) 없음" };
    price = listed.price;
    currency = listed.currency;
    source = listed.source;
  }
  return {
    ok: true,
    price,
    currency: (currency ?? "KRW") as Currency,
    basis: "listed_price",
    optionConfirmation: "no_selector_page",
    selectedOptions: [],
    productTitle: await productTitleOf(page),
    stockNote: null,
    stockChecked: false, // 지시: 색상·재고를 페이지에서 확인한 것으로 기록하지 않음
    quantity: 1,
    source,
  };
}

/** 18/19-KR: Cafe24 옵션을 축 순서대로 선택 -> '총 상품금액'(수량 1)만 읽는다. */
async function readCafe24Total(page: Page, t: PriceTarget): Promise<PageReading> {
  const selectedOptions: string[] = [];
  for (const axis of t.option.axes) {
    // 1) <select id="product_option_id*"> (없으면 아무 select)
    const pick: { selectId: string | null; index: number; value: string; text: string } | null = await page.evaluate(
      `(${String.raw`function (accept) {
        var esc = function (t) { return t.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"); };
        var sels = Array.prototype.slice.call(document.querySelectorAll("select[id^=product_option_id]"));
        if (!sels.length) sels = Array.prototype.slice.call(document.querySelectorAll("select"));
        for (var i = 0; i < sels.length; i++) {
          var opts = Array.prototype.slice.call(sels[i].options);
          for (var j = 0; j < opts.length; j++) {
            var o = opts[j];
            if (o.disabled || !o.value || o.value === "*" || o.value === "**" || /품절/.test(o.text)) continue;
            for (var k = 0; k < accept.length; k++)
              if (new RegExp("(?<![A-Za-z0-9])" + esc(accept[k]) + "(?![A-Za-z0-9])", "i").test(o.text))
                return { selectId: sels[i].id || null, index: i, value: o.value, text: o.text.trim() };
          }
        }
        return null;
      }`})(${JSON.stringify(axis.accept)})`,
    );
    if (pick) {
      const loc = pick.selectId ? page.locator(`select#${pick.selectId}`) : page.locator("select").nth(pick.index);
      await loc.selectOption(pick.value);
      await page.waitForTimeout(1200);
      const elExpr = pick.selectId ? `document.getElementById(${JSON.stringify(pick.selectId)})` : `document.querySelectorAll("select")[${pick.index}]`;
      const shown: string = await page.evaluate(`(function (el) { return el && el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ""; })(${elExpr})`);
      if (!axis.accept.some((tok) => containsToken(shown, tok))) {
        return { ok: false, reason: "option_not_confirmed", detail: `${axis.axis} 선택 후 표시값 "${shown}"` };
      }
      selectedOptions.push(shown.trim());
      continue;
    }
    // 2) Cafe24 버튼형 옵션 (ul.ec-product-button > li)
    const mark = `cafe24-${axis.axis}`;
    const btn = await page.evaluate(`(${MARK_BUTTON_IN_PAGE})(${JSON.stringify({ accept: axis.accept, mark })})`);
    if (btn) {
      await page.locator(`[data-dpr-pick='${mark}']`).first().click();
      await page.waitForTimeout(1200);
      const sel: { selected: boolean; how: string } = await page.evaluate(`(${IS_MARK_SELECTED_IN_PAGE})(${JSON.stringify(mark)})`);
      if (!sel.selected) return { ok: false, reason: "option_not_confirmed", detail: `${axis.axis} 버튼 클릭 후 선택 표시 없음 (${sel.how})` };
      selectedOptions.push((btn as { text: string }).text);
      continue;
    }
    if (axis.ifPresent) continue; // 상품명으로 확인 (checkOption)
    const anySelect: number = await page.locator("select").count();
    return anySelect
      ? { ok: false, reason: "option_value_not_found", detail: `${axis.axis}=${axis.accept.join("/")} 선택지 없음(품절 포함)` }
      : { ok: false, reason: "option_control_not_found", detail: `${axis.axis} 옵션 컨트롤 없음` };
  }

  // 선택된 옵션 행: 정확히 1행, 수량 1 (행의 가격은 읽지 않는다)
  const rows: { count: number; quantities: string[] } = await page.evaluate(`(function () {
    var rows = document.querySelectorAll("#totalProducts tbody.option_products tr, #totalProducts .option_product");
    var qs = Array.prototype.map.call(document.querySelectorAll("#totalProducts input[name^=quantity_opt]"), function (i) { return i.value; });
    return { count: rows.length, quantities: qs };
  })()`);
  if (rows.count > 1) return { ok: false, reason: "quantity_mismatch", detail: `선택된 옵션 행 ${rows.count}개 - 1개여야 함` };
  if (rows.quantities.some((q) => q !== "1")) return { ok: false, reason: "quantity_mismatch", detail: `옵션 행 수량 ${rows.quantities.join(",")}` };

  const totalText: string =
    (await page
      .locator("#totalPrice, .totalPrice, #span_product_price_text_total")
      .first()
      .innerText({ timeout: 3000 })
      .catch(() => "")) || (await bodyText(page));
  const total = extractTotalProductAmount(totalText);
  if (!total) return { ok: false, reason: "price_not_found", detail: `'총 상품금액' 금액 없음 (영역 텍스트: "${totalText.slice(0, 80).replace(/\s+/g, " ")}")` };
  const text = await bodyText(page);
  return {
    ok: true,
    price: total.price,
    currency: "KRW",
    basis: "total_product_amount",
    optionConfirmation: "selected_and_displayed",
    selectedOptions,
    productTitle: await productTitleOf(page),
    stockNote: t.stockCheck ? findStockNote(text) : null,
    stockChecked: t.stockCheck,
    quantity: total.quantity ?? (rows.quantities.length === 1 ? Number(rows.quantities[0]) : 1),
    source: "총 상품금액",
  };
}

/** 13/18/19-JP: 라쿠텐 옵션 버튼 선택 -> 선택 표시 확인 -> 표시 가격. */
async function readRakutenButton(page: Page, t: PriceTarget): Promise<PageReading> {
  let text = await bodyText(page);
  let itemCodeFound: string | undefined;
  if (t.option.itemCode) {
    itemCodeFound = findItemCode(text, t.option.itemCode);
    if (!itemCodeFound) return { ok: false, reason: "item_code_mismatch", detail: `페이지에서 품번 ${t.option.itemCode}을 찾지 못함` };
  }
  const selectedOptions: string[] = [];
  for (const axis of t.option.axes) {
    const mark = `rakuten-${axis.axis}`;
    const btn: { text: string; count: number } | null = await page.evaluate(`(${MARK_BUTTON_IN_PAGE})(${JSON.stringify({ accept: axis.accept, mark })})`);
    if (!btn) {
      if (axis.ifPresent) continue;
      return { ok: false, reason: "option_value_not_found", detail: `${axis.axis} 버튼(${axis.accept.join("/")}) 없음` };
    }
    await page.locator(`[data-dpr-pick='${mark}']`).first().click();
    await page.waitForTimeout(1500);
    const sel: { selected: boolean; how: string } = await page.evaluate(`(${IS_MARK_SELECTED_IN_PAGE})(${JSON.stringify(mark)})`);
    if (!sel.selected) {
      // 선택 확인 실패 -> 대표가를 옵션 가격으로 저장하지 않는다
      return { ok: false, reason: "option_not_confirmed", detail: `${axis.axis}=${btn.text} 클릭 후 선택 표시 없음 (${sel.how})` };
    }
    selectedOptions.push(btn.text);
  }
  const displayed: string | null = await page.evaluate(`(${READ_DISPLAYED_JPY_IN_PAGE})()`);
  const price = displayed ? parseMoney(displayed) : undefined;
  if (!price) return { ok: false, reason: "price_not_found", detail: "옵션 선택 후 표시 가격(円)을 찾지 못함" };
  text = await bodyText(page);
  return {
    ok: true,
    price,
    currency: "JPY",
    basis: "listed_price",
    optionConfirmation: "selected_and_displayed",
    selectedOptions,
    productTitle: await productTitleOf(page),
    itemCodeFound,
    stockNote: t.stockCheck ? findStockNote(text) : null,
    stockChecked: t.stockCheck,
    quantity: 1,
    source: "표시 가격 (옵션 선택 후)",
  };
}

const READERS: Record<ReaderKind, (page: Page, t: PriceTarget) => Promise<PageReading>> = {
  wix_listed: readWixListed,
  cafe24_total: readCafe24Total,
  rakuten_button: readRakutenButton,
};

/** 실제 페이지 1개를 읽는다. debugDir를 주면 실패 시 HTML/스크린샷을 남긴다. */
export async function readPage(browser: Browser, t: PriceTarget, opts: { debugDir?: string } = {}): Promise<PageReading> {
  if (!t.url) return { ok: false, reason: "url_missing", detail: "targets 파일에 URL이 없음" };
  const opened = await openPage(browser, t.url);
  if ("fail" in opened) return opened.fail;
  const { page } = opened;
  try {
    const reading = await READERS[t.reader](page, t);
    const final = reading.ok ? validateReading(t, reading) : reading;
    if (!final.ok && opts.debugDir) {
      mkdirSync(opts.debugDir, { recursive: true });
      writeFileSync(join(opts.debugDir, `${t.id}.html`), await page.content().catch(() => ""), "utf-8");
      await page.screenshot({ path: join(opts.debugDir, `${t.id}.png`), fullPage: false }).catch(() => undefined);
    }
    return reading;
  } catch (err) {
    return { ok: false, reason: "fetch_failed", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ------------------------------------------------------------- file I/O

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TARGETS_PATH = join(SCRIPT_DIR, "diving-price-targets.json");
export const DEFAULT_OUT_DIR = join(SCRIPT_DIR, "..", "..", "local-results", "diving-price-refresh");

/** 기존 결과 JSON·검수 이력 파일로의 쓰기를 막는다. */
export function assertSafeOutputPath(path: string): void {
  const name = basename(path);
  if (/^review-decisions/i.test(name) || /^(kr|jp)[-_]/i.test(name) || /11st|rakuten/i.test(name)) {
    throw new Error(`출력 경로 ${path}는 기존 결과/검수 이력 파일과 겹칠 수 있어 거부함 - diving-price-refresh 전용 파일을 쓰세요`);
  }
}

export function loadTargets(path: string): PriceTarget[] {
  return JSON.parse(readFileSync(path, "utf-8")).targets as PriceTarget[];
}

export function loadState(path: string): Record<string, LinkState> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

export function saveJson(path: string, data: unknown): void {
  assertSafeOutputPath(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** 한 번의 갱신 실행. reader를 주입받으므로 테스트는 가짜 리더로 돈다. */
export async function runRefresh(
  targets: PriceTarget[],
  prevState: Record<string, LinkState>,
  reader: (t: PriceTarget) => Promise<PageReading>,
  now: () => Date = () => new Date(),
): Promise<{ state: Record<string, LinkState>; events: RefreshEvent[] }> {
  const state = { ...prevState };
  const events: RefreshEvent[] = [];
  for (const t of targets) {
    let reading: PageReading;
    try {
      reading = await reader(t);
    } catch (err) {
      reading = { ok: false, reason: "fetch_failed", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
    }
    const { state: s, event } = applyReading(t, state[t.id], reading, now());
    state[t.id] = s;
    events.push(event);
  }
  return { state, events };
}

export function formatEvent(e: RefreshEvent): string {
  switch (e.type) {
    case "first_success":
      return `${e.id}: 성공(첫 기록) ${e.price.toLocaleString()} ${e.currency} | 재고 문구: ${e.stockNote}`;
    case "unchanged":
      return `${e.id}: 성공(변동 없음) ${e.price.toLocaleString()} ${e.currency} | 재고 문구: ${e.stockNote}`;
    case "price_changed":
      return `${e.id}: 성공(가격 변경) ${e.from.toLocaleString()} -> ${e.to.toLocaleString()} ${e.currency} | 재고 문구: ${e.stockNote}`;
    case "failed":
      return (
        `${e.id}: 실패 [${e.reason}] ${e.detail}` +
        (e.preservedPrice != null ? ` | 마지막 성공 ${e.preservedPrice.toLocaleString()} (${e.preservedAt}) 보존` : " | 보존할 성공 기록 없음")
      );
  }
}

// ------------------------------------------------------------------ CLI

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function cliRun() {
  const targetsPath = resolve(parseArg("targets") ?? DEFAULT_TARGETS_PATH);
  const statePath = resolve(parseArg("state") ?? join(DEFAULT_OUT_DIR, "state.json"));
  const only = parseArg("only")?.split(",").map((s) => s.trim());
  let targets = loadTargets(targetsPath);
  if (only) targets = targets.filter((t) => only.includes(t.id));

  const missing = targets.filter((t) => !t.url);
  if (missing.length) {
    console.error(`URL 미설정: ${missing.map((t) => t.id).join(", ")} - ${targetsPath}에 URL을 채운 뒤 실행하세요.`);
    process.exit(2);
  }
  assertSafeOutputPath(statePath);

  const browser = await launchBrowser({ headed: process.argv.includes("--headed") });
  if (!browser) {
    console.error("Playwright chromium을 띄울 수 없음 - `npx playwright install chromium` 후 다시 실행 (상태 파일 변경 없음)");
    process.exit(3);
  }
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const debugDir = join(dirname(statePath), "debug", stamp);
  try {
    const { state, events } = await runRefresh(targets, loadState(statePath), (t) => readPage(browser, t, { debugDir }));
    saveJson(statePath, state);
    const runPath = join(dirname(statePath), "runs", `${stamp}.json`);
    saveJson(runPath, { mode: "live", startedAt, finishedAt: new Date().toISOString(), targetsPath, events });
    console.log(`=== 다이빙 가격 갱신 (실제 페이지) ${startedAt} ===`);
    for (const e of events) console.log(formatEvent(e));
    console.log(`\n상태: ${statePath}\n실행 기록: ${runPath}${events.some((e) => e.type === "failed") ? `\n실패 페이지 스냅샷: ${debugDir}` : ""}`);
  } finally {
    await browser.close();
  }
}

function cliShow() {
  const statePath = resolve(parseArg("state") ?? join(DEFAULT_OUT_DIR, "state.json"));
  const state = loadState(statePath);
  if (!Object.keys(state).length) {
    console.log(`상태 없음: ${statePath}`);
    return;
  }
  for (const s of Object.values(state)) {
    const ok = s.lastSuccess
      ? `${s.lastSuccess.price.toLocaleString()} ${s.lastSuccess.currency} @ ${s.lastSuccess.at} | 옵션: ${s.lastSuccess.selectedOptions.join(" / ") || "(선택기 없음)"} | 재고 문구: ${s.lastSuccess.stockNote}`
      : "성공 기록 없음";
    const fail = s.lastFailure ? ` | 마지막 실패 ${s.lastFailure.at} [${s.lastFailure.reason}] ${s.lastFailure.detail}` : "";
    console.log(`${s.id} [${s.optionLabel}] ${ok}${fail}`);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("refresh-diving-prices.ts")) {
  const cmd = process.argv[2];
  if (cmd === "run") cliRun();
  else if (cmd === "show") cliShow();
  else {
    console.error("Usage: refresh-diving-prices.ts <run|show> [--targets=<json>] [--state=<json>] [--only=13-KR,...] [--headed]");
    process.exit(1);
  }
}
