/**
 * Offline regression tests for compare-kr-jp-sample10.ts - no network, no
 * file I/O beyond what the test itself constructs in memory. Run
 * directly:
 *   npx tsx src/scripts/compare-kr-jp-sample10.test.ts
 */
import {
  compareOptionAxes,
  compareRow,
  buildReport,
  reclassifyKr,
  reclassifyJp,
  type KrResultEntry,
  type JpResultEntry,
} from "./compare-kr-jp-sample10";
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
  // reclassifyKr/reclassifyJp - always trust the CURRENT classifier over
  // whatever classification was stored in the file
  // ============================================================
  {
    // A stale/wrong classification in the file ("EXACT_CANDIDATE") must
    // be overridden by what the current classifier actually says for
    // this productName (a replacement-eartip phrase -> REJECTED_ACCESSORY).
    const stale: KrResultEntry = { n: 7, classification: "EXACT_CANDIDATE", productName: "OnePlus Buds Pro 3 교체용 폼 이어팁" };
    const fresh = reclassifyKr(stale);
    check("reclassifyKr overrides a stale classification using the current classifier", fresh.classification, "REJECTED_ACCESSORY");
    checkTrue("reclassifyKr fills in reviewReason", (fresh.reviewReason?.length ?? 0) > 0);

    const staleJp: JpResultEntry = { n: 7, classification: "EXACT_CANDIDATE", itemName: "ワンプラス Buds Pro3 イヤーピース 交換用" };
    const freshJp = reclassifyJp(staleJp);
    check("reclassifyJp overrides a stale classification using the current classifier", freshJp.classification, "REJECTED_ACCESSORY");

    // No productName/itemName at all -> no-op (nothing to recompute from).
    const noName: KrResultEntry = { n: 4, classification: "EXACT_CANDIDATE" };
    check("reclassifyKr is a no-op when productName is missing", reclassifyKr(noName).classification, "EXACT_CANDIDATE");
  }

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
  }
  {
    const item = itemByN(4); // Sony FE 24mm F1.4 GM - no hardOptionGroups at all
    const axes = compareOptionAxes(item, ["anything"], ["anything"]);
    check("item with no hardOptionGroups -> empty axis list (해당없음)", axes, []);
  }

  // ============================================================
  // compareRow - the 4-way status (자동 동일 모델 후보/검수필요/불일치/데이터없음)
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
    check("both EXACT, no option axis -> 자동 동일 모델 후보 (NOT '확정' - human still needs to verify)", row.status, "자동 동일 모델 후보");
    checkTrue("bothPricesPresent is true (both prices in the data)", row.bothPricesPresent);
    checkTrue("but finalVerified is false - no human has verified yet (humanVerified unset)", !row.finalVerified);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ humanVerified: true }), exactJp({ humanVerified: true }));
    check("자동 동일 모델 후보 + both humanVerified=true -> finalVerified true", row.finalVerified, true);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ humanVerified: true }), exactJp({ humanVerified: false }));
    checkTrue("finalVerified requires BOTH sides verified, not just one", !row.finalVerified);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ priceKrw: undefined, salePriceKrw: undefined }), exactJp());
    checkTrue("bothPricesPresent is false when one side's price is missing, even if status is still 자동 동일 모델 후보", !row.bothPricesPresent);
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ classification: "NEEDS_REVIEW" }), exactJp());
    check("KR NEEDS_REVIEW -> row downgraded to 검수 필요, not silently 자동 동일 모델 후보", row.status, "검수 필요");
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr({ classification: "REJECTED_ACCESSORY" }), exactJp());
    check("KR REJECTED_ACCESSORY -> 불일치 (KR side isn't even the product)", row.status, "불일치");
  }
  {
    const item = itemByN(4);
    const row = compareRow(item, exactKr(), undefined);
    check("missing JP entry -> 데이터없음 (never fabricated, never silently 불일치)", row.status, "데이터없음");
  }

  // ---- requirement: JP REJECTED_ACCESSORY must be reported even with NO
  // KR data at all, not swallowed into generic 데이터없음 ----
  {
    const item = itemByN(7); // OnePlus Buds Pro 3
    const jpAccessory: JpResultEntry = { n: 7, classification: "REJECTED_ACCESSORY", itemName: "..." };
    const row = compareRow(item, undefined, jpAccessory);
    check("JP REJECTED_ACCESSORY with NO KR data at all -> 불일치, not 데이터없음", row.status, "불일치");
    checkTrue("the reason names it's the JP side specifically", row.reasons.some((r) => r.includes("JP") && r.includes("REJECTED_ACCESSORY")));
  }

  // ---- hardOptionGroups items: 자동 동일 모델 후보 requires the axis to
  // actually match, not just both classifications being EXACT ----
  {
    const item = itemByN(1); // FUJIFILM X-T50, color axis
    const krBase: KrResultEntry = {
      n: 1,
      classification: "NEEDS_REVIEW",
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
    const matched = compareRow(item, krBase, jpBase);
    check("matching option axis alone does not override each side's own NEEDS_REVIEW classification", matched.status, "검수 필요");

    const differentColor = compareRow(item, krBase, { ...jpBase, detectedOptionHints: ["color:ブラック"] });
    check("KR silver vs JP black -> 불일치 (모델·세대·마운트·색상·구성 불일치는 절대 자동 확정 안 함)", differentColor.status, "불일치");

    const noJpColor = compareRow(item, krBase, { ...jpBase, detectedOptionHints: [] });
    check("JP never detected a color at all -> 검수 필요 (unconfirmed, not assumed matching)", noJpColor.status, "검수 필요");
  }

  // ============================================================
  // buildReport / summarize - end-to-end over the full 10-item set
  // ============================================================
  {
    const krEntries: KrResultEntry[] = [exactKr({ n: 4, humanVerified: true })];
    const jpEntries: JpResultEntry[] = [
      exactJp({ n: 4, humanVerified: true }),
      { n: 7, itemName: "ワンプラス Buds Pro3 イヤーピース 交換用セット" }, // reclassified to REJECTED_ACCESSORY from this raw name
    ];
    const summary = buildReport(krEntries, jpEntries);
    check("buildReport produces exactly 10 rows (one per SELECTED_ITEMS entry)", summary.rows.length, 10);
    check("only n=4 is 자동 동일 모델 후보", summary.autoCandidateCount, 1);
    check("n=4 is also finalVerified (both sides humanVerified)", summary.finalVerifiedCount, 1);
    check("n=7 (JP accessory-only, no KR data) counted in jpRejectedAccessoryWithoutKr", summary.jpRejectedAccessoryWithoutKr, 1);
    check("n=7 also counts toward 불일치", summary.mismatch, 1);
    check("the other 8 (no data supplied) are 데이터없음", summary.noData, 8);
    check("양국 가격 필드 확보 수 (data presence) is 1", summary.bothPricesPresentCount, 1);
  }

  // ============================================================
  // Cross-source MISMATCH regression: #2 body-only vs lens-kit, #5 Sony
  // FE vs Nikon Z mount - real reported false positives, now resolved at
  // compare time (not just within a single side's own classification).
  // ============================================================
  {
    const krEntries: KrResultEntry[] = [{ n: 2, productName: "후지필름 X-H2 + XF 16-80mm 렌즈킷", priceKrw: 2890000 }];
    const jpEntries: JpResultEntry[] = [{ n: 2, itemName: "フジフイルム X-H2 ボディ単品", priceJpy: 228000 }];
    const row = buildReport(krEntries, jpEntries).rows.find((r) => r.item.n === 2)!;
    check("#2 KR=렌즈킷(kit) vs JP=ボディ単品(body) -> 불일치, not 자동 동일 모델 후보", row.status, "불일치");
    checkTrue("the reason names the config axis conflict", row.reasons.some((r) => r.includes("config")));
  }
  {
    const krEntries: KrResultEntry[] = [{ n: 5, productName: "탐론 12-20mm F2.8 Di III-A RXD Sony FE용", priceKrw: 1190000 }];
    const jpEntries: JpResultEntry[] = [{ n: 5, itemName: "タムロン 12-20mm F2.8 Di III-A RXD ニコンZマウント", priceJpy: 98000 }];
    const row = buildReport(krEntries, jpEntries).rows.find((r) => r.item.n === 5)!;
    check("#5 KR='Sony FE' vs JP='ニコンZマウント' -> 불일치 (명백한 마운트 불일치), not 검수 필요", row.status, "불일치");
    checkTrue("the reason names the mount axis conflict", row.reasons.some((r) => r.includes("mount")));
  }

  // ============================================================
  // Requirement 5 safety check at the ROW level (not just classifyCandidate):
  // #3 Canon, #4 Sony 24mm, #6 Sony 70-200mm reach 자동 동일 모델 후보
  // when both sides are clean, unaffected by this review's fixes.
  // ============================================================
  {
    const krEntries: KrResultEntry[] = [
      { n: 3, productName: "캐논 EOS R6 Mark II 바디", priceKrw: 3190000 },
      { n: 4, productName: "소니 FE 24mm F1.4 GM SEL24F14GM 정품", priceKrw: 2390000 },
      { n: 6, productName: "소니 FE 70-200mm F2.8 GM OSS II", priceKrw: 3690000 },
    ];
    const jpEntries: JpResultEntry[] = [
      { n: 3, itemName: "キヤノン EOS R6 Mark II ボディ", priceJpy: 268000 },
      { n: 4, itemName: "ソニー FE 24mm F1.4 GM SEL24F14GM", priceJpy: 198000 },
      { n: 6, itemName: "ソニー FE 70-200mm F2.8 GM OSS II", priceJpy: 298000 },
    ];
    const summary = buildReport(krEntries, jpEntries);
    for (const n of [3, 4, 6]) {
      const row = summary.rows.find((r) => r.item.n === n)!;
      check(`#${n} still reaches 자동 동일 모델 후보 with clean data - no regression from this review's fixes`, row.status, "자동 동일 모델 후보");
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
