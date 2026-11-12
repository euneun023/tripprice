/**
 * Human-review workstation for the 10-item KR(11st)/JP(Rakuten) compare
 * report (compare-kr-jp-sample10.ts) - makes NO API call. Reads only the
 * already-captured KR/JP result files plus a local human-decision file
 * this script itself writes; never fetches anything new.
 *
 * Two commands:
 *
 *   npx tsx src/scripts/review-kr-jp-sample10.ts report --kr=<kr.json> --jp=<jp.json> [--decisions=<path>]
 *     Prints a structured per-item review report:
 *       - 자동 동일 모델 후보: KR/JP 상품명·모델코드·가격·판매자·URL·
 *         재고/납기 조건을 나란히 출력.
 *       - 검수 필요: 정확히 무엇이 미확인인지(필요한 검증 항목)와 지금까지
 *         발견된 옵션값을 출력.
 *       - 불일치: 제외된 구체적 근거를 출력.
 *     Ends with 검수 완료/검수 대기/유효한 가격쌍 수 (세 가지를 서로
 *     분리해서 보고 - 유효한 가격쌍은 "양쪽에 가격이 있다"는 사실만으로는
 *     절대 세지 않는다. 아래 validPricePair 참고).
 *
 *   npx tsx src/scripts/review-kr-jp-sample10.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." [--decisions=<path>] [--reviewer=<name>]
 *     Records (or updates) ONE human decision for item n. `evidence` is
 *     REQUIRED and must be non-empty - recordDecision() throws otherwise,
 *     so "사람의 실제 확인 없이 승인/거절 금지"는 호출자 의도가 아니라
 *     이 함수 자체가 강제한다. reviewedAt is always stamped to the
 *     current time by this script, never supplied by the caller. Works
 *     for ANY item regardless of its automatic status - a NEEDS_REVIEW
 *     (검수 필요) pair CAN be approved here once a human has actual
 *     evidence (requirement: "NEEDS_REVIEW 상품도 실제 증거가 확인되면
 *     승인할 수 있게"), and an already-자동 동일 모델 후보 pair still
 *     needs this step before it counts as reviewed or contributes to a
 *     유효한 가격쌍.
 *
 * Decisions are stored at local-results/review-decisions.json by default
 * (gitignored - see .gitignore's "local-results/" entry) - a separate,
 * richer record (approve/hold/reject + evidence + date) than, and
 * authoritative over, the old per-entry `humanVerified` boolean in
 * KrResultEntry/JpResultEntry (that boolean is no longer read by this
 * script).
 *
 * Approval (identity confirmed by a human) and purchasability (stock/
 * delivery certainty) are tracked completely independently - see
 * isPurchasabilityUncertain()'s own comment for why neither
 * deliveryUncertain wording nor a missing/zero availability flag is ever
 * allowed to promote or block a decision, and why "approved" never means
 * "buyable right now".
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, type ComparisonRow, type KrResultEntry, type JpResultEntry } from "./compare-kr-jp-sample10";

export type ReviewDecisionValue = "approved" | "held" | "rejected";

export interface ReviewDecision {
  n: number;
  decision: ReviewDecisionValue;
  /** What the human actually checked (e.g. "두 URL 직접 열어 모델명/
   * 마운트/색상 일치 확인함") - required, never auto-filled. */
  evidence: string;
  /** ISO 8601 - stamped by recordDecision() itself at write time. */
  reviewedAt: string;
  reviewer?: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DECISIONS_PATH = join(SCRIPT_DIR, "..", "..", "local-results", "review-decisions.json");

export function loadDecisions(path: string): ReviewDecision[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveDecisions(path: string, decisions: ReviewDecision[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(decisions, null, 2), "utf-8");
}

/**
 * The ONLY function that writes a decision - upserts by n (a later call
 * for the same n replaces the earlier one; history isn't kept, since
 * this is a current-status record, not an audit log). Throws on an
 * empty/whitespace-only evidence string - this is the structural
 * enforcement of "사람의 실제 확인 없이 승인/거절 금지", not a convention
 * callers have to remember.
 */
export function recordDecision(
  path: string,
  n: number,
  decision: ReviewDecisionValue,
  evidence: string,
  reviewer?: string,
  now: Date = new Date(),
): ReviewDecision[] {
  const trimmed = evidence.trim();
  if (!trimmed) {
    throw new Error("evidence must be a non-empty string describing what was actually checked - a decision is never recorded without it");
  }
  const decisions = loadDecisions(path);
  const entry: ReviewDecision = { n, decision, evidence: trimmed, reviewedAt: now.toISOString(), reviewer };
  const next = [...decisions.filter((d) => d.n !== n), entry].sort((a, b) => a.n - b.n);
  saveDecisions(path, next);
  return next;
}

/**
 * Whether purchasability is NOT confirmed, from either side's delivery/
 * stock wording or Rakuten's own availability=0 flag - entirely separate
 * from `decision`. Requirement: "검수 승인과 실제 구매 가능 여부는 별도
 * 관리" / "납기 미정이나 입고 대기 상품을 자동으로 구매 가능으로 처리하지
 * 마" - so this function is read-only and advisory: nothing in this file
 * ever uses its result to set, block, or upgrade a decision or
 * validPricePair. Its ABSENCE (false) is not "confirmed purchasable"
 * either - only "no negative wording/flag found", matching
 * classifyCandidate's own deliveryUncertaintyTerms contract.
 */
export function isPurchasabilityUncertain(kr?: KrResultEntry, jp?: JpResultEntry): boolean {
  if ((kr?.deliveryUncertain?.length ?? 0) > 0) return true;
  if ((jp?.deliveryUncertain?.length ?? 0) > 0) return true;
  if (jp?.availability === 0) return true;
  return false;
}

export interface ReviewedRow {
  row: ComparisonRow;
  decision?: ReviewDecision;
  purchasabilityUncertain: boolean;
  /**
   * "유효한 가격쌍" - requires a HUMAN "approved" decision AND both
   * prices present. Deliberately NOT just `row.bothPricesPresent`
   * (requirement: "가격 필드가 양쪽에 있다는 이유만으로 유효한 가격비교
   * 상품으로 집계하지 마") and NOT gated on purchasabilityUncertain
   * either way (requirement 6: approval and purchasability are tracked
   * separately, so a 납기미정 item can still be a valid PRICE pair - the
   * caveat is reported alongside, never silently dropped or silently
   * granted purchasability).
   */
  validPricePair: boolean;
}

export function buildReviewedRows(krEntries: KrResultEntry[], jpEntries: JpResultEntry[], decisions: ReviewDecision[]): ReviewedRow[] {
  const summary = buildReport(krEntries, jpEntries);
  const decisionByN = new Map(decisions.map((d) => [d.n, d]));
  return summary.rows.map((row) => {
    const decision = decisionByN.get(row.item.n);
    const validPricePair = decision?.decision === "approved" && row.bothPricesPresent;
    return { row, decision, purchasabilityUncertain: isPurchasabilityUncertain(row.kr, row.jp), validPricePair };
  });
}

export interface ReviewReportSummary {
  total: number;
  reviewedCount: number; // 검수 완료 - any decision recorded (approved/held/rejected), outcome doesn't matter here
  pendingCount: number; // 검수 대기 - no decision recorded yet
  validPricePairCount: number; // 유효한 가격쌍 - see ReviewedRow.validPricePair
}

export function summarizeReview(reviewed: ReviewedRow[]): ReviewReportSummary {
  const reviewedCount = reviewed.filter((r) => r.decision !== undefined).length;
  return {
    total: reviewed.length,
    reviewedCount,
    pendingCount: reviewed.length - reviewedCount,
    validPricePairCount: reviewed.filter((r) => r.validPricePair).length,
  };
}

function decisionLine(d?: ReviewDecision): string {
  if (!d) return "검수상태: 검수 대기 (아직 사람 결정 없음)";
  return `검수상태: ${d.decision} | 근거: ${d.evidence} | 검수일: ${d.reviewedAt}${d.reviewer ? ` | 검수자: ${d.reviewer}` : ""}`;
}

function purchasabilityLine(r: ReviewedRow): string {
  return r.purchasabilityUncertain
    ? "구매가능성: 미확정 (납기/재고 문구 또는 availability=0 감지 - 검수 승인 여부와 무관)"
    : "구매가능성: 부정적 신호 없음 (확정된 것은 아님 - 이 자체가 '구매 가능 확인'을 의미하지 않음)";
}

function printAutoCandidate(r: ReviewedRow) {
  const { row } = r;
  console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - 자동 동일 모델 후보`);
  console.log(
    `  KR: 상품명="${row.kr?.productName ?? "-"}" | 모델코드=${row.kr?.productCode ?? "-"} | ` +
      `가격=${row.kr?.priceKrw ?? "-"}원 / 할인가=${row.kr?.salePriceKrw ?? "-"}원 | 판매자=${row.kr?.seller ?? "-"} | url=${row.kr?.url ?? "-"}`,
  );
  console.log(`      재고/납기: ${row.kr?.deliveryUncertain?.length ? row.kr.deliveryUncertain.join(", ") : "문구 없음"}`);
  console.log(
    `  JP: 상품명="${row.jp?.itemName ?? "-"}" | 모델코드=(라쿠텐 미제공) | ` +
      `가격=${row.jp?.priceJpy ?? "-"}円 | 판매자(shop)=${row.jp?.shop ?? "-"} | availability=${row.jp?.availability ?? "-"} | url=${row.jp?.url ?? "-"}`,
  );
  console.log(`      재고/납기: ${row.jp?.deliveryUncertain?.length ? row.jp.deliveryUncertain.join(", ") : "문구 없음"}`);
  console.log(`  ${purchasabilityLine(r)}`);
  console.log(`  ${decisionLine(r.decision)}`);
}

function printNeedsReview(r: ReviewedRow) {
  const { row } = r;
  console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - 검수 필요`);
  console.log(`  필요한 검증 항목:`);
  for (const reason of row.reasons) console.log(`    - ${reason}`);
  if (row.optionAxes.length) {
    console.log(`  발견된 옵션값:`);
    for (const a of row.optionAxes) console.log(`    - ${a.label}: ${a.status} (KR=${a.krValues.join("/") || "없음"} / JP=${a.jpValues.join("/") || "없음"})`);
  }
  console.log(
    `  KR: "${row.kr?.productName ?? "-"}" (${row.kr?.priceKrw ?? "-"}원) | JP: "${row.jp?.itemName ?? "-"}" (${row.jp?.priceJpy ?? "-"}円)`,
  );
  console.log(`  ${decisionLine(r.decision)}`);
}

function printMismatch(r: ReviewedRow) {
  const { row } = r;
  console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - 불일치`);
  console.log(`  제외 근거:`);
  for (const reason of row.reasons) console.log(`    - ${reason}`);
  console.log(`  ${decisionLine(r.decision)}`);
}

function printNoData(r: ReviewedRow) {
  const { row } = r;
  console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - 데이터없음`);
  for (const reason of row.reasons) console.log(`    - ${reason}`);
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function runReport() {
  const krPath = parseArg("kr");
  const jpPath = parseArg("jp");
  const decisionsPath = parseArg("decisions") ?? DEFAULT_DECISIONS_PATH;
  if (!krPath || !jpPath) {
    console.error("Usage: review-kr-jp-sample10.ts report --kr=<kr.json> --jp=<jp.json> [--decisions=<path>]");
    process.exit(1);
  }

  let krEntries: KrResultEntry[];
  let jpEntries: JpResultEntry[];
  try {
    krEntries = loadJson(krPath);
    jpEntries = loadJson(jpPath);
  } catch (err) {
    console.error(`파일을 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const decisions = loadDecisions(decisionsPath);

  const reviewed = buildReviewedRows(krEntries, jpEntries, decisions);

  console.log("=== KR(11st)/JP(Rakuten) 10-item 검수 리포트 (오프라인, API 호출 없음) ===\n");

  const autoCandidates = reviewed.filter((r) => r.row.status === "자동 동일 모델 후보");
  const needsReview = reviewed.filter((r) => r.row.status === "검수 필요");
  const mismatches = reviewed.filter((r) => r.row.status === "불일치");
  const noData = reviewed.filter((r) => r.row.status === "데이터없음");

  if (autoCandidates.length) {
    console.log(`--- 자동 동일 모델 후보 (${autoCandidates.length}) ---\n`);
    for (const r of autoCandidates) {
      printAutoCandidate(r);
      console.log("");
    }
  }
  if (needsReview.length) {
    console.log(`--- 검수 필요 (${needsReview.length}) ---\n`);
    for (const r of needsReview) {
      printNeedsReview(r);
      console.log("");
    }
  }
  if (mismatches.length) {
    console.log(`--- 불일치 (${mismatches.length}) ---\n`);
    for (const r of mismatches) {
      printMismatch(r);
      console.log("");
    }
  }
  if (noData.length) {
    console.log(`--- 데이터없음 (${noData.length}) ---\n`);
    for (const r of noData) {
      printNoData(r);
      console.log("");
    }
  }

  const summary = summarizeReview(reviewed);
  console.log("=== 검수 집계 ===");
  console.log(`전체 품목 수: ${summary.total}`);
  console.log(`검수 완료 수 (승인/보류/거절 중 하나라도 기록됨): ${summary.reviewedCount}`);
  console.log(`검수 대기 수 (아직 사람 결정 없음): ${summary.pendingCount}`);
  console.log(`>>> 유효한 가격쌍 수 (승인된 결정 + 양국 가격 모두 존재) - 실제 목표 지표: ${summary.validPricePairCount}`);
  console.log(`\n결정 기록 파일: ${decisionsPath}`);
  console.log(
    "승인/보류/거절을 기록하려면:\n" +
      '  npx tsx src/scripts/review-kr-jp-sample10.ts decide --n=<n> --decision=approved --evidence="두 URL 직접 확인, 모델/색상/가격 일치"',
  );
}

function runDecide() {
  const nArg = parseArg("n");
  const decisionArg = parseArg("decision") as ReviewDecisionValue | undefined;
  const evidence = parseArg("evidence");
  const reviewer = parseArg("reviewer");
  const decisionsPath = parseArg("decisions") ?? DEFAULT_DECISIONS_PATH;

  if (!nArg || !decisionArg || !evidence) {
    console.error(
      'Usage: review-kr-jp-sample10.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." [--reviewer=<name>] [--decisions=<path>]',
    );
    process.exit(1);
  }
  if (!["approved", "held", "rejected"].includes(decisionArg)) {
    console.error(`--decision must be one of approved|held|rejected, got "${decisionArg}"`);
    process.exit(1);
  }

  try {
    const decisions = recordDecision(decisionsPath, Number(nArg), decisionArg, evidence, reviewer);
    console.log(`Recorded: n=${nArg} decision=${decisionArg} (${decisions.length} total decisions in ${decisionsPath})`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function main() {
  const command = process.argv[2];
  if (command === "report") runReport();
  else if (command === "decide") runDecide();
  else {
    console.error('Usage: review-kr-jp-sample10.ts <report|decide> ...');
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("review-kr-jp-sample10.ts")) {
  main();
}
