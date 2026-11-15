/**
 * Offline regression tests for compare-kr-jp-diving12.ts - no network.
 * Run directly:
 *   npx tsx src/scripts/compare-kr-jp-diving12.test.ts
 */
import { buildDivingReport } from "./compare-kr-jp-diving12";
import { compareOptionAxes, rowStatusLabel } from "./compare-kr-jp-sample10";
import { SELECTED_DIVING_ITEMS } from "./supply-diving-sample12";
import type { KrResultEntry, JpResultEntry } from "./compare-kr-jp-sample10";

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
  const item = SELECTED_DIVING_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no item n=${n}`);
  return item;
}

function main() {
  // ============================================================
  // Cross-language canon for the new diving axes
  // ============================================================
  {
    const item = itemByN(16); // regulator: connection + stage_config
    const match = compareOptionAxes(item, ["connection:DIN"], ["connection:DIN"]);
    check("KR/JP both 'DIN' -> 일치", match[0].status, "일치");
    const mismatch = compareOptionAxes(item, ["connection:DIN"], ["connection:요크"]);
    check("KR DIN vs JP 요크(yoke) -> 불일치", mismatch[0].status, "불일치");
    const stageMatch = compareOptionAxes(item, ["stage_config:풀세트"], ["stage_config:フルセット"]);
    check("KR '풀세트' and JP 'フルセット' canonicalize to the same stage_set value -> 일치", stageMatch[1].status, "일치");
  }
  {
    const item = itemByN(24); // wetsuit: size + gender
    const sizeMatch = compareOptionAxes(item, ["size:사이즈M"], ["size:Mサイズ"]);
    check("KR '사이즈M' and JP 'Mサイズ' canonicalize to the same size value -> 일치", sizeMatch[0].status, "일치");
    const genderMismatch = compareOptionAxes(item, ["gender:여성용"], ["gender:メンズ"]);
    check("KR 여성용(women) vs JP メンズ(men) -> 불일치", genderMismatch[1].status, "불일치");
  }
  {
    const item = itemByN(20); // fins: size + color
    const colorMatch = compareOptionAxes(item, ["color:블루"], ["color:ブルー"]);
    check("KR 블루 and JP ブルー canonicalize to the same color -> 일치", colorMatch[1].status, "일치");
  }

  // ============================================================
  // buildDivingReport - end-to-end over the real 12-item set, reusing
  // compare-kr-jp-sample10.ts's buildReport unchanged (parameterized)
  // ============================================================
  {
    const krEntries: KrResultEntry[] = [
      { n: 14, productName: "가민 Garmin Descent Mk3s 다이빙 컴퓨터 정품", priceKrw: 950000 },
      { n: 17, productName: "오셔닉 Oceanic Zeo 레귤레이터", priceKrw: 450000 }, // #17 is a known 불일치 후보 (wrong_category) - even with clean text, this review's own classification shouldn't silently promote it past what the human review already flagged; this just confirms the comparator still runs normally end to end for it
    ];
    const jpEntries: JpResultEntry[] = [
      { n: 14, itemName: "ガーミン Garmin Descent Mk3s ダイブコンピューター", priceJpy: 187000 },
    ];
    const summary = buildDivingReport(krEntries, jpEntries);
    check("buildDivingReport produces exactly 12 rows (one per diving item)", summary.rows.length, 12);
    const row14 = summary.rows.find((r) => r.item.n === 14)!;
    check("#14 Garmin Mk3s, clean matching data on both sides -> 자동 동일 모델 후보", row14.status, "자동 동일 모델 후보");
    checkTrue("#14 both prices present", row14.bothPricesPresent);
    const row17 = summary.rows.find((r) => r.item.n === 17)!;
    check("#17 with no JP data at all -> 데이터없음 (comparator doesn't invent a JP side)", row17.status, "데이터없음");
    const row13 = summary.rows.find((r) => r.item.n === 13)!;
    check("#13 with no KR/JP data supplied at all -> 데이터없음", row13.status, "데이터없음");
  }

  // ============================================================
  // Regression: #19 Mares Prestige SLS legacy 11st save. The saved
  // entry is exactly `{ n: 19, classification: "MISMATCH" }` - no
  // productName/price/callStatus/candidates (legacy toKrResultEntry's
  // "nothing chosen" fallback). It used to be reported as "KR 본품 아님 /
  // 불일치". It must read "한국 비교 상품 없음 · 원인 미확인" and stay out
  // of the 불일치 count.
  // ============================================================
  {
    const legacy19: KrResultEntry = { n: 19, classification: "MISMATCH" };
    const jpEntries: JpResultEntry[] = [{ n: 19, itemName: "マレス Mares Prestige SLS BCD", priceJpy: 98000 }];
    const summary = buildDivingReport([legacy19], jpEntries);
    const row19 = summary.rows.find((r) => r.item.n === 19)!;
    check("#19 legacy bare-MISMATCH save -> 데이터없음 (not 불일치)", row19.status, "데이터없음");
    check("#19 KR absence cause -> unknown", row19.krAbsence?.cause, "unknown");
    check("#19 KR absence label", row19.krAbsence?.label, "한국 비교 상품 없음 · 원인 미확인");
    check("#19 reasons show the absence label only", row19.reasons, ["한국 비교 상품 없음 · 원인 미확인"]);
    checkTrue("#19 no reason claims '본품 아님'", !row19.reasons.some((r) => r.includes("본품 아님")));
    checkTrue("#19 header label shows '한국 비교 상품 없음 · 원인 미확인'", rowStatusLabel(row19).includes("한국 비교 상품 없음 · 원인 미확인"));
    check("#19 excluded from the 불일치 count", summary.mismatch, 0);
    check("#19 counted under KR 원인 미확인", summary.krNoComparableByCause.unknown, 1);
    checkTrue("#19 no both-price pair", !row19.bothPricesPresent);

    const aloneSummary = buildDivingReport([legacy19], []);
    const alone19 = aloneSummary.rows.find((r) => r.item.n === 19)!;
    check("#19 legacy save, no JP entry -> 데이터없음", alone19.status, "데이터없음");
    check("#19 legacy save, no JP entry -> reasons list both sides", alone19.reasons, ["한국 비교 상품 없음 · 원인 미확인", "JP 데이터 없음"]);
  }

  // ============================================================
  // Newer saves with callStatus: call failure / zero results / all
  // candidates rejected are shown as three different causes, and none
  // is a 불일치.
  // ============================================================
  {
    const jpEntries: JpResultEntry[] = [
      { n: 13, itemName: "シアウォーター Shearwater Peregrine ダイブコンピューター ブラック", priceJpy: 70000 },
      { n: 14, itemName: "ガーミン Garmin Descent Mk3s ダイブコンピューター", priceJpy: 187000 },
      { n: 19, itemName: "マレス Mares Prestige SLS BCD", priceJpy: 98000 },
    ];
    const krEntries: KrResultEntry[] = [
      { n: 13, callStatus: "call_failed", errorMessage: "HTTP 500", candidates: [] },
      { n: 14, callStatus: "no_results", totalCount: 0, candidates: [] },
      {
        n: 19,
        callStatus: "all_candidates_rejected",
        classification: "MISMATCH",
        candidates: [
          { productName: "마레스 Mares 다이빙 마스크", classification: "MISMATCH" },
          { productName: "마레스 Prestige SLS 인플레이터 호스", classification: "REJECTED_ACCESSORY" },
        ],
      },
    ];
    const summary = buildDivingReport(krEntries, jpEntries);
    const byN = (n: number) => summary.rows.find((r) => r.item.n === n)!;
    check("callStatus=call_failed -> 데이터없음", byN(13).status, "데이터없음");
    check("callStatus=call_failed label", byN(13).krAbsence?.label, "한국 비교 상품 없음 · 호출 실패 (HTTP 500)");
    check("callStatus=no_results -> 데이터없음", byN(14).status, "데이터없음");
    check("callStatus=no_results label", byN(14).krAbsence?.label, "한국 비교 상품 없음 · 검색 결과 0건");
    check("callStatus=all_candidates_rejected -> 데이터없음 (stored MISMATCH fallback ignored)", byN(19).status, "데이터없음");
    check(
      "callStatus=all_candidates_rejected label",
      byN(19).krAbsence?.label,
      "한국 비교 상품 없음 · 후보 2건 전부 제외 (MISMATCH 1, REJECTED_ACCESSORY 1)",
    );
    check("none of the three counted as 불일치", summary.mismatch, 0);
    check("cause breakdown", summary.krNoComparableByCause, { call_failed: 1, no_results: 1, all_candidates_rejected: 1, unknown: 0 });

    // Legacy save without callStatus but with preserved candidates -> inferred as "all rejected".
    const inferred = buildDivingReport([{ n: 19, classification: "MISMATCH", candidates: [{ productName: "x", classification: "MISMATCH" }] }], []);
    check("no callStatus + candidates -> 전부 제외", inferred.rows.find((r) => r.item.n === 19)!.krAbsence?.cause, "all_candidates_rejected");
  }

  // ============================================================
  // Real conflicts stay 불일치: an actual KR product of a different
  // model, a real option conflict, and a JP accessory even when KR has
  // only an empty legacy entry.
  // ============================================================
  {
    const wrongModel = buildDivingReport(
      [{ n: 19, productName: "마레스 Mares Quantum BCD", priceKrw: 900000, classification: "EXACT_CANDIDATE" }],
      [{ n: 19, itemName: "マレス Mares Prestige SLS BCD", priceJpy: 98000 }],
    );
    const wrong19 = wrongModel.rows.find((r) => r.item.n === 19)!;
    check("KR has a real product of a different model -> 불일치 kept", wrong19.status, "불일치");
    checkTrue("... and it is NOT reported as an absence", wrong19.krAbsence === undefined);
    check("... and it counts in 불일치", wrongModel.mismatch, 1);

    const optionConflict = buildDivingReport(
      [{ n: 16, productName: "아쿠아렁 Aqua Lung Leg3nd 레귤레이터 DIN", priceKrw: 1200000 }],
      [{ n: 16, itemName: "アクアラング Aqua Lung Leg3nd レギュレーター ヨーク", priceJpy: 120000 }],
    );
    const row16 = optionConflict.rows.find((r) => r.item.n === 16)!;
    check("#16 DIN vs Yoke on real products on both sides -> 불일치 kept", row16.status, "불일치");
    checkTrue("#16 reason names the connection conflict", row16.reasons.some((r) => r.startsWith("옵션 불일치(connection)")));

    const jpAccessory = buildDivingReport(
      [{ n: 19, classification: "MISMATCH" }],
      [{ n: 19, itemName: "マレス Mares Prestige SLS 交換用 インフレーター", priceJpy: 5000, classification: "REJECTED_ACCESSORY" }],
    );
    const acc19 = jpAccessory.rows.find((r) => r.item.n === 19)!;
    if (acc19.jp?.classification === "REJECTED_ACCESSORY") {
      check("JP accessory + empty legacy KR -> 불일치 (JP side is real data)", acc19.status, "불일치");
      checkTrue("... and KR reason is the absence label, not '본품 아님'", acc19.reasons.includes("한국 비교 상품 없음 · 원인 미확인"));
      check("... counted as JP REJECTED_ACCESSORY without KR", jpAccessory.jpRejectedAccessoryWithoutKr, 1);
    } else {
      check("JP accessory fixture should reclassify as REJECTED_ACCESSORY", acc19.jp?.classification, "REJECTED_ACCESSORY");
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
