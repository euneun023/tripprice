/**
 * Offline KR(11st)/JP(Rakuten) comparison report for the 12-item diving
 * sample - the diving counterpart to compare-kr-jp-sample10.ts, kept as
 * a SEPARATE test target per this review's instruction (camera's success
 * does not prove diving's feasibility). Makes NO API call.
 *
 * Does NOT duplicate compareRow/compareOptionAxes/summarize/
 * reclassifyKr/reclassifyJp - those are now parameterized in compare-kr-
 * jp-sample10.ts (items/jpItems default to the camera arrays, so every
 * existing camera call site is unaffected) and reused here unchanged,
 * passing the diving item arrays instead. The only diving-specific
 * additions live in that shared file's OPTION_TOKEN_CANON (connection/
 * stage_config/size/gender/region/case_size canon entries) and in this
 * file's own input schema (model code is largely absent for this
 * category, so KrResultEntry's optional productCode is expected to stay
 * empty far more often here than for cameras).
 *
 * Usage:
 *   npx tsx src/scripts/compare-kr-jp-diving12.ts --kr=<kr.json> --jp=<jp.json>
 *
 * Same "원본 결과가 없으면 필요한 로그 항목만 요청" behavior as the
 * camera comparator - run with no/invalid args to print the schema.
 */
import { readFileSync } from "node:fs";
import { buildReport, type KrResultEntry, type JpResultEntry } from "./compare-kr-jp-sample10";
import { SELECTED_DIVING_ITEMS } from "./supply-diving-sample12";
import { JP_DIVING_ITEMS } from "./supply-rakuten-diving12";

export function buildDivingReport(krEntries: KrResultEntry[], jpEntries: JpResultEntry[]) {
  return buildReport(krEntries, jpEntries, SELECTED_DIVING_ITEMS, JP_DIVING_ITEMS);
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function printSchemaAndExit(): never {
  console.log(
    "KR/JP 다이빙 12개 비교 리포트를 만들 원본 데이터가 없습니다 - 추가 API 호출 없이, compare-kr-jp-sample10.ts와 " +
      "동일한 KrResultEntry/JpResultEntry 스키마(n, productName/itemName, seller/shop, priceKrw/priceJpy, url, " +
      "detectedOptionHints, deliveryUncertain)를 가진 JSON 파일 2개만 필요합니다. n은 13,14,15,16,17,18,19,20,21,22,23,24 중 해당하는 값을 쓰세요.\n\n" +
      "실행: npx tsx src/scripts/compare-kr-jp-diving12.ts --kr=<kr.json> --jp=<jp.json>",
  );
  process.exit(1);
}

function main() {
  const krPath = parseArg("kr");
  const jpPath = parseArg("jp");
  if (!krPath || !jpPath) printSchemaAndExit();

  let krEntries: KrResultEntry[];
  let jpEntries: JpResultEntry[];
  try {
    krEntries = loadJson(krPath!);
    jpEntries = loadJson(jpPath!);
  } catch (err) {
    console.error(`파일을 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`);
    printSchemaAndExit();
  }

  const summary = buildDivingReport(krEntries, jpEntries);

  console.log("=== KR(11st)/JP(Rakuten) 다이빙 12-item 비교 리포트 (오프라인, API 호출 없음) ===\n");
  for (const row of summary.rows) {
    console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - ${row.status}`);
    if (row.kr) console.log(`  KR: ${row.kr.classification ?? "(미분류)"} | ${row.kr.productName ?? "-"} | ${row.kr.priceKrw ?? "-"}원`);
    if (row.jp) console.log(`  JP: ${row.jp.classification ?? "(미분류)"} | ${row.jp.itemName ?? "-"} | ${row.jp.priceJpy ?? "-"}円`);
    for (const r of row.reasons) console.log(`  - ${r}`);
    console.log("");
  }

  console.log("=== 최종 집계 ===");
  console.log(`자동 동일 모델 후보: ${summary.autoCandidateCount}`);
  console.log(`검수 필요: ${summary.needsReview}`);
  console.log(`불일치: ${summary.mismatch}`);
  console.log(`  - 그중 JP REJECTED_ACCESSORY(KR 데이터 없이도): ${summary.jpRejectedAccessoryWithoutKr}`);
  console.log(`데이터없음: ${summary.noData}`);
  console.log(`양국 가격 필드 확보 수: ${summary.bothPricesPresentCount}`);
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("compare-kr-jp-diving12.ts")) {
  main();
}
