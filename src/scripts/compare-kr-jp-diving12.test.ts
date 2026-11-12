/**
 * Offline regression tests for compare-kr-jp-diving12.ts - no network.
 * Run directly:
 *   npx tsx src/scripts/compare-kr-jp-diving12.test.ts
 */
import { buildDivingReport } from "./compare-kr-jp-diving12";
import { compareOptionAxes } from "./compare-kr-jp-sample10";
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

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
