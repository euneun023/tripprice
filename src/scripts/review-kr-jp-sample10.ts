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
 *     Ends with 검수 완료(승인/거절) / 보류 중 / 검수 대기 / 유효한 가격쌍
 *     수 - 네 가지를 서로 분리해서 보고한다 (보류는 완료가 아니다; 유효한
 *     가격쌍은 "양쪽에 가격이 있다"는 사실만으로는 절대 세지 않는다 -
 *     ReviewedRow.validPricePair/assertValidApproval() 참고).
 *
 *   npx tsx src/scripts/review-kr-jp-sample10.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." --kr=<kr.json> --jp=<jp.json> [--confirmedOptionAxes=label1,label2] [--reviewer=<name>] [--decisions=<path>]
 *     Records ONE human decision for item n - the ONLY way a decision is
 *     ever written. `--kr`/`--jp` are now REQUIRED here too (not just for
 *     `report`): this command loads them, rebuilds item n's CURRENT
 *     automatic status, and validates the decision against it BEFORE
 *     writing anything - "승인 전 한국·일본 상품 데이터와 검수 상태를
 *     확인" is enforced structurally, not left to the caller to remember.
 *     See assertValidApproval() for the exact rules (REJECTED_ACCESSORY/
 *     MISMATCH/옵션 불일치 = 불일치 status can NEVER be approved through
 *     this command; a NEEDS_REVIEW(검수 필요) approval additionally
 *     requires every open option axis to be named in
 *     --confirmedOptionAxes and a longer evidence string - a bare "ok" is
 *     rejected). reviewedAt is stamped by recordDecision() itself.
 *     Every call APPENDS a new history entry rather than overwriting the
 *     previous one for that n (requirement: preserve a decision's edit
 *     history) - the most recent entry per n is what counts.
 *
 * Decisions are stored at local-results/review-decisions.json by default
 * (gitignored - see .gitignore's "local-results/" entry) - a separate,
 * richer record (approve/hold/reject + evidence + date + history) than,
 * and authoritative over, the old per-entry `humanVerified` boolean in
 * KrResultEntry/JpResultEntry (no longer read by this script).
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
import { buildReport, type ComparisonRow, type RowStatus, type KrResultEntry, type JpResultEntry } from "./compare-kr-jp-sample10";

export type ReviewDecisionValue = "approved" | "held" | "rejected";

export interface ReviewDecision {
  n: number;
  decision: ReviewDecisionValue;
  /** What the human actually checked (e.g. "두 URL 직접 열어 모델명/
   * 마운트/색상 일치 확인함") - required, never auto-filled, and never
   * just "exists" (see MIN_EVIDENCE_LENGTH/MIN_EVIDENCE_LENGTH_FOR_REVIEW
   * - a non-empty string alone is not treated as "검증 완료"). */
  evidence: string;
  /** ISO 8601 - stamped by recordDecision() itself at write time. */
  reviewedAt: string;
  reviewer?: string;
  /** Required (and validated) only when approving a 검수 필요(NEEDS_
   * REVIEW) row with option axes - the axis labels (row.optionAxes'
   * `label`s) the human says they personally confirmed. Kept on the
   * record for traceability even for non-approval decisions, if given. */
  confirmedOptionAxes?: string[];
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DECISIONS_PATH = join(SCRIPT_DIR, "..", "..", "local-results", "review-decisions.json");

/** Returns the FULL history, oldest first - never just "the current
 * decision". Use pickLatestPerN()/latestDecisionFor() to get the one
 * that's actually in effect. */
export function loadDecisions(path: string): ReviewDecision[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveDecisions(path: string, decisions: ReviewDecision[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(decisions, null, 2), "utf-8");
}

/** Collapses a (possibly multi-entry-per-n) history down to the single
 * most recent decision per n, by reviewedAt (ties broken by array/append
 * order - a later-appended entry with an identical timestamp still
 * wins). The history itself is never discarded in the file - only this
 * read-side view picks "the current one" (requirement 7: preserve
 * amendment history). */
export function pickLatestPerN(decisions: ReviewDecision[]): Map<number, ReviewDecision> {
  const map = new Map<number, ReviewDecision>();
  for (const d of decisions) {
    const existing = map.get(d.n);
    if (!existing || new Date(d.reviewedAt).getTime() >= new Date(existing.reviewedAt).getTime()) {
      map.set(d.n, d);
    }
  }
  return map;
}

/** Minimum trimmed-evidence length for ANY decision - requirement 4:
 * "evidence 문자열이 존재한다는 사실만으로 검증이 완료되었다고 가정하지
 * 말 것". Deliberately not huge - this is a floor against literally
 * trivial entries ("ok", "확인"), not a substitute for a human actually
 * reading the evidence text. */
export const MIN_EVIDENCE_LENGTH = 10;
/** Stricter floor specifically for APPROVING a 검수 필요(NEEDS_REVIEW)
 * row - requirement 2: "모델·옵션·구성을 확인한 근거가 있을 때만 승인". */
export const MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL = 20;

/**
 * The context a caller MUST supply before approving - everything here
 * comes from freshly rebuilding the comparison row from the current
 * KR/JP files, never from stale memory or from the decision itself.
 */
export interface ApprovalContext {
  status: RowStatus;
  hasKrData: boolean;
  hasJpData: boolean;
  /** row.optionAxes.map(a => a.label) - every option axis this item
   * declares, regardless of whether it's currently 일치/불일치/미확인. */
  optionAxisLabels: string[];
}

export function approvalContextFromRow(row: ComparisonRow): ApprovalContext {
  return {
    status: row.status,
    hasKrData: Boolean(row.kr),
    hasJpData: Boolean(row.jp),
    optionAxisLabels: row.optionAxes.map((a) => a.label),
  };
}

/**
 * Throws with a specific, actionable message for every case this review
 * exists to block - called by recordDecision() BEFORE anything is
 * written, so these are structural guarantees, not advice:
 *
 *   1. 불일치(REJECTED_ACCESSORY/MISMATCH/옵션 불일치) rows can NEVER be
 *      "approved" through this path - that status means the automatic
 *      rules already found a concrete reason this ISN'T the same
 *      product; approving it anyway would silently create exactly the
 *      "불일치 상품이 유효 가격쌍에 섞이는" bug this review reported.
 *      Only "rejected"/"held" are allowed for a 불일치 row.
 *   2. 데이터없음 (either side missing) can't be approved either - there
 *      is nothing concrete to have verified.
 *   3. Approving a 검수 필요(NEEDS_REVIEW) row additionally requires
 *      EVERY one of its optionAxisLabels to appear in
 *      confirmedOptionAxes (a human must name each axis they personally
 *      checked) and a longer evidence string
 *      (MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL).
 *   4. Every decision, regardless of status, needs evidence at least
 *      MIN_EVIDENCE_LENGTH characters (trimmed) - never just "exists".
 */
export function assertValidApproval(
  n: number,
  decision: ReviewDecisionValue,
  trimmedEvidence: string,
  context: ApprovalContext,
  confirmedOptionAxes: string[],
): void {
  if (trimmedEvidence.length < MIN_EVIDENCE_LENGTH) {
    throw new Error(
      `cannot record decision for n=${n}: evidence is only ${trimmedEvidence.length} char(s), need >= ${MIN_EVIDENCE_LENGTH} - ` +
        `describe what was actually checked, a non-empty string alone is not enough`,
    );
  }
  if (decision !== "approved") return;

  if (context.status === "불일치") {
    throw new Error(
      `cannot approve n=${n}: automatic status is 불일치 (REJECTED_ACCESSORY/MISMATCH/옵션 불일치) - ` +
        `the rules already found a concrete reason this is NOT the same product. Use --decision=rejected instead.`,
    );
  }
  if (context.status === "데이터없음" || !context.hasKrData || !context.hasJpData) {
    throw new Error(`cannot approve n=${n}: KR/JP data is incomplete (hasKrData=${context.hasKrData}, hasJpData=${context.hasJpData})`);
  }
  if (context.status === "검수 필요") {
    const missing = context.optionAxisLabels.filter((label) => !confirmedOptionAxes.includes(label));
    if (missing.length > 0) {
      throw new Error(
        `cannot approve n=${n}: it is 검수 필요 with unresolved option axis(es) [${missing.join(", ")}] not listed in ` +
          `--confirmedOptionAxes - a human must explicitly name every axis they personally checked (model/mount/color/구성 등)`,
      );
    }
    if (trimmedEvidence.length < MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL) {
      throw new Error(
        `cannot approve n=${n} (검수 필요): evidence is only ${trimmedEvidence.length} char(s), need >= ${MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL} ` +
          `for a NEEDS_REVIEW item - describe exactly what model/option/구성 evidence was checked`,
      );
    }
  }
}

/**
 * The ONLY function that writes a decision. Validates via
 * assertValidApproval() BEFORE touching disk - a rejected call writes
 * nothing. APPENDS rather than overwrites (requirement 7: preserve edit
 * history) - pickLatestPerN() is what resolves "the current decision".
 */
export function recordDecision(
  path: string,
  n: number,
  decision: ReviewDecisionValue,
  evidence: string,
  context: ApprovalContext,
  opts: { reviewer?: string; confirmedOptionAxes?: string[]; now?: Date } = {},
): ReviewDecision[] {
  const trimmed = evidence.trim();
  const confirmedOptionAxes = opts.confirmedOptionAxes ?? [];
  assertValidApproval(n, decision, trimmed, context, confirmedOptionAxes);

  const history = loadDecisions(path);
  const entry: ReviewDecision = {
    n,
    decision,
    evidence: trimmed,
    reviewedAt: (opts.now ?? new Date()).toISOString(),
    reviewer: opts.reviewer,
    confirmedOptionAxes: confirmedOptionAxes.length > 0 ? confirmedOptionAxes : undefined,
  };
  const next = [...history, entry];
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

/**
 * A narrow, well-defined price-DATA anomaly check - deliberately NOT a
 * cross-currency "is this price too different" check, which would need
 * an exchange rate this file has no business inventing. Flags only two
 * unambiguous data-quality problems on a single side:
 *   - a "discounted" price that is actually HIGHER than the list price
 *     (salePriceKrw > priceKrw) - internally inconsistent, not a real
 *     discount.
 *   - either price being exactly 0 while still being reported as
 *     "present" - almost always a scraping/entry error, never a real
 *     free price for these product types.
 * Advisory only, same as isPurchasabilityUncertain - never blocks or
 * grants a decision by itself (requirement 6: don't auto-approve past a
 * price anomaly, but this file still leaves the actual approve/reject
 * call to a human).
 */
export function hasPriceDataAnomaly(kr?: KrResultEntry, jp?: JpResultEntry): boolean {
  if (kr?.priceKrw !== undefined && kr?.salePriceKrw !== undefined && kr.salePriceKrw > kr.priceKrw) return true;
  if (kr?.priceKrw === 0 || kr?.salePriceKrw === 0) return true;
  if (jp?.priceJpy === 0) return true;
  return false;
}

export interface ReviewedRow {
  row: ComparisonRow;
  decision?: ReviewDecision;
  purchasabilityUncertain: boolean;
  priceDataAnomaly: boolean;
  /**
   * "유효한 가격쌍" - requires ALL of:
   *   1. the latest decision for this n is "approved"
   *   2. row.status is NEITHER 불일치 NOR 데이터없음 (defense in depth -
   *      recordDecision() already refuses to WRITE an approved decision
   *      for those statuses, but this is re-checked here independently
   *      against the CURRENT row every time a report is built, so even a
   *      decision file edited by hand, or written before this fix
   *      existed, can never silently count a 불일치/REJECTED_ACCESSORY/
   *      MISMATCH/옵션 불일치 item - this is exactly the bug this review
   *      reported, fixed at both the write side and the read side)
   *   3. row.bothPricesPresent (requirement: price-field presence alone
   *      is still never sufficient on its own - see 2)
   * NOT gated on purchasabilityUncertain either way (requirement 6:
   * approval and purchasability are tracked separately).
   */
  validPricePair: boolean;
}

const NON_APPROVABLE_STATUSES: RowStatus[] = ["불일치", "데이터없음"];

export function buildReviewedRows(krEntries: KrResultEntry[], jpEntries: JpResultEntry[], decisions: ReviewDecision[]): ReviewedRow[] {
  const summary = buildReport(krEntries, jpEntries);
  const latest = pickLatestPerN(decisions);
  return summary.rows.map((row) => {
    const decision = latest.get(row.item.n);
    const validPricePair = decision?.decision === "approved" && !NON_APPROVABLE_STATUSES.includes(row.status) && row.bothPricesPresent;
    return {
      row,
      decision,
      purchasabilityUncertain: isPurchasabilityUncertain(row.kr, row.jp),
      priceDataAnomaly: hasPriceDataAnomaly(row.kr, row.jp),
      validPricePair,
    };
  });
}

export interface ReviewReportSummary {
  total: number;
  /** 검수 완료 - a FINAL decision (approved or rejected) is recorded.
   * held is deliberately NOT counted here (requirement 5: "held는 검수
   * 완료와 구분"). */
  finalizedCount: number;
  /** 보류 중 - latest decision is "held". */
  heldCount: number;
  /** 검수 대기 - no decision recorded at all yet. */
  pendingCount: number;
  /** 유효한 가격쌍 - see ReviewedRow.validPricePair. */
  validPricePairCount: number;
}

export function summarizeReview(reviewed: ReviewedRow[]): ReviewReportSummary {
  const finalizedCount = reviewed.filter((r) => r.decision?.decision === "approved" || r.decision?.decision === "rejected").length;
  const heldCount = reviewed.filter((r) => r.decision?.decision === "held").length;
  return {
    total: reviewed.length,
    finalizedCount,
    heldCount,
    pendingCount: reviewed.length - finalizedCount - heldCount,
    validPricePairCount: reviewed.filter((r) => r.validPricePair).length,
  };
}

function decisionLine(d?: ReviewDecision): string {
  if (!d) return "검수상태: 검수 대기 (아직 사람 결정 없음)";
  const label = d.decision === "held" ? "보류 중" : d.decision;
  return (
    `검수상태: ${label} | 근거: ${d.evidence} | 검수일: ${d.reviewedAt}${d.reviewer ? ` | 검수자: ${d.reviewer}` : ""}` +
    (d.confirmedOptionAxes?.length ? ` | 확인한 옵션축: ${d.confirmedOptionAxes.join(", ")}` : "")
  );
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
  if (r.priceDataAnomaly) console.log(`  가격데이터 이상치 감지 - 승인 전 가격 필드를 직접 확인할 것`);
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
    console.log(`  승인 시 --confirmedOptionAxes=${row.optionAxes.map((a) => a.label).join(",")} 필요`);
  }
  console.log(
    `  KR: "${row.kr?.productName ?? "-"}" (${row.kr?.priceKrw ?? "-"}원) | JP: "${row.jp?.itemName ?? "-"}" (${row.jp?.priceJpy ?? "-"}円)`,
  );
  console.log(`  ${decisionLine(r.decision)}`);
}

function printMismatch(r: ReviewedRow) {
  const { row } = r;
  console.log(`#${row.item.n} [${row.item.type}] ${row.item.title} - 불일치 (일반 승인으로는 유효 가격쌍이 될 수 없음)`);
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

function loadKrJp(krPath: string, jpPath: string): { krEntries: KrResultEntry[]; jpEntries: JpResultEntry[] } {
  return { krEntries: loadJson(krPath), jpEntries: loadJson(jpPath) };
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
    ({ krEntries, jpEntries } = loadKrJp(krPath, jpPath));
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
  console.log(`검수 완료 수 (승인 또는 거절로 최종 결정됨): ${summary.finalizedCount}`);
  console.log(`보류 중 수 (held - 검수 완료 아님): ${summary.heldCount}`);
  console.log(`검수 대기 수 (아직 사람 결정 없음): ${summary.pendingCount}`);
  console.log(`>>> 유효한 가격쌍 수 (승인 + 불일치/데이터없음 아님 + 양국 가격 모두 존재) - 실제 목표 지표: ${summary.validPricePairCount}`);
  console.log(`\n결정 기록 파일(이력 전체 ${decisions.length}건 보존): ${decisionsPath}`);
  console.log(
    "승인/보류/거절을 기록하려면 (--kr/--jp 필수 - 승인 전 현재 데이터/상태를 다시 확인함):\n" +
      '  npx tsx src/scripts/review-kr-jp-sample10.ts decide --n=<n> --decision=approved --evidence="두 URL 직접 확인, 모델/색상/가격 일치" --kr=<kr.json> --jp=<jp.json>',
  );
}

function runDecide() {
  const nArg = parseArg("n");
  const decisionArg = parseArg("decision") as ReviewDecisionValue | undefined;
  const evidence = parseArg("evidence");
  const reviewer = parseArg("reviewer");
  const decisionsPath = parseArg("decisions") ?? DEFAULT_DECISIONS_PATH;
  const krPath = parseArg("kr");
  const jpPath = parseArg("jp");
  const confirmedOptionAxesArg = parseArg("confirmedOptionAxes");

  if (!nArg || !decisionArg || !evidence || !krPath || !jpPath) {
    console.error(
      'Usage: review-kr-jp-sample10.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." --kr=<kr.json> --jp=<jp.json> ' +
        "[--confirmedOptionAxes=label1,label2] [--reviewer=<name>] [--decisions=<path>]",
    );
    process.exit(1);
  }
  if (!["approved", "held", "rejected"].includes(decisionArg)) {
    console.error(`--decision must be one of approved|held|rejected, got "${decisionArg}"`);
    process.exit(1);
  }

  let krEntries: KrResultEntry[];
  let jpEntries: JpResultEntry[];
  try {
    ({ krEntries, jpEntries } = loadKrJp(krPath, jpPath));
  } catch (err) {
    console.error(`파일을 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const n = Number(nArg);
  const summary = buildReport(krEntries, jpEntries);
  const row = summary.rows.find((r) => r.item.n === n);
  if (!row) {
    console.error(`n=${n}은 SELECTED_ITEMS에 존재하지 않습니다.`);
    process.exit(1);
  }
  const context = approvalContextFromRow(row);
  const confirmedOptionAxes = confirmedOptionAxesArg
    ? confirmedOptionAxesArg.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const decisions = recordDecision(decisionsPath, n, decisionArg, evidence, context, { reviewer, confirmedOptionAxes });
    console.log(
      `Recorded: n=${n} decision=${decisionArg} (current status at decision time: ${row.status}) - ` +
        `${decisions.length} total decision record(s) in ${decisionsPath}`,
    );
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
    console.error("Usage: review-kr-jp-sample10.ts <report|decide> ...");
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("review-kr-jp-sample10.ts")) {
  main();
}
