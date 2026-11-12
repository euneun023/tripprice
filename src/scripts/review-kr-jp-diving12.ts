/**
 * Evaluation scorecard for the 12-item diving sample - the diving
 * counterpart to review-kr-jp-sample10.ts, kept SEPARATE (own decision
 * file, own item set) per this review's instruction. Makes NO API call;
 * reuses review-kr-jp-sample10.ts's validated decision-recording
 * machinery (assertValidApproval, the evidence-length floors,
 * isPurchasabilityUncertain, hasPriceDataAnomaly, pickLatestPerN)
 * unchanged, and compare-kr-jp-diving12.ts's buildDivingReport (itself a
 * thin reuse of compare-kr-jp-sample10.ts's buildReport). The only new
 * code here is the diving-specific scorecard fields this review asked
 * for that the camera scorecard doesn't track:
 *   - 전문 쇼핑몰 의존 상품 수 (specialtyShopDependent)
 *   - 상품별 검수 시간 (reviewTimeMinutes)
 *   - 상업적 데이터 이용권 확보 여부 (commercialRightsConfirmed - NEVER
 *     auto-true, same discipline as humanVerified/decision elsewhere in
 *     this project)
 *
 * Decisions save to local-results/review-decisions-diving12.json by
 * default (gitignored, separate file from the camera one) - APPENDED,
 * never overwritten, same history-preservation guarantee as
 * review-kr-jp-sample10.ts's recordDecision().
 *
 * Commands:
 *   npx tsx src/scripts/review-kr-jp-diving12.ts report --kr=<kr.json> --jp=<jp.json> [--decisions=<path>]
 *   npx tsx src/scripts/review-kr-jp-diving12.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." --kr=<kr.json> --jp=<jp.json> [--reviewMinutes=<n>] [--commercialRights=confirmed|unconfirmed|denied] [--confirmedOptionAxes=label1,label2] [--reviewer=<name>] [--decisions=<path>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPurchasabilityUncertain,
  hasPriceDataAnomaly,
  assertValidApproval,
  approvalContextFromRow,
  type ReviewDecisionValue,
  type ReviewDecision,
} from "./review-kr-jp-sample10";
import { buildDivingReport } from "./compare-kr-jp-diving12";
import { type KrResultEntry, type JpResultEntry, type ComparisonRow } from "./compare-kr-jp-sample10";
import { PRIOR_EVIDENCE } from "./supply-diving-sample12";

export type CommercialRightsStatus = "confirmed" | "unconfirmed" | "denied";

export interface DivingReviewDecision extends ReviewDecision {
  reviewTimeMinutes?: number;
  /** Defaults to "unconfirmed" - never set to "confirmed" except by an
   * explicit human --commercialRights=confirmed call. This project-wide
   * constraint ("상업적 데이터 저장·공개 권한 미확정 유지") applies to
   * diving exactly as it did to camera; nothing in this file ever infers
   * rights from a successful price match. */
  commercialRightsStatus: CommercialRightsStatus;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIVING_DECISIONS_PATH = join(SCRIPT_DIR, "..", "..", "local-results", "review-decisions-diving12.json");

export function loadDivingDecisions(path: string): DivingReviewDecision[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveDivingDecisions(path: string, decisions: DivingReviewDecision[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(decisions, null, 2), "utf-8");
}

export function pickLatestDivingPerN(decisions: DivingReviewDecision[]): Map<number, DivingReviewDecision> {
  const map = new Map<number, DivingReviewDecision>();
  for (const d of decisions) {
    const existing = map.get(d.n);
    if (!existing || new Date(d.reviewedAt).getTime() >= new Date(existing.reviewedAt).getTime()) map.set(d.n, d);
  }
  return map;
}

/** Same validation as review-kr-jp-sample10.ts's recordDecision() (reused
 * via assertValidApproval), extended with the diving-only fields. */
export function recordDivingDecision(
  path: string,
  n: number,
  decision: ReviewDecisionValue,
  evidence: string,
  context: ReturnType<typeof approvalContextFromRow>,
  opts: {
    reviewer?: string;
    confirmedOptionAxes?: string[];
    reviewTimeMinutes?: number;
    commercialRightsStatus?: CommercialRightsStatus;
    now?: Date;
  } = {},
): DivingReviewDecision[] {
  const trimmed = evidence.trim();
  const confirmedOptionAxes = opts.confirmedOptionAxes ?? [];
  assertValidApproval(n, decision, trimmed, context, confirmedOptionAxes);

  const history = loadDivingDecisions(path);
  const entry: DivingReviewDecision = {
    n,
    decision,
    evidence: trimmed,
    reviewedAt: (opts.now ?? new Date()).toISOString(),
    reviewer: opts.reviewer,
    confirmedOptionAxes: confirmedOptionAxes.length > 0 ? confirmedOptionAxes : undefined,
    reviewTimeMinutes: opts.reviewTimeMinutes,
    commercialRightsStatus: opts.commercialRightsStatus ?? "unconfirmed",
  };
  const next = [...history, entry];
  saveDivingDecisions(path, next);
  return next;
}

/** KR/JP specialty dive shops seen in poc_products_10.csv / data/
 * approved-mappings.json, none of which expose a public API (manual
 * merchant-feed/scrape only) - matched case-insensitively against
 * seller/shop/URL text. NOT exhaustive - a name absent from this list
 * is reported as "알수없음"(unknown), never silently assumed mainstream. */
const KNOWN_SPECIALTY_SHOPS = ["mic21", "elfdive", "scubajangbimall", "swimnara", "hellodiving", "tradeinn", "diveinn", "scuba.com", "danawa"];

export type SpecialtyShopStatus = "전문몰 의존" | "대형몰/확인됨" | "알수없음";

export function specialtyShopStatus(kr?: KrResultEntry, jp?: JpResultEntry): SpecialtyShopStatus {
  const haystacks = [kr?.seller, kr?.url, jp?.shop, jp?.url].filter((s): s is string => Boolean(s));
  if (haystacks.length === 0) return "알수없음";
  const dependsOnSpecialty = haystacks.some((h) => KNOWN_SPECIALTY_SHOPS.some((shop) => h.toLowerCase().includes(shop)));
  return dependsOnSpecialty ? "전문몰 의존" : "대형몰/확인됨";
}

export interface DivingReviewedRow {
  row: ComparisonRow;
  decision?: DivingReviewDecision;
  purchasabilityUncertain: boolean;
  priceDataAnomaly: boolean;
  specialtyShop: SpecialtyShopStatus;
  validPricePair: boolean;
}

const NON_APPROVABLE_STATUSES = ["불일치", "데이터없음"];

export function buildDivingReviewedRows(krEntries: KrResultEntry[], jpEntries: JpResultEntry[], decisions: DivingReviewDecision[]): DivingReviewedRow[] {
  const summary = buildDivingReport(krEntries, jpEntries);
  const latest = pickLatestDivingPerN(decisions);
  return summary.rows.map((row) => {
    const decision = latest.get(row.item.n);
    const validPricePair = decision?.decision === "approved" && !NON_APPROVABLE_STATUSES.includes(row.status) && row.bothPricesPresent;
    return {
      row,
      decision,
      purchasabilityUncertain: isPurchasabilityUncertain(row.kr, row.jp),
      priceDataAnomaly: hasPriceDataAnomaly(row.kr, row.jp),
      specialtyShop: specialtyShopStatus(row.kr, row.jp),
      validPricePair,
    };
  });
}

/**
 * The 8 scorecard metrics this review asked to be able to tally
 * individually - see the review's own "5. 결과 평가표" section.
 */
export interface DivingScorecard {
  krFoundCount: number; // 한국 상품 발견 수
  jpFoundCount: number; // 일본 상품 발견 수
  bothPricesPresentCount: number; // 양국 가격 확보 수
  candidateCount: number; // 동일 상품 후보 수 (자동 동일 모델 후보 + 검수 필요, i.e. not 불일치/데이터없음)
  finalValidPricePairCount: number; // 최종 검증 가능한 가격쌍 수
  specialtyShopDependentCount: number; // 전문 쇼핑몰 의존 상품 수
  totalReviewTimeMinutes: number; // 상품별 검수 시간의 합 (기록된 것만)
  commercialRightsConfirmedCount: number; // 상업적 데이터 이용권 확보 수 (0이어도 정상 - 미확정 유지가 기본값)
}

export function buildDivingScorecard(reviewed: DivingReviewedRow[]): DivingScorecard {
  return {
    krFoundCount: reviewed.filter((r) => r.row.kr?.productName).length,
    jpFoundCount: reviewed.filter((r) => r.row.jp?.itemName).length,
    bothPricesPresentCount: reviewed.filter((r) => r.row.bothPricesPresent).length,
    candidateCount: reviewed.filter((r) => r.row.status === "자동 동일 모델 후보" || r.row.status === "검수 필요").length,
    finalValidPricePairCount: reviewed.filter((r) => r.validPricePair).length,
    specialtyShopDependentCount: reviewed.filter((r) => r.specialtyShop === "전문몰 의존").length,
    totalReviewTimeMinutes: reviewed.reduce((sum, r) => sum + (r.decision?.reviewTimeMinutes ?? 0), 0),
    commercialRightsConfirmedCount: reviewed.filter((r) => r.decision?.commercialRightsStatus === "confirmed").length,
  };
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
  const decisionsPath = parseArg("decisions") ?? DEFAULT_DIVING_DECISIONS_PATH;
  if (!krPath || !jpPath) {
    console.error("Usage: review-kr-jp-diving12.ts report --kr=<kr.json> --jp=<jp.json> [--decisions=<path>]");
    process.exit(1);
  }
  const krEntries: KrResultEntry[] = loadJson(krPath);
  const jpEntries: JpResultEntry[] = loadJson(jpPath);
  const decisions = loadDivingDecisions(decisionsPath);
  const reviewed = buildDivingReviewedRows(krEntries, jpEntries, decisions);

  console.log("=== 다이빙 12-item 검수/평가표 리포트 (오프라인, API 호출 없음) ===\n");
  for (const r of reviewed) {
    const ev = PRIOR_EVIDENCE[r.row.item.n];
    console.log(`#${r.row.item.n} [${r.row.item.type}] ${r.row.item.title} - ${r.row.status} | 전문몰: ${r.specialtyShop} | 기존분석: ${ev.bucket}`);
    if (r.priceDataAnomaly) console.log("  가격데이터 이상치 감지");
    if (r.purchasabilityUncertain) console.log("  구매가능성 미확정");
    if (r.decision) console.log(`  검수: ${r.decision.decision} | 검수시간=${r.decision.reviewTimeMinutes ?? "-"}분 | 상업적권리=${r.decision.commercialRightsStatus}`);
    console.log("");
  }

  const scorecard = buildDivingScorecard(reviewed);
  console.log("=== 결과 평가표 ===");
  console.log(`한국 상품 발견 수: ${scorecard.krFoundCount}/12`);
  console.log(`일본 상품 발견 수: ${scorecard.jpFoundCount}/12`);
  console.log(`양국 가격 확보 수: ${scorecard.bothPricesPresentCount}/12`);
  console.log(`동일 상품 후보 수: ${scorecard.candidateCount}/12`);
  console.log(`최종 검증 가능한 가격쌍 수: ${scorecard.finalValidPricePairCount}/12`);
  console.log(`전문 쇼핑몰 의존 상품 수: ${scorecard.specialtyShopDependentCount}/12`);
  console.log(`상품별 검수 시간 합계: ${scorecard.totalReviewTimeMinutes}분`);
  console.log(`상업적 데이터 이용권 확보 수: ${scorecard.commercialRightsConfirmedCount}/12 (0이 기본값 - 별도 확인 전까지 미확정 유지)`);
}

function runDecide() {
  const nArg = parseArg("n");
  const decisionArg = parseArg("decision") as ReviewDecisionValue | undefined;
  const evidence = parseArg("evidence");
  const krPath = parseArg("kr");
  const jpPath = parseArg("jp");
  const decisionsPath = parseArg("decisions") ?? DEFAULT_DIVING_DECISIONS_PATH;
  const reviewer = parseArg("reviewer");
  const reviewMinutesArg = parseArg("reviewMinutes");
  const commercialRightsArg = parseArg("commercialRights") as CommercialRightsStatus | undefined;
  const confirmedOptionAxesArg = parseArg("confirmedOptionAxes");

  if (!nArg || !decisionArg || !evidence || !krPath || !jpPath) {
    console.error(
      'Usage: review-kr-jp-diving12.ts decide --n=<n> --decision=approved|held|rejected --evidence="..." --kr=<kr.json> --jp=<jp.json> ' +
        "[--reviewMinutes=<n>] [--commercialRights=confirmed|unconfirmed|denied] [--confirmedOptionAxes=label1,label2] [--reviewer=<name>] [--decisions=<path>]",
    );
    process.exit(1);
  }
  const n = Number(nArg);
  const krEntries: KrResultEntry[] = loadJson(krPath);
  const jpEntries: JpResultEntry[] = loadJson(jpPath);
  const summary = buildDivingReport(krEntries, jpEntries);
  const row = summary.rows.find((r) => r.item.n === n);
  if (!row) {
    console.error(`n=${n}은 diving 12-item 목록에 없습니다.`);
    process.exit(1);
  }
  const context = approvalContextFromRow(row);
  const confirmedOptionAxes = confirmedOptionAxesArg ? confirmedOptionAxesArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  try {
    const decisions = recordDivingDecision(decisionsPath, n, decisionArg, evidence, context, {
      reviewer,
      confirmedOptionAxes,
      reviewTimeMinutes: reviewMinutesArg ? Number(reviewMinutesArg) : undefined,
      commercialRightsStatus: commercialRightsArg,
    });
    console.log(`Recorded: n=${n} decision=${decisionArg} (status at decision time: ${row.status}) - ${decisions.length} total record(s)`);
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
    console.error("Usage: review-kr-jp-diving12.ts <report|decide> ...");
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("review-kr-jp-diving12.ts")) {
  main();
}
