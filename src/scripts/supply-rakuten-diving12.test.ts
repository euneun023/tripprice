/**
 * Offline regression tests for supply-rakuten-diving12.ts - no network,
 * no applicationId/accessKey. Run directly:
 *   npx tsx src/scripts/supply-rakuten-diving12.test.ts
 */
import { classifyCandidate } from "./supply-11st-sample10";
import { PRIOR_EVIDENCE, MAX_LIVE_CALLS_DIVING } from "./supply-diving-sample12";
import { JP_DIVING_ITEMS, WORTHWHILE_JP_DIVING_ITEMS, MAX_HTTP_REQUESTS_DIVING } from "./supply-rakuten-diving12";

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
  const item = JP_DIVING_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no JP_DIVING_ITEMS entry for n=${n}`);
  return item;
}

function main() {
  check("JP_DIVING_ITEMS has one entry per diving item", JP_DIVING_ITEMS.length, MAX_LIVE_CALLS_DIVING);
  check("WORTHWHILE_JP_DIVING_ITEMS is exactly the 동일 상품 후보 8", WORTHWHILE_JP_DIVING_ITEMS.length, 8);
  check("MAX_HTTP_REQUESTS_DIVING matches the worthwhile count", MAX_HTTP_REQUESTS_DIVING, 8);
  checkTrue(
    "every worthwhile item is actually flagged liveCallWorthwhile in PRIOR_EVIDENCE",
    WORTHWHILE_JP_DIVING_ITEMS.every((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile),
  );

  {
    const item = itemByN(16); // regulator - JP-language DIN/stage axis
    const din = classifyCandidate(item, { productName: "アクアラング Leg3nd DINファーストステージ レギュレーター" });
    checkTrue("JP regulator DIN connection hint detected", din.detectedOptionHints.some((h) => h === "connection:DIN"));
  }
  {
    const item = itemByN(14); // Garmin Mk3s vs Mk3i in Japanese
    const mk3i = classifyCandidate(item, { productName: "ガーミン Garmin Descent Mk3i チタニウム ダイブコンピューター" });
    checkTrue("JP Garmin Mk3i (titanium) excluded, not accepted as Mk3s", mk3i.matchedExcludeTerms.includes("Mk3i"));
  }
  {
    const item = itemByN(16);
    const hose = classifyCandidate(item, { productName: "アクアラング Leg3nd 互換 交換用 ホース" });
    check("JP regulator 互換+交換用+ホース accessory listing -> REJECTED_ACCESSORY", hose.classification, "REJECTED_ACCESSORY");
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
