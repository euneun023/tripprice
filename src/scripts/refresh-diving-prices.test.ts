/**
 * Offline tests for refresh-diving-prices.ts - 테스트 데이터만 사용, 외부
 * 네트워크 없음. 브라우저 리더는 로컬 file:// 픽스처 페이지로만 확인한다.
 * Run: npx tsx src/scripts/refresh-diving-prices.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  applyReading,
  runRefresh,
  readPage,
  containsToken,
  checkOption,
  extractListedPrice,
  extractTotalProductAmount,
  loadTargets,
  loadState,
  saveJson,
  assertSafeOutputPath,
  formatEvent,
  DEFAULT_TARGETS_PATH,
  DEFAULT_OUT_DIR,
  type PriceTarget,
  type PageReading,
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
  return { ...t, url: t.url ?? `https://example.test/${id}` };
};

const T0 = new Date("2026-11-16T01:00:00.000Z");
const T1 = new Date("2026-11-17T01:00:00.000Z");
const T2 = new Date("2026-11-18T01:00:00.000Z");

function okKr19(price: number, observed = "화이트 | M | Mares Prestige SLS BCD"): PageReading {
  return { ok: true, price, currency: "KRW", basis: "total_product_amount", observedOptionText: observed, quantity: 1, source: "총 상품금액" };
}

async function main() {
  // ---------------------------------------------------------- targets
  check("targets: 6 links", targets.map((t) => t.id), ["13-KR", "13-JP", "18-KR", "18-JP", "19-KR", "19-JP"]);
  check(
    "KR #18/#19 read '총 상품금액', others listed price",
    targets.map((t) => `${t.id}:${t.priceBasis}`),
    ["13-KR:listed_price", "13-JP:listed_price", "18-KR:total_product_amount", "18-JP:listed_price", "19-KR:total_product_amount", "19-JP:listed_price"],
  );
  check("currencies", targets.map((t) => t.currency), ["KRW", "JPY", "KRW", "JPY", "KRW", "JPY"]);
  checkTrue("every URL is either unset (null) or https", targets.every((t) => t.url === null || t.url.startsWith("https://")));

  // ----------------------------------------------------- option check
  checkTrue("token 'S' not matched inside 'SLS'", !containsToken("Mares Prestige SLS", "S"));
  checkTrue("token 'S' matched in '사이즈S'", containsToken("사이즈S", "S"));
  checkTrue("token 'S' matched in 'Ranger (S)'", containsToken("Zeagle Ranger (S)", "S"));
  checkTrue("token 'M' not matched inside 'MK3'", !containsToken("MK3", "M"));
  check("19-KR 화이트/M accepted", checkOption(byId("19-KR").option, "화이트 / M").ok, true);
  checkTrue("13-KR Peregrine TX rejected as other variant", !checkOption(byId("13-KR").option, "Shearwater Peregrine TX 블랙").ok);

  // ------------------------------------------- price change detection
  {
    const t = byId("19-KR");
    const a = applyReading(t, undefined, okKr19(1_250_000), T0);
    check("first read -> first_success", a.event.type, "first_success");
    check("records price/currency/at", [a.state.lastSuccess?.price, a.state.lastSuccess?.currency, a.state.lastSuccess?.at], [1250000, "KRW", T0.toISOString()]);
    check("records specified option label", a.state.optionLabel, "화이트 / M");

    const b = applyReading(t, a.state, okKr19(1_250_000), T1);
    check("same price -> unchanged", b.event.type, "unchanged");
    check("unchanged still refreshes last success time", b.state.lastSuccess?.at, T1.toISOString());
    check("no price change logged", b.state.priceChanges.length, 0);

    const c = applyReading(t, b.state, okKr19(1_190_000), T2);
    check("new price -> price_changed", c.event, { id: "19-KR", type: "price_changed", from: 1250000, to: 1190000, currency: "KRW" });
    check("price change logged", c.state.priceChanges, [{ at: T2.toISOString(), from: 1250000, to: 1190000 }]);
  }

  // ------------------------------------------------ page read failure
  {
    const t = byId("18-JP");
    const ok: PageReading = { ok: true, price: 64_900, currency: "JPY", basis: "listed_price", observedOptionText: "S | Zeagle Ranger", quantity: 1, source: "json-ld" };
    const s0 = applyReading(t, undefined, ok, T0).state;
    const f = applyReading(t, s0, { ok: false, reason: "http_status", detail: "HTTP 503" }, T1);
    check("failure event", f.event.type, "failed");
    check("last success price/time preserved", [f.state.lastSuccess?.price, f.state.lastSuccess?.at], [64900, T0.toISOString()]);
    check("failure time and reason recorded", f.state.lastFailure, { at: T1.toISOString(), reason: "http_status", detail: "HTTP 503" });
    check("lastAttemptOk=false", f.state.lastAttemptOk, false);
    checkTrue("event message mentions preserved price", formatEvent(f.event).includes("64,900") && formatEvent(f.event).includes("보존"));

    const r = applyReading(t, f.state, ok, T2);
    check("recovery -> unchanged vs preserved price", r.event.type, "unchanged");
    check("last failure kept as history after recovery", r.state.lastFailure?.at, T1.toISOString());

    const never = applyReading(t, undefined, { ok: false, reason: "fetch_failed", detail: "timeout" }, T0);
    check("failure with no prior success -> lastSuccess stays null", never.state.lastSuccess, null);
  }
  {
    // reader throws -> treated as fetch_failed, other links still processed
    const t13 = byId("13-JP");
    const t19 = byId("19-JP");
    const reader = async (t: PriceTarget): Promise<PageReading> => {
      if (t.id === "13-JP") throw new Error("net::ERR_TUNNEL_CONNECTION_FAILED\nstack...");
      return { ok: true, price: 98_000, currency: "JPY", basis: "listed_price", observedOptionText: "ホワイト | M | Mares Prestige SLS", quantity: 1, source: "json-ld" };
    };
    const prev: Record<string, LinkState> = {
      "13-JP": applyReading(t13, undefined, { ok: true, price: 70_000, currency: "JPY", basis: "listed_price", observedOptionText: "Peregrine ブラック", quantity: 1, source: "json-ld" }, T0).state,
    };
    const { state, events } = await runRefresh([t13, t19], prev, reader, () => T1);
    check("thrown reader -> fetch_failed with first line only", events[0], {
      id: "13-JP",
      type: "failed",
      reason: "fetch_failed",
      detail: "net::ERR_TUNNEL_CONNECTION_FAILED",
      preservedPrice: 70000,
      preservedAt: T0.toISOString(),
    });
    check("13-JP keeps 70,000 JPY", state["13-JP"].lastSuccess?.price, 70000);
    check("19-JP still processed", events[1].type, "first_success");
  }

  // --------------------------------------------------- option mismatch
  {
    const t = byId("19-KR");
    const s0 = applyReading(t, undefined, okKr19(1_250_000), T0).state;
    const wrongColor = applyReading(t, s0, okKr19(1_180_000, "블랙 | M | Mares Prestige SLS"), T1);
    check("black instead of white -> option_mismatch", wrongColor.event.type === "failed" && wrongColor.event.reason, "option_mismatch");
    check("mismatched price NOT stored", wrongColor.state.lastSuccess?.price, 1250000);
    check("no price change logged for mismatched option", wrongColor.state.priceChanges.length, 0);

    const wrongSize = applyReading(t, s0, okKr19(1_250_000, "화이트 | L | Mares Prestige SLS"), T1);
    check("size L instead of M -> option_mismatch", wrongSize.event.type === "failed" && wrongSize.event.reason, "option_mismatch");

    const tx = applyReading(byId("13-KR"), undefined, { ok: true, price: 900_000, currency: "KRW", basis: "listed_price", observedOptionText: "Peregrine TX 블랙", quantity: 1, source: "json-ld" }, T0);
    check("Peregrine TX page -> option_mismatch", tx.event.type === "failed" && tx.event.reason, "option_mismatch");
  }

  // ------------------------------- other validations (not overwritten)
  {
    const t = byId("18-KR");
    const listed: PageReading = { ok: true, price: 580_000, currency: "KRW", basis: "listed_price", observedOptionText: "S | Zeagle Ranger", quantity: 1, source: "json-ld" };
    const r = applyReading(t, undefined, listed, T0);
    check("KR #18 read from listed price instead of 총 상품금액 -> price_basis_mismatch", r.event.type === "failed" && r.event.reason, "price_basis_mismatch");
    const q2 = applyReading(t, undefined, { ...listed, basis: "total_product_amount", quantity: 2 }, T0);
    check("quantity 2 -> quantity_mismatch", q2.event.type === "failed" && q2.event.reason, "quantity_mismatch");
    const jpy = applyReading(t, undefined, { ...listed, basis: "total_product_amount", currency: "JPY" }, T0);
    check("wrong currency -> currency_mismatch", jpy.event.type === "failed" && jpy.event.reason, "currency_mismatch");
  }

  // ------------------------------------------------ text extraction
  check("총 상품금액 with amount and (1개)", extractTotalProductAmount("총 상품금액(수량) : 1,250,000원 (1개)"), { price: 1250000, quantity: 1 });
  check("총 상품금액 0원 (nothing selected) -> not found", extractTotalProductAmount("총 상품금액 0원"), undefined);
  check("no label -> not found", extractTotalProductAmount("판매가 1,250,000원"), undefined);
  check(
    "JSON-LD offer price/currency",
    extractListedPrice(`<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"98000","priceCurrency":"JPY"}}</script>`),
    { price: 98000, currency: "JPY", source: "json-ld" },
  );
  check("itemprop price", extractListedPrice(`<meta itemprop="price" content="64900"><meta itemprop="priceCurrency" content="JPY">`), {
    price: 64900,
    currency: "JPY",
    source: "itemprop",
  });
  check("no price markup -> undefined", extractListedPrice("<html><body>no price</body></html>"), undefined);

  // ---------------------------------------------- output path safety
  const dir = mkdtempSync(join(tmpdir(), "diving-price-refresh-test-"));
  try {
    checkTrue("default output dir is separate (local-results/diving-price-refresh)", DEFAULT_OUT_DIR.replace(/\\/g, "/").endsWith("local-results/diving-price-refresh"));
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
    const { state } = await runRefresh([byId("19-KR")], {}, async () => okKr19(1_250_000), () => T0);
    saveJson(statePath, state);
    check("state round-trips through disk", loadState(statePath)["19-KR"].lastSuccess?.price, 1250000);
    checkTrue("saved file keeps option label, currency and success time", /"optionLabel": "화이트 \/ M"/.test(readFileSync(statePath, "utf-8")));

    // ------------------------------ browser reader on a local fixture
    let browser: any;
    try {
      browser = await createRequire(import.meta.url)("playwright").chromium.launch();
    } catch {
      browser = undefined;
    }
    if (!browser) {
      console.log("SKIP browser fixture (playwright unavailable)");
    } else {
      try {
        const page = join(dir, "kr19.html");
        writeFileSync(
          page,
          `<html><head><title>마레스 Mares Prestige SLS BCD</title></head><body><h1>Mares Prestige SLS</h1>
          <select id="c"><option value="">- 색상 -</option><option value="bk">블랙</option><option value="wh">화이트</option></select>
          <select id="s"><option value="">- 사이즈 -</option><option value="s">S</option><option value="m">M</option><option value="l" disabled>L [품절]</option></select>
          <div id="t">총 상품금액 <strong id="sum">0원</strong></div>
          <script>
            const upd = () => { const ok = c.value && s.value; sum.textContent = ok ? (1250000 + (s.value==='m'?10000:0)).toLocaleString('ko-KR') + '원 (1개)' : '0원'; };
            c.onchange = upd; s.onchange = upd;
          </script></body></html>`,
        );
        const t19 = { ...byId("19-KR"), url: `file://${page}` };
        const r = await readPage(browser, t19);
        check("fixture page: selects 화이트+M and reads 총 상품금액", r.ok ? [r.price, r.basis, r.quantity] : r, [1260000, "total_product_amount", 1]);
        check("fixture page: reading passes option validation", applyReading(t19, undefined, r, T0).event.type, "first_success");

        const r18 = await readPage(browser, { ...byId("18-KR"), url: `file://${page}`, option: { label: "XL", axes: [{ axis: "size", accept: ["XL"], select: true }], reject: [] } });
        check("fixture page: missing option value -> option_value_not_found", r18.ok ? "ok" : r18.reason, "option_value_not_found");

        const missing = await readPage(browser, { ...t19, url: `file://${join(dir, "nope.html")}` });
        check("fixture page: unreadable page -> fetch_failed", missing.ok ? "ok" : missing.reason, "fetch_failed");
      } finally {
        await browser.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
