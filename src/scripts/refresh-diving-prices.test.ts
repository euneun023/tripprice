/**
 * Offline tests for refresh-diving-prices.ts - 테스트 데이터만 사용, 외부
 * 네트워크 없음. 브라우저 리더는 로컬 file:// 픽스처 페이지(사이트 구조를
 * 흉내 낸 HTML)로만 확인한다. 실제 판매 페이지 실측과는 별개.
 * Run: npx tsx src/scripts/refresh-diving-prices.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyReading,
  runRefresh,
  readPage,
  launchBrowser,
  containsToken,
  extractListedPrice,
  extractTotalProductAmount,
  findStockNote,
  findItemCode,
  loadTargets,
  loadState,
  saveJson,
  assertSafeOutputPath,
  formatEvent,
  DEFAULT_TARGETS_PATH,
  DEFAULT_OUT_DIR,
  type PriceTarget,
  type PageReading,
  type SuccessfulReading,
  type LinkState,
} from "./refresh-diving-prices";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}
function checkTrue(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const targets = loadTargets(DEFAULT_TARGETS_PATH);
const byId = (id: string): PriceTarget => {
  const t = targets.find((x) => x.id === id);
  if (!t) throw new Error(`no target ${id}`);
  return t;
};

const T0 = new Date("2026-11-16T01:00:00.000Z");
const T1 = new Date("2026-11-17T01:00:00.000Z");
const T2 = new Date("2026-11-18T01:00:00.000Z");

function reading(over: Partial<SuccessfulReading>): SuccessfulReading {
  return {
    ok: true,
    price: 1,
    currency: "KRW",
    basis: "listed_price",
    optionConfirmation: "selected_and_displayed",
    selectedOptions: [],
    productTitle: "",
    stockNote: null,
    stockChecked: true,
    quantity: 1,
    source: "test",
    ...over,
  };
}
const kr19 = (price: number, selectedOptions = ["화이트", "M"]) =>
  reading({ price, basis: "total_product_amount", selectedOptions, productTitle: "Mares Prestige SLS BCD", source: "총 상품금액" });
const jp19 = (price: number, over: Partial<SuccessfulReading> = {}) =>
  reading({ price, currency: "JPY", selectedOptions: ["M"], productTitle: "マレス Prestige SLS", itemCodeFound: "417225", ...over });

async function main() {
  // ---------------------------------------------------------- targets
  check(
    "targets: 11/16 fixed URLs filled per ID",
    Object.fromEntries(targets.map((t) => [t.id, t.url])),
    {
      "13-KR": "https://www.scubatec.co.kr/product-page/shearwaterperegrine",
      "13-JP": "https://item.rakuten.co.jp/mic21/2103112001/",
      "18-KR": "https://hellodiving.co.kr/product/detail.html?product_no=7307",
      "18-JP": "https://item.rakuten.co.jp/diving-ya/fl1760/",
      "19-KR": "https://www.freedivingstore.co.kr/product/detail.html?product_no=2217",
      "19-JP": "https://item.rakuten.co.jp/mic21/2402002019/",
    },
  );
  check(
    "readers / price basis per link",
    targets.map((t) => `${t.id}:${t.reader}:${t.priceBasis}`),
    [
      "13-KR:wix_listed:listed_price",
      "13-JP:rakuten_button:listed_price",
      "18-KR:cafe24_total:total_product_amount",
      "18-JP:rakuten_button:listed_price",
      "19-KR:cafe24_total:total_product_amount",
      "19-JP:rakuten_button:listed_price",
    ],
  );
  check("19-JP: item code 417225, size M only (no color axis)", [byId("19-JP").option.itemCode, byId("19-JP").option.axes.map((a) => a.axis)], ["417225", ["size"]]);
  check("19-KR: color then size order", byId("19-KR").option.axes.map((a) => a.axis), ["color", "size"]);
  check("13-KR: no-selector page, stock not checked", [byId("13-KR").option.mode, byId("13-KR").stockCheck], ["no_selector_page", false]);

  // ----------------------------------------------------- token helpers
  checkTrue("token 'S' not matched inside 'SLS'", !containsToken("Mares Prestige SLS", "S"));
  checkTrue("token 'S' matched in '일반형-S'", containsToken("일반형-S", "S"));
  check("item code 417225 found as token", findItemCode("商品番号：417225", "417225"), "417225");
  check("item code not matched inside 1417225", findItemCode("商品番号：1417225", "417225"), undefined);
  check("stock note kept verbatim", findStockNote("ご注文前に在庫確認が必要です。\n送料無料"), "在庫確認が必要です。");
  check("KR stock note", findStockNote("재고 확인 필요 상품입니다"), "재고 확인 필요 상품입니다");
  check("no stock note", findStockNote("送料無料"), null);

  // ------------------------------------------- price change detection
  {
    const t = byId("19-KR");
    const a = applyReading(t, undefined, kr19(1_250_000), T0);
    check("first read -> first_success", a.event.type, "first_success");
    check("records price/currency/at", [a.state.lastSuccess?.price, a.state.lastSuccess?.currency, a.state.lastSuccess?.at], [1250000, "KRW", T0.toISOString()]);
    check("records specified option label + confirmed options", [a.state.optionLabel, a.state.lastSuccess?.selectedOptions], ["화이트 / M", ["화이트", "M"]]);
    const b = applyReading(t, a.state, kr19(1_250_000), T1);
    check("same price -> unchanged", b.event.type, "unchanged");
    check("unchanged refreshes last success time", b.state.lastSuccess?.at, T1.toISOString());
    const c = applyReading(t, b.state, kr19(1_190_000), T2);
    check("new price -> price_changed", c.event.type === "price_changed" && [c.event.from, c.event.to], [1250000, 1190000]);
    check("price change logged", c.state.priceChanges, [{ at: T2.toISOString(), from: 1250000, to: 1190000 }]);
  }

  // ------------------------------------------------ page read failure
  {
    const t = byId("18-JP");
    const ok = reading({ price: 64_900, currency: "JPY", selectedOptions: ["S"], productTitle: "Zeagle Ranger FL1760", itemCodeFound: "FL1760", stockNote: "在庫確認が必要です" });
    const s0 = applyReading(t, undefined, ok, T0).state;
    check("18-JP stock note recorded as-is", s0.lastSuccess?.stockNote, "在庫確認が必要です");
    const f = applyReading(t, s0, { ok: false, reason: "http_status", detail: "HTTP 503" }, T1);
    check("last success price/time preserved on failure", [f.state.lastSuccess?.price, f.state.lastSuccess?.at], [64900, T0.toISOString()]);
    check("failure time and reason recorded", f.state.lastFailure, { at: T1.toISOString(), reason: "http_status", detail: "HTTP 503" });
    checkTrue("event message mentions preserved price", formatEvent(f.event).includes("64,900") && formatEvent(f.event).includes("보존"));
    const r = applyReading(t, f.state, ok, T2);
    check("recovery -> unchanged vs preserved price", r.event.type, "unchanged");
  }

  // ----------------------------- 13-KR: no-selector page, no color/stock claim
  {
    const t = byId("13-KR");
    const ok = reading({ price: 1_290_000, optionConfirmation: "no_selector_page", productTitle: "Shearwater Peregrine", stockChecked: false });
    const s = applyReading(t, undefined, ok, T0).state;
    check("13-KR success: no option recorded as page-confirmed", s.lastSuccess?.selectedOptions, []);
    check("13-KR success: stock recorded as not checked", s.lastSuccess?.stockNote, "확인 안 함");
    const tx = applyReading(t, undefined, { ...ok, productTitle: "Shearwater Peregrine TX" }, T0);
    check("13-KR: Peregrine TX page -> option_mismatch", tx.event.type === "failed" && tx.event.reason, "option_mismatch");
  }

  // ------------------- Rakuten: option not confirmed -> keep old, no rep price
  {
    const t = byId("13-JP");
    const s0 = applyReading(t, undefined, reading({ price: 70_000, currency: "JPY", selectedOptions: ["ブラック"], productTitle: "Peregrine" }), T0).state;
    const rep = reading({ price: 65_000, currency: "JPY", optionConfirmation: "no_selector_page", productTitle: "Peregrine" });
    const f = applyReading(t, s0, rep, T1);
    check("unconfirmed option -> option_not_confirmed", f.event.type === "failed" && f.event.reason, "option_not_confirmed");
    check("representative price NOT stored; previous kept", [f.state.lastSuccess?.price, f.state.lastSuccess?.at], [70000, T0.toISOString()]);
    const wrong = applyReading(t, s0, reading({ price: 70_000, currency: "JPY", selectedOptions: ["ホワイト"], productTitle: "Peregrine" }), T1);
    check("selected ホワイト instead of ブラック -> option_mismatch", wrong.event.type === "failed" && wrong.event.reason, "option_mismatch");
  }

  // ---------------------------- 19-JP: item code + size verification
  {
    const t = byId("19-JP");
    const s0 = applyReading(t, undefined, jp19(98_000), T0).state;
    check("19-JP code 417225 + M -> success", s0.lastSuccess && [s0.lastSuccess.price, s0.lastSuccess.itemCodeFound, s0.lastSuccess.selectedOptions], [98000, "417225", ["M"]]);
    const code = applyReading(t, s0, jp19(91_000, { itemCodeFound: "417226" }), T1);
    check("19-JP other item code -> item_code_mismatch", code.event.type === "failed" && code.event.reason, "item_code_mismatch");
    check("... previous price kept", code.state.lastSuccess?.price, 98000);
    const size = applyReading(t, s0, jp19(91_000, { selectedOptions: ["L"] }), T1);
    check("19-JP size L -> option_mismatch", size.event.type === "failed" && size.event.reason, "option_mismatch");
    check("... previous price kept", size.state.lastSuccess?.price, 98000);
    const noCode = applyReading(t, s0, jp19(91_000, { itemCodeFound: undefined }), T1);
    check("19-JP code not found -> item_code_mismatch", noCode.event.type === "failed" && noCode.event.reason, "item_code_mismatch");
  }

  // ------------------------------- other validations (not overwritten)
  {
    const t = byId("18-KR");
    const listed = reading({ price: 580_000, selectedOptions: ["일반형", "S"], productTitle: "Zeagle Ranger" });
    const r = applyReading(t, undefined, listed, T0);
    check("KR #18 listed (row) price instead of 총 상품금액 -> price_basis_mismatch", r.event.type === "failed" && r.event.reason, "price_basis_mismatch");
    const q2 = applyReading(t, undefined, { ...listed, basis: "total_product_amount", quantity: 2 }, T0);
    check("quantity 2 -> quantity_mismatch", q2.event.type === "failed" && q2.event.reason, "quantity_mismatch");
  }
  {
    const reader = async (t: PriceTarget): Promise<PageReading> => {
      if (t.id === "13-JP") throw new Error("net::ERR_TUNNEL_CONNECTION_FAILED\nstack...");
      return jp19(98_000);
    };
    const prev: Record<string, LinkState> = {
      "13-JP": applyReading(byId("13-JP"), undefined, reading({ price: 70_000, currency: "JPY", selectedOptions: ["ブラック"], productTitle: "Peregrine" }), T0).state,
    };
    const { state, events } = await runRefresh([byId("13-JP"), byId("19-JP")], prev, reader, () => T1);
    check("thrown reader -> fetch_failed, price kept", [events[0].type === "failed" && events[0].reason, state["13-JP"].lastSuccess?.price], ["fetch_failed", 70000]);
    check("other link still processed", events[1].type, "first_success");
  }

  // ------------------------------------------------ text extraction
  check("Cafe24 총 상품금액(수량)", extractTotalProductAmount("총 상품금액(수량) : 1,250,000원 (1개)"), { price: 1250000, quantity: 1 });
  check("Cafe24 TOTAL without 원", extractTotalProductAmount("TOTAL : 1,250,000 (1개)"), { price: 1250000, quantity: 1 });
  check("총 상품금액 0원 -> not found", extractTotalProductAmount("총 상품금액(수량) : 0원 (0개)"), undefined);
  check(
    "JSON-LD offer",
    extractListedPrice(`<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"98000","priceCurrency":"JPY"}}</script>`),
    { price: 98000, currency: "JPY", source: "json-ld" },
  );

  // ---------------------------------------------- output path safety
  const dir = mkdtempSync(join(tmpdir(), "diving-price-refresh-test-"));
  try {
    checkTrue("default output dir is local-results/diving-price-refresh", DEFAULT_OUT_DIR.replace(/\\/g, "/").endsWith("local-results/diving-price-refresh"));
    let refused = 0;
    for (const p of ["local-results/review-decisions-diving12.json", "local-results/kr-diving12.json", "local-results/rakuten-diving.json"]) {
      try {
        assertSafeOutputPath(p);
      } catch {
        refused++;
      }
    }
    check("refuses review-history / existing-result-like paths", refused, 3);
    const statePath = join(dir, "state.json");
    saveJson(statePath, (await runRefresh([byId("19-KR")], {}, async () => kr19(1_250_000), () => T0)).state);
    check("state round-trips through disk", loadState(statePath)["19-KR"].lastSuccess?.price, 1250000);

    await browserFixtures(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

// ------------------------------------------------- browser fixture pages

const WIX = (extra = "") => `<html><head><title>Shearwater Peregrine | scubatec</title></head><body>
<h1>Shearwater Peregrine</h1><span data-hook="formatted-primary-price">₩1,290,000</span>${extra}
<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"999","priceCurrency":"KRW"}}</script></body></html>`;

/** Cafe24-like: 색상 선택 후에야 사이즈 select가 채워지는 연동형 옵션,
 * 선택된 옵션 행에는 정가(1,350,000원)를, #totalPrice에 총 상품금액을 표시. */
const CAFE24 = (opts: { firstLabel: string; first: string[]; second: string[]; base: number; rowList: number }) => `<html><head><title>${opts.firstLabel} 상품</title></head><body>
<h1>Mares Prestige SLS BCD / Zeagle Ranger</h1>
<select id="product_option_id1"><option value="*">- [필수] 옵션 선택 -</option><option value="**">-------</option>${opts.first.map((f, i) => `<option value="P1-${i}">${f}</option>`).join("")}</select>
<select id="product_option_id2" disabled><option value="*">- [필수] 옵션 선택 -</option></select>
<div id="totalProducts"><table><tbody class="option_products"></tbody></table></div>
<div id="totalPrice" class="totalPrice">총 상품금액(수량) : <span class="total"><strong><em>0</em></strong>원 (0개)</span></div>
<script>
  var o1 = document.getElementById('product_option_id1'), o2 = document.getElementById('product_option_id2');
  var body = document.querySelector('#totalProducts tbody'), total = document.getElementById('totalPrice');
  o1.addEventListener('change', function () {
    setTimeout(function () {
      o2.disabled = false;
      o2.innerHTML = '<option value="*">- [필수] 옵션 선택 -</option>' + ${JSON.stringify(opts.second)}.map(function (s, i) { return '<option value="P2-' + i + '">' + s + '</option>'; }).join('');
    }, 200);
  });
  o2.addEventListener('change', function () {
    var label = o1.options[o1.selectedIndex].text + '/' + o2.options[o2.selectedIndex].text;
    body.innerHTML = '<tr class="option_product"><td>' + label + '</td><td><input name="quantity_opt[]" value="1"></td><td class="right">${opts.rowList.toLocaleString("ko-KR")}원</td></tr>';
    total.innerHTML = '총 상품금액(수량) : <span class="total"><strong><em>${opts.base.toLocaleString("ko-KR")}</em></strong>원 (1개)</span>';
  });
</script></body></html>`;

/** Rakuten-like SKU buttons. markSelected=false면 클릭해도 선택 표시가 안 바뀐다. */
const RAKUTEN = (opts: { code: string; groups: { name: string; values: string[] }[]; prices: Record<string, number>; rep: number; markSelected: boolean; extra?: string }) => `<html><head><title>【楽天市場】Shearwater Peregrine / Mares Prestige SLS / Zeagle Ranger</title></head><body>
<h1>Shearwater Peregrine ペレグリン / Mares Prestige SLS / Zeagle Ranger</h1>
<div>商品番号：${opts.code}</div>
<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"${opts.rep}","priceCurrency":"JPY"}}</script>
<div class="price-wrapper"><span class="price--value" id="pv">${opts.rep.toLocaleString("ja-JP")}円</span> <span class="price-point">980ポイント</span></div>
${opts.groups
  .map((g) => `<div class="sku-group"><span>${g.name}</span>${g.values.map((v) => `<button type="button" class="sku-btn" data-g="${g.name}" aria-pressed="false">${v}</button>`).join("")}</div>`)
  .join("")}
${opts.extra ?? ""}
<script>
  var prices = ${JSON.stringify(opts.prices)};
  document.querySelectorAll('.sku-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      ${opts.markSelected ? `document.querySelectorAll('.sku-btn[data-g="' + b.dataset.g + '"]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true');` : ""}
      if (prices[b.textContent]) document.getElementById('pv').textContent = prices[b.textContent].toLocaleString('ja-JP') + '円';
    });
  });
</script></body></html>`;

async function browserFixtures(dir: string) {
  const browser = await launchBrowser();
  if (!browser) {
    console.log("FAIL browser fixtures: playwright chromium could not be launched");
    failures++;
    return;
  }
  const page = (name: string, html: string) => {
    const p = join(dir, `${name}.html`);
    writeFileSync(p, html, "utf-8");
    return `file://${p}`;
  };
  const at = (id: string, url: string): PriceTarget => ({ ...byId(id), url });
  try {
    // 13-KR Wix
    const wix = await readPage(browser, at("13-KR", page("wix", WIX())));
    check("13-KR fixture: displayed public price (not JSON-LD 999), no selector", wix.ok ? [wix.price, wix.optionConfirmation, wix.stockChecked] : wix, [1290000, "no_selector_page", false]);
    const wixSel = await readPage(browser, at("13-KR", page("wix-sel", WIX(`<select><option>Black</option></select>`))));
    check("13-KR fixture: selector appears -> unexpected_option_selector", wixSel.ok ? "ok" : wixSel.reason, "unexpected_option_selector");

    // 19-KR Cafe24: 화이트 -> M, total not row list price
    const c19 = await readPage(browser, at("19-KR", page("c19", CAFE24({ firstLabel: "Prestige", first: ["블랙", "화이트"], second: ["S", "M", "L"], base: 1260000, rowList: 1350000 }))));
    check("19-KR fixture: 화이트 then M selected, 총 상품금액 1개 (not row 1,350,000)", c19.ok ? [c19.selectedOptions, c19.price, c19.quantity, c19.basis] : c19, [["화이트", "M"], 1260000, 1, "total_product_amount"]);
    check("19-KR fixture: passes validation", applyReading(byId("19-KR"), undefined, c19, T0).event.type, "first_success");
    const c19noWhite = await readPage(browser, at("19-KR", page("c19b", CAFE24({ firstLabel: "Prestige", first: ["블랙", "블루"], second: ["S", "M"], base: 1260000, rowList: 1350000 }))));
    check("19-KR fixture: no 화이트 option -> option_value_not_found", c19noWhite.ok ? "ok" : c19noWhite.reason, "option_value_not_found");

    // 18-KR Cafe24: 일반형 -> S
    const c18 = await readPage(browser, at("18-KR", page("c18", CAFE24({ firstLabel: "Ranger", first: ["일반형", "LTD"], second: ["XS", "S", "M"], base: 590000, rowList: 650000 }))));
    check("18-KR fixture: 일반형 + S, 총 상품금액 (not row 650,000)", c18.ok ? [c18.selectedOptions, c18.price] : c18, [["일반형", "S"], 590000]);

    // 13-JP Rakuten: ブラック button, displayed price after selection
    const r13 = await readPage(
      browser,
      at("13-JP", page("r13", RAKUTEN({ code: "2103112001", groups: [{ name: "カラー", values: ["ブラック", "ホワイト"] }], prices: { ブラック: 74800 }, rep: 69800, markSelected: true }))),
    );
    check("13-JP fixture: ブラック selected and displayed price read", r13.ok ? [r13.selectedOptions, r13.price, r13.optionConfirmation] : r13, [["ブラック"], 74800, "selected_and_displayed"]);

    // Rakuten button without selected marker -> option_not_confirmed, rep price not stored
    const r13n = await readPage(
      browser,
      at("13-JP", page("r13n", RAKUTEN({ code: "2103112001", groups: [{ name: "カラー", values: ["ブラック"] }], prices: {}, rep: 69800, markSelected: false }))),
    );
    check("13-JP fixture: no selected marker -> option_not_confirmed", r13n.ok ? "ok" : r13n.reason, "option_not_confirmed");
    const prev13 = applyReading(byId("13-JP"), undefined, r13, T0).state;
    const after13 = applyReading(byId("13-JP"), prev13, r13n, T1);
    check("... representative 69,800 not saved; 74,800 @ T0 preserved", [after13.state.lastSuccess?.price, after13.state.lastSuccess?.at], [74800, T0.toISOString()]);
    check("... failure time recorded", after13.state.lastFailure?.at, T1.toISOString());

    // 18-JP Rakuten: S button + stock note verbatim
    const r18 = await readPage(
      browser,
      at(
        "18-JP",
        page("r18", RAKUTEN({ code: "fl1760", groups: [{ name: "サイズ", values: ["XS", "S", "M"] }], prices: { S: 64900 }, rep: 62000, markSelected: true, extra: "<p>※在庫確認が必要です。ご注文後にご連絡します。</p>" })),
      ),
    );
    check("18-JP fixture: S selected, stock note recorded", r18.ok ? [r18.selectedOptions, r18.price, r18.stockNote, r18.itemCodeFound] : r18, [["S"], 64900, "在庫確認が必要です。ご注文後にご連絡します。", "fl1760"]);
    check("18-JP fixture: passes validation (code case-insensitive)", applyReading(byId("18-JP"), undefined, r18, T0).event.type, "first_success");

    // 19-JP Rakuten: code 417225 + M only, color buttons untouched
    const r19html = RAKUTEN({
      code: "417225",
      groups: [
        { name: "カラー", values: ["ホワイト", "ブラック"] },
        { name: "サイズ", values: ["S", "M", "L"] },
      ],
      prices: { M: 98000 },
      rep: 95000,
      markSelected: true,
    });
    const r19 = await readPage(browser, at("19-JP", page("r19", r19html)));
    check("19-JP fixture: 417225 confirmed, only M selected", r19.ok ? [r19.itemCodeFound, r19.selectedOptions, r19.price] : r19, ["417225", ["M"], 98000]);
    check("19-JP fixture: passes validation", applyReading(byId("19-JP"), undefined, r19, T0).event.type, "first_success");
    const r19wrong = await readPage(browser, at("19-JP", page("r19w", r19html.replace("商品番号：417225", "商品番号：417226"))));
    check("19-JP fixture: other item code -> item_code_mismatch before clicking", r19wrong.ok ? "ok" : r19wrong.reason, "item_code_mismatch");

    // 19-JP: color buttons must not be clicked - check with a page that records clicks
    const probe = r19html.replace("</body>", `<script>window.__colorClicks=0;document.querySelectorAll('.sku-btn[data-g="カラー"]').forEach(function(b){b.addEventListener('click',function(){window.__colorClicks++;document.title+=' COLOR_CLICKED';});});</script></body>`);
    const r19p = await readPage(browser, at("19-JP", page("r19p", probe)));
    checkTrue("19-JP fixture: color buttons were not clicked", r19p.ok && !r19p.productTitle.includes("COLOR_CLICKED"));

    // unreadable page
    const missing = await readPage(browser, at("19-KR", `file://${join(dir, "nope.html")}`));
    check("fixture: unreadable page -> fetch_failed", missing.ok ? "ok" : missing.reason, "fetch_failed");

    // debug snapshot on failure
    const dbg = join(dir, "debug");
    await readPage(browser, at("13-JP", page("r13n2", RAKUTEN({ code: "x", groups: [{ name: "カラー", values: ["ブラック"] }], prices: {}, rep: 1, markSelected: false }))), { debugDir: dbg });
    checkTrue("failure snapshot written to debug dir", readFileSync(join(dbg, "13-JP.html"), "utf-8").includes("ブラック"));
  } finally {
    await browser.close();
  }
}

main();
