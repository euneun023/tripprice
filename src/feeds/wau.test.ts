import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCsv, writeCsv, type CsvRow } from "./csv";
import { auditWau, FEED_HEADERS, REVIEW_HEADERS, validGtin } from "./wau";

function fixtures(): [CsvRow[], CsvRow[], CsvRow[]] {
  const kr = Object.fromEntries(FEED_HEADERS.map(h => [h, ""]));
  Object.assign(kr, { advertiser_id: "124878", id: "synthetic-1", title: "Synthetic device", brand: "WAU", gtin: "4006381333931", mpn: "TEST-1", link: "https://wauglobal.com/ko/products/synthetic", price: "10000 KRW", sale_price: "9000 KRW", availability: "in_stock", condition: "new" });
  const jp = { ...kr, link: "https://wauglobal.com/ja/products/synthetic", price: "1000 JPY", sale_price: "900 JPY" };
  const review = Object.fromEntries(REVIEW_HEADERS.map(h => [h, ""]));
  Object.assign(review, { '상품 ID': kr.id, GTIN: kr.gtin, '모델번호': kr.mpn, '한국 피드 적용가(KRW)': "9000", '일본 피드 적용가(JPY)': "900", '한국 공식 표시가(KRW)': "8900", '일본 공식 표시가(JPY)': "910", '한국 상품 상태': "구매 버튼 확인", '일본 상품 상태': "구매 버튼 확인", '한국 피드 상품 링크': kr.link, '일본 피드 상품 링크': jp.link, '확인일(KST)': "2026-11-20" });
  return [[kr], [jp], [review]];
}
const run = (f = fixtures(), date = "2026-11-20") => auditWau(...f, date)[0];

test("CSV handles BOM, escaped quotes, commas, embedded newlines and CRLF", () => {
  assert.deepEqual(parseCsv('\uFEFFid,title\r\n1,"a, ""b""\nline"\r\n'), [{ id: "1", title: 'a, "b"\nline' }]);
  for (const text of ['id,id\n1,2', 'id,title\n1', 'id\n"open', 'id\n"a"x', 'id\na"b']) assert.throws(() => parseCsv(text));
});
test("spreadsheet formulas are neutralized and numeric deltas preserved", () => {
  const rows = parseCsv(writeCsv(["title", "delta"], [{ title: " =1+1", delta: -10 }]));
  assert.equal(rows[0].title, "' =1+1"); assert.equal(rows[0].delta, "-10");
});
test("GTIN checksums and lengths", () => {
  assert.equal(validGtin("4006381333931"), true);
  for (const value of ["4006381333932", "", "123", "4e06381333931"]) assert.equal(validGtin(value), false);
});
test("verified supplied observation retains feed price discrepancy; publication always blocked", () => {
  const row = run(); assert.equal(row.match, "GTIN_AND_FEED_ID");
  assert.equal(row.krPriceDelta, -100); assert.equal(row.jpPriceDelta, 10);
  assert.equal(row.snapshotVerified, true); assert.ok(row.issues.includes("FEED_PRICE_MISMATCH"));
  assert.equal(row.publicationAllowed, false); assert.equal(row.shippingStatus, "unknown");
});
test("missing observed price is unknown rather than a price mismatch", () => {
  const f = fixtures(); f[2][0]['한국 공식 표시가(KRW)'] = "";
  f[2][0]['일본 공식 표시가(JPY)'] = "900";
  const row = run(f); assert.equal(row.krPriceDelta, null);
  assert.ok(row.issues.includes("MISSING_OBSERVED_PRICE")); assert.ok(!row.issues.includes("FEED_PRICE_MISMATCH"));
});
test("catalog price and feed stock do not prove purchasability", () => {
  const f = fixtures(); f[2][0]['일본 상품 상태'] = "공식 카탈로그에 가격 표시";
  const row = run(f); assert.equal(row.jpAvailability, null); assert.equal(row.snapshotVerified, false);
});
test("sold out/404 overrides feed stock and blocks snapshot verification", () => {
  const f = fixtures(); f[2][0]['일본 상품 상태'] = "피드 링크 404 · 대체 페이지 품절";
  const row = run(f); assert.equal(row.jpAvailability, false);
  for (const issue of ["BROKEN_FEED_LINK", "OUT_OF_STOCK", "FEED_STOCK_CONTRADICTION"]) assert.ok(row.issues.includes(issue));
  assert.equal(row.snapshotVerified, false);
});
test("duplicates abort; missing locale/review records remain visible", () => {
  const f = fixtures(); f[0].push({ ...f[0][0] }); assert.throws(() => run(f));
  const g = fixtures(); g[1][0].id = "orphan";
  assert.equal(auditWau(...g, "2026-11-20").length, 2);
  assert.ok(run(g).issues.includes("MISSING_LOCALE_OR_REVIEW"));
});
test("conflicting GTIN, MPN, brand, variant and condition fail closed", () => {
  for (const field of ["gtin", "mpn", "brand", "size", "color", "condition", "advertiser_id"]) {
    const f = fixtures(); f[1][0][field] = "different";
    assert.equal(run(f).snapshotVerified, false); assert.ok(run(f).issues.includes("IDENTITY_CONFLICT"));
  }
});
test("identifier hierarchy never promotes ID alone to verified", () => {
  const f = fixtures(); f[0][0].gtin = f[1][0].gtin = f[2][0].GTIN = "";
  assert.equal(run(f).match, "BRAND_MPN_AND_FEED_ID");
  f[0][0].mpn = f[1][0].mpn = f[2][0]['모델번호'] = "";
  assert.equal(run(f).match, "FEED_ID_ONLY"); assert.equal(run(f).snapshotVerified, false);
});
test("malformed/wrong-currency/zero prices and promotion windows block", () => {
  for (const value of ["NaN KRW", "0 KRW", "100 JPY", "1e4 KRW", "-1 KRW"]) {
    const f = fixtures(); f[0][0].sale_price = value;
    assert.equal(run(f).krFeedPrice, null); assert.equal(run(f).snapshotVerified, false);
  }
  const f = fixtures(); f[0][0].sale_price_effective_date = "2026-11-01/2026-12-01";
  assert.ok(run(f).issues.includes("SALE_WINDOW_REQUIRES_REVIEW"));
});
test("evidence URL, price and identifier drift require recheck", () => {
  for (const field of ["GTIN", "모델번호", "한국 피드 상품 링크", "한국 피드 적용가(KRW)"]) {
    const f = fixtures(); f[2][0][field] = "different";
    assert.equal(run(f).snapshotVerified, false);
  }
  const f = fixtures(); f[0][0].link = "javascript:alert(1)";
  assert.ok(run(f).issues.includes("INVALID_SOURCE_URL"));
});
test("generic merchant URLs are valid but never prove locale or market", () => {
  const f = fixtures(); f[0][0].link = f[2][0]['한국 피드 상품 링크'] = "https://wauglobal.com/products/synthetic";
  const row = run(f); assert.ok(row.issues.includes("LOCALE_LINK_UNCONFIRMED"));
  assert.ok(!row.issues.includes("INVALID_SOURCE_URL")); assert.equal(row.snapshotVerified, false);
});
test("manual exclusion cannot be overturned by available buttons", () => {
  const f = fixtures(); f[2][0]['비교 처리'] = "가격 비교 후보에서 제외";
  assert.equal(run(f).snapshotVerified, false); assert.ok(run(f).issues.includes("MANUAL_EXCLUSION"));
});
test("future, malformed and historical evidence is never current verified", () => {
  for (const value of ["2026-11-21", "2026-02-30", "yesterday"]) {
    const f = fixtures(); f[2][0]['확인일(KST)'] = value; assert.equal(run(f).snapshotVerified, false);
  }
  assert.ok(run(fixtures(), "2026-11-21").issues.includes("HISTORICAL_EVIDENCE_RECHECK"));
  assert.throws(() => run(fixtures(), "bad-date"));
});
test("CLI produces a complete local partition and refuses overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "wau-test-"));
  try {
    const data = fixtures();
    const paths = data.map((rows, i) => {
      const path = join(dir, `${i}.csv`); writeFileSync(path, writeCsv(Object.keys(rows[0]), rows)); return path;
    });
    const output = join(dir, "result");
    const args = ["--import", "tsx", fileURLToPath(new URL("../scripts/audit-wau.ts", import.meta.url)), ...paths, output, "2026-11-20"];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
    assert.equal(summary.total, 1); assert.equal(summary.snapshotVerified, 1); assert.equal(summary.publicationAllowed, 0);
    assert.equal(parseCsv(readFileSync(join(output, "verified-products.csv"), "utf8")).length, 1);
    assert.equal(parseCsv(readFileSync(join(output, "problem-products.csv"), "utf8")).length, 0);
    assert.equal(summary.inputs.length, 3); assert.match(summary.inputs[0].sha256, /^[a-f0-9]{64}$/);
    const before = readFileSync(join(output, "summary.json"), "utf8");
    assert.notEqual(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
    assert.equal(readFileSync(join(output, "summary.json"), "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
