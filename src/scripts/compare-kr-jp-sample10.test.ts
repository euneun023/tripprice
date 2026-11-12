/**
 * Offline regression tests for compare-kr-jp-sample10.ts - no network, no
 * file I/O beyond what the test itself constructs in memory. Run
 * directly:
 *   npx tsx src/scripts/compare-kr-jp-sample10.test.ts
 */
import { compareOptionAxes, compareRow, buildReport, type KrResultEntry, type JpResultEntry } from "./compare-kr-jp-sample10";
import { SELECTED_ITEMS } from "./supply-11st-sample10";

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

function itemByN(n: number) {
  const item = SELECTED_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no SELECTED_ITEMS entry for n=${n}`);
  return item;
}

function main() {
  // ============================================================
  // compareOptionAxes - cross-language canonicalization
  // ============================================================
  {
    const item = itemByN(1); // FUJIFILM X-T50, color axis
    const match = compareOptionAxes(item, ["color:실버"], ["color:シルバー"]);
    check("KR '실버' and JP 'シルバー' canonicalize to the same value -> 일치", match[0].status, "일치");

    const mismatch = compareOptionAxes(item, ["color:실버"], ["color:ブラック"]);
    check("KR silver vs JP black -> 불일치 (positive disagreement)", mismatch[0].status, "불일치");

    const oneSided = compareOptionAxes(item, ["color:실버"], []);
    check("JP side never detected a color -> 미확인, not assumed matching", oneSided[0].status, "미확인");

    const neitherSided = compareOptionAxes(item, [], []);
    check("neither side detected anything -> 미확인", neitherSided[0].status, "미확인");
  }
  {
    const item = itemByN(5); // Tamron 12-20mm F2.8, mount axis
    const match = compareOptionAxes(item, ["mount:니콘Z"], ["mount:ニコンZ"]);
    check("KR '니콘Z' and JP 'ニコンZ' canonicalize to the same mount -> 일치", match[0].status, "일치");
    const mismatch = compareOptionAxes(item, ["mount:니콘Z"], ["mount:ソニーE"]);
    check("KR Nikon Z vs JP Sony E mount -> 불일치", mismatch[0].status, "불일치");
  }
  {
    const item = itemByN(4); // Sony FE 24mm F1.4 GM - no hardOptionGroups at all
    const axes = compareOptionAxes(item, ["anything"], ["anything"]);
    check("item with no hardOptionGroups -> empty axis list (해당없음)", axes, []);
  }

  // ============================================================
  // compareRow - the 4-way classification (확정/검수필요/불일치/데이터없음)
  // ============================================================
  const exactKr = (overrides: Partial<KrResultEntry> = {}): KrResultEntry => ({
    n: 4,
    classification: "EXACT_CANDIDATE",
    productName: "소니 FE 24mm F1.4 GM 정품",
    seller: "11번가 공식스토어",
    priceKrw: 2390000,
    salePriceKrw: 2190000,
    url: "https://11st.co.kr/x",
    ...overrides,
  });
  const exactJp = (overrides: Partial<JpResultEntry> = {}): JpResultEntry => ({
    n: 4,
    classification: "EXACT_CANDIDATE",
    itemName: "ソニー FE 24mm F1.4 GM SEL24F14GM",
    shop: "ソニーストア楽天市場店",
    priceJpy: 198000,
    availability: 1,
    url: "https://rakuten.co.jp/x",
    ...overrides,
  });

  {
    const item = itemByN(4); // no hardOptionGroups
    const row = compareRow(item, exactKr(), exactJp());
    check("both EXACT, no option axis, both prices present -> 동일 상품 확정", row.status, "동일 상품 확정");
    checkTrue("bothPricesConfirmed is true", row.bothPricesConfirmed);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ priceKrw: undefined, salePriceKrw: undefined }), exactJp());
    check("동일 상품 확정 but KR price missing -> still 확정 (identity != price availability)", row.status, "동일 상품 확정");
    checkTrue("bothPricesConfirmed is false when one side's price is missing", !row.bothPricesConfirmed);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ classification: "NEEDS_REVIEW" }), exactJp());
    check("KR NEEDS_REVIEW -> row downgraded to 검수 필요, not silently 확정", row.status, "검수 필요");
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ classification: "REJECTED_ACCESSORY" }), exactJp());
    check("KR REJECTED_ACCESSORY -> 불일치 (KR side isn't even the product)", row.status, "불일치");
    checkTrue("bothPricesConfirmed is false for a 불일치 row", !row.bothPricesConfirmed);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr(), undefined);
    check("missing JP entry -> 데이터없음 (never fabricated, never silently 불일치)", row.status, "데이터없음");
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, undefined, undefined);
    check("both sides missing -> 데이터없음", row.status, "데이터없음");
  }

  // ---- hardOptionGroups items: 확정 requires the axis to actually match,
  // not just both classifications being EXACT ----
  {
    const item = itemByN(1); // FUJIFILM X-T50, color axis
    const krBase: KrResultEntry = {
      n: 1,
      classification: "NEEDS_REVIEW", // X-T50 always caps at NEEDS_REVIEW per supply-11st-sample10.ts
      productName: "후지필름 X-T50 실버",
      priceKrw: 1890000,
      detectedOptionHints: ["color:실버"],
    };
    const jpBase: JpResultEntry = {
      n: 1,
      classification: "NEEDS_REVIEW",
      itemName: "フジフイルム X-T50 シルバー",
      priceJpy: 158000,
      detectedOptionHints: ["color:シルバー"],
    };
    // Conservative by design: even though the option axis itself matches
    // (both sides detected "silver"), each side's OWN classification is
    // still NEEDS_REVIEW (hardOptionGroups items can never self-classify
    // EXACT_CANDIDATE - see supply-11st-sample10.ts) and NEEDS_REVIEW can
    // also stem from reasons unrelated to the axis (e.g. an exclude-term
    // flag) that this comparator has no way to distinguish from the
    // classification label alone - so the row stays 검수 필요, a human
    // still makes the final call. The matching axis is still surfaced in
    // optionAxes (checked below) as a strong supporting signal.
    const matched = compareRow(item, krBase, jpBase);
    check("matching option axis alone does not override each side's own NEEDS_REVIEW classification", matched.status, "검수 필요");
    checkTrue("bothPricesConfirmed stays false outside of 동일 상품 확정", !matched.bothPricesConfirmed);
    check("the matching color axis is still surfaced for the human reviewer", matched.optionAxes[0]?.status, "일치");

    const differentColor = compareRow(item, krBase, { ...jpBase, detectedOptionHints: ["color:ブラック"] });
    check("KR silver vs JP black -> 불일치", differentColor.status, "불일치");

    const noJpColor = compareRow(item, krBase, { ...jpBase, detectedOptionHints: [] });
    check("JP never detected a color at all -> 검수 필요 (unconfirmed, not assumed matching)", noJpColor.status, "검수 필요");
  }

  // ============================================================
  // buildReport / summarize - end-to-end over the full 10-item set
  // ============================================================
  {
    const krEntries: KrResultEntry[] = [exactKr({ n: 4 })];
    const jpEntries: JpResultEntry[] = [exactJp({ n: 4 })];
    const summary = buildReport(krEntries, jpEntries);
    check("buildReport produces exactly 10 rows (one per SELECTED_ITEMS entry)", summary.rows.length, 10);
    check("only the one supplied item (n=4) is 동일 상품 확정", summary.confirmed, 1);
    check("the other 9 (no data supplied for them) are 데이터없음", summary.noData, 9);
    check("headline KPI (both prices confirmed) is 1", summary.bothPricesConfirmedCount, 1);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
