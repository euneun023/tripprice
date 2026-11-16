/**
 * 다이빙 PoC 가격 갱신 스크립트 (초안) - 6개 판매 페이지(#13/#18/#19 x KR/JP)의
 * 지정 옵션 가격을 읽어 링크별 상태 파일에 기록한다. 기준: f84066c.
 *
 * 구조 (테스트 가능한 순수 로직과 네트워크 부분을 분리):
 *   - readers  : 페이지 -> PageReading (브라우저/HTML 파싱, 네트워크 필요)
 *   - applyReading(): PageReading + 이전 상태 -> 새 상태 + 이벤트 (순수 함수)
 *       * 성공: 가격·통화·관측 옵션·성공 시각 기록, 가격 변경 감지
 *       * 실패: lastSuccess(마지막 성공 가격·시각)는 그대로 보존,
 *               lastFailure에 실패 시각과 이유만 기록
 *       * 통화 불일치 / 옵션 불일치 / 수량≠1 / 가격 기준 불일치는 "읽기
 *         성공"이 아니라 실패로 처리 - 잘못된 가격으로 덮어쓰지 않는다.
 *   - KR #18·#19 (priceBasis=total_product_amount): 지정 옵션 1개를 선택한
 *     뒤 페이지의 '총 상품금액'(수량 1)을 읽는 것을 기준으로 한다. 정가/
 *     판매가 표시만 읽힌 경우는 price_basis_mismatch 실패.
 *
 * 저장 위치 (기존 결과 JSON·검수 이력과 분리):
 *   local-results/diving-price-refresh/state.json         링크별 최신 상태
 *   local-results/diving-price-refresh/runs/<시각>.json    실행별 기록
 * local-results/는 gitignore 대상. review-decisions-*.json, 11st/Rakuten
 * 결과 JSON은 읽지도 쓰지도 않는다. 운영 DB 반영 없음.
 *
 * 사용:
 *   npx tsx src/scripts/refresh-diving-prices.ts run [--targets=<json>] [--state=<json>] [--only=13-KR,19-JP]
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

export interface OptionAxisSpec {
  axis: string;
  /** 이 중 하나가 관측 옵션 텍스트에 토큰 단위로 있어야 일치. */
  accept: string[];
  /** true면 브라우저 리더가 <select>에서 이 값을 선택한다. */
  select?: boolean;
}

export interface OptionSpec {
  label: string;
  axes: OptionAxisSpec[];
  /** 관측 텍스트에 있으면 다른 변형(예: Peregrine TX)으로 보고 불일치. */
  reject: string[];
}

export interface PriceTarget {
  id: string;
  n: number;
  market: Market;
  title: string;
  url: string | null;
  currency: Currency;
  priceBasis: PriceBasis;
  option: OptionSpec;
}

export type FailureReason =
  | "url_missing"
  | "fetch_failed"
  | "http_status"
  | "browser_unavailable"
  | "option_control_not_found"
  | "option_value_not_found"
  | "price_not_found"
  | "price_invalid"
  | "currency_mismatch"
  | "option_mismatch"
  | "quantity_mismatch"
  | "price_basis_mismatch";

export type PageReading =
  | {
      ok: true;
      price: number;
      currency: Currency;
      basis: PriceBasis;
      /** 선택된 옵션 텍스트 + 상품명 등, 옵션 검증에 쓰는 관측 텍스트. */
      observedOptionText: string;
      quantity: number;
      source: string;
    }
  | { ok: false; reason: FailureReason; detail: string };

export interface SuccessRecord {
  price: number;
  currency: Currency;
  at: string;
  observedOptionText: string;
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
  | { id: string; type: "first_success"; price: number; currency: Currency }
  | { id: string; type: "unchanged"; price: number; currency: Currency }
  | { id: string; type: "price_changed"; from: number; to: number; currency: Currency }
  | { id: string; type: "failed"; reason: FailureReason; detail: string; preservedPrice: number | null; preservedAt: string | null };

// ---------------------------------------------------------- option check

/** 토큰 경계 매칭: "S"가 "SLS"/"GPS" 안에서 잡히지 않도록 앞뒤가 라틴
 * 문자·숫자가 아닐 때만 일치로 본다 ("사이즈S", "S사이즈", "(S)" 는 일치). */
export function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(text);
}

export function checkOption(spec: OptionSpec, observed: string): { ok: true } | { ok: false; detail: string } {
  const rejected = spec.reject.filter((r) => containsToken(observed, r));
  if (rejected.length) return { ok: false, detail: `다른 변형 표기 발견(${rejected.join(", ")}) - 지정 옵션 "${spec.label}"` };
  const missing = spec.axes.filter((a) => !a.accept.some((t) => containsToken(observed, t)));
  if (missing.length) {
    return { ok: false, detail: `지정 옵션 "${spec.label}"의 ${missing.map((m) => m.axis).join(", ")} 값을 관측 텍스트에서 확인 못함` };
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
  if (!Number.isFinite(r.price) || r.price <= 0 || !Number.isInteger(r.price)) {
    return { ok: false, reason: "price_invalid", detail: `읽은 가격 ${r.price}이(가) 양의 정수가 아님` };
  }
  if (r.currency !== t.currency) return { ok: false, reason: "currency_mismatch", detail: `기대 ${t.currency}, 관측 ${r.currency}` };
  if (r.basis !== t.priceBasis) {
    return { ok: false, reason: "price_basis_mismatch", detail: `기대 ${t.priceBasis}, 관측 ${r.basis} (${r.source})` };
  }
  if (r.quantity !== 1) return { ok: false, reason: "quantity_mismatch", detail: `수량 ${r.quantity} - 지정 옵션 1개 기준이어야 함` };
  const opt = checkOption(t.option, r.observedOptionText);
  if (!opt.ok) return { ok: false, reason: "option_mismatch", detail: opt.detail };
  return r;
}

export function applyReading(
  t: PriceTarget,
  prev: LinkState | undefined,
  raw: PageReading,
  now: Date,
): { state: LinkState; event: RefreshEvent } {
  const at = now.toISOString();
  const base: LinkState = {
    ...(prev ?? initialState(t)),
    // 설정 쪽 값은 항상 최신 targets 기준으로 맞춘다.
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
      event: {
        id: t.id,
        type: "failed",
        reason: r.reason,
        detail: r.detail,
        preservedPrice: state.lastSuccess?.price ?? null,
        preservedAt: state.lastSuccess?.at ?? null,
      },
    };
  }

  const success: SuccessRecord = { price: r.price, currency: r.currency, at, observedOptionText: r.observedOptionText, source: r.source };
  const before = base.lastSuccess;
  const priceChanges =
    before && before.price !== r.price ? [...base.priceChanges, { at, from: before.price, to: r.price }].slice(-20) : base.priceChanges;
  const state: LinkState = { ...base, lastAttemptOk: true, lastSuccess: success, priceChanges };
  const event: RefreshEvent = !before
    ? { id: t.id, type: "first_success", price: r.price, currency: r.currency }
    : before.price !== r.price
      ? { id: t.id, type: "price_changed", from: before.price, to: r.price, currency: r.currency }
      : { id: t.id, type: "unchanged", price: r.price, currency: r.currency };
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
 * product:price:amount 메타 순. 통화도 함께 (없으면 undefined). */
export function extractListedPrice(html: string): { price: number; currency?: string; source: string } | undefined {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findOffer(JSON.parse(m[1]));
      if (found) return { ...found, source: "json-ld" };
    } catch {
      /* 깨진 JSON-LD는 무시하고 다음 방법 */
    }
  }
  const itemprop =
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
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

const TOTAL_LABELS = ["총 상품금액", "총상품금액", "총 상품 금액"];

/** 렌더링된 페이지 텍스트에서 '총 상품금액' 라벨 바로 뒤의 금액(원)을 읽는다.
 * 라벨이 없거나 금액이 0원(옵션 미선택 상태)이면 undefined. */
export function extractTotalProductAmount(pageText: string): { price: number; quantity?: number } | undefined {
  for (const label of TOTAL_LABELS) {
    const idx = pageText.indexOf(label);
    if (idx < 0) continue;
    const after = pageText.slice(idx + label.length, idx + label.length + 120);
    const m = after.match(/([\d,]+)\s*원/);
    if (!m) continue;
    const price = parseMoney(m[1]);
    if (!price) return undefined;
    const q = after.match(/\(\s*(\d+)\s*개\s*\)/) ?? pageText.slice(Math.max(0, idx - 80), idx).match(/수량\s*(\d+)/);
    return { price, quantity: q ? Number(q[1]) : undefined };
  }
  return undefined;
}

// -------------------------------------------------------- browser reader

type Browser = { newPage(): Promise<any>; close(): Promise<void> };

async function launchBrowser(): Promise<Browser | undefined> {
  try {
    const require = createRequire(import.meta.url);
    const pw = require("playwright");
    return await pw.chromium.launch();
  } catch {
    return undefined;
  }
}

/** 페이지 안에서 실행되는 코드 - 문자열로 넘긴다 (tsx 변환이 넣는 헬퍼가
 * 브라우저 쪽에 없어 함수 객체를 그대로 넘기면 깨진다). accept 토큰과
 * 일치하는, 품절·비활성이 아닌 첫 <select> 선택지를 찾는다. */
const FIND_OPTION_IN_PAGE = String.raw`function (accept) {
  var esc = function (t) { return t.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"); };
  var selects = Array.prototype.slice.call(document.querySelectorAll("select"));
  for (var i = 0; i < selects.length; i++) {
    var opts = Array.prototype.slice.call(selects[i].options);
    for (var j = 0; j < opts.length; j++) {
      var o = opts[j];
      if (o.disabled || !o.value || /품절|sold\s*out|在庫切れ/i.test(o.text)) continue;
      for (var k = 0; k < accept.length; k++) {
        if (new RegExp("(?<![A-Za-z0-9])" + esc(accept[k]) + "(?![A-Za-z0-9])", "i").test(o.text)) {
          return { selectIndex: i, value: o.value, text: o.text.trim() };
        }
      }
    }
  }
  return null;
}`;

/** 실제 페이지 1개를 읽는다. 사이트별 셀렉터 없이 일반 규칙만 쓴다:
 *  - select:true 축은 <select>의 option 텍스트에서 accept 토큰을 찾아 선택
 *  - total_product_amount: 선택 후 렌더링 텍스트의 '총 상품금액' 금액
 *  - listed_price: JSON-LD/itemprop/meta 가격
 * 실제 6개 페이지 구조로 아직 검증되지 않았다 (첫 실행 결과로 보정 필요). */
export async function readPage(browser: Browser, t: PriceTarget): Promise<PageReading> {
  if (!t.url) return { ok: false, reason: "url_missing", detail: "targets 파일에 URL이 없음" };
  const page = await browser.newPage();
  try {
    let status: number | undefined;
    try {
      const res = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      status = res?.status();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    } catch (err) {
      return { ok: false, reason: "fetch_failed", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
    }
    if (status !== undefined && status >= 400) return { ok: false, reason: "http_status", detail: `HTTP ${status}` };

    const selectedTexts: string[] = [];
    for (const axis of t.option.axes.filter((a) => a.select)) {
      const choice: { selectIndex: number; value: string; text: string } | null = await page.evaluate(
        `(${FIND_OPTION_IN_PAGE})(${JSON.stringify(axis.accept)})`,
      );
      if (!choice) {
        const hasSelect = (await page.locator("select").count()) > 0;
        return hasSelect
          ? { ok: false, reason: "option_value_not_found", detail: `${axis.axis}=${axis.accept.join("/")} 선택지 없음(품절 포함)` }
          : { ok: false, reason: "option_control_not_found", detail: "<select> 옵션 컨트롤 없음 - 사이트별 처리 필요" };
      }
      await page.locator("select").nth(choice.selectIndex).selectOption(choice.value);
      await page.waitForTimeout(800);
      selectedTexts.push(choice.text);
    }

    const title = ((await page.title()) ?? "") + " " + ((await page.locator("h1").first().textContent({ timeout: 2000 }).catch(() => "")) ?? "");
    const observedOptionText = [...selectedTexts, title].join(" | ").replace(/\s+/g, " ").trim();

    if (t.priceBasis === "total_product_amount") {
      const text: string = await page.evaluate("document.body.innerText");
      const total = extractTotalProductAmount(text);
      if (!total) return { ok: false, reason: "price_not_found", detail: "'총 상품금액' 금액을 찾지 못함 (옵션 미선택 또는 라벨 상이)" };
      return {
        ok: true,
        price: total.price,
        currency: "KRW",
        basis: "total_product_amount",
        observedOptionText,
        quantity: total.quantity ?? 1,
        source: "총 상품금액",
      };
    }

    const html: string = await page.content();
    const listed = extractListedPrice(html);
    if (!listed) return { ok: false, reason: "price_not_found", detail: "JSON-LD/itemprop/meta 가격 없음" };
    const currency = (listed.currency ?? (t.market === "KR" ? "KRW" : "JPY")) as Currency;
    return { ok: true, price: listed.price, currency, basis: "listed_price", observedOptionText, quantity: 1, source: listed.source };
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
      return `${e.id}: 첫 성공 ${e.price.toLocaleString()} ${e.currency}`;
    case "unchanged":
      return `${e.id}: 변동 없음 ${e.price.toLocaleString()} ${e.currency}`;
    case "price_changed":
      return `${e.id}: 가격 변경 ${e.from.toLocaleString()} -> ${e.to.toLocaleString()} ${e.currency}`;
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
    console.error(`URL 미설정: ${missing.map((t) => t.id).join(", ")} - ${targetsPath}에 11/16 검증 기록의 URL을 채운 뒤 실행하세요.`);
    process.exit(2);
  }
  assertSafeOutputPath(statePath);

  const browser = await launchBrowser();
  if (!browser) {
    console.error("Playwright chromium을 띄울 수 없음 - 실행 중단 (상태 파일 변경 없음)");
    process.exit(3);
  }
  const startedAt = new Date().toISOString();
  try {
    const { state, events } = await runRefresh(targets, loadState(statePath), (t) => readPage(browser, t));
    saveJson(statePath, state);
    const runPath = join(dirname(statePath), "runs", `${startedAt.replace(/[:.]/g, "-")}.json`);
    saveJson(runPath, { mode: "live", startedAt, finishedAt: new Date().toISOString(), targetsPath, baseCommit: "f84066c", events });
    console.log(`=== 다이빙 가격 갱신 (실제 페이지) ${startedAt} ===`);
    for (const e of events) console.log(formatEvent(e));
    console.log(`\n상태: ${statePath}\n실행 기록: ${runPath}`);
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
    const ok = s.lastSuccess ? `${s.lastSuccess.price.toLocaleString()} ${s.lastSuccess.currency} @ ${s.lastSuccess.at}` : "성공 기록 없음";
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
    console.error("Usage: refresh-diving-prices.ts <run|show> [--targets=<json>] [--state=<json>] [--only=13-KR,...]");
    process.exit(1);
  }
}
