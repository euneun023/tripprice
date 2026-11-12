/**
 * Offline KR(11st)/JP(Rakuten) comparison report for the same 10-item
 * sample (SELECTED_ITEMS in supply-11st-sample10.ts). Makes NO API call
 * of any kind - reads two already-captured result files (either written
 * automatically by supply-11st-sample10.ts's `live` mode, or transcribed
 * by hand for Rakuten) and cross-matches them by `n`.
 *
 * The headline number this produces is NOT a search-result count - it's
 * "얼마나 많은 품목에서 한국·일본 양쪽 모두 판매자별 가격이 확인됐는가"
 * (최종 검증 완료 rows where BOTH a KRW and a JPY price are present - see
 * "자동 vs 최종" below for why that's a stricter bar than "looks right").
 *
 * Usage:
 *   npx tsx src/scripts/compare-kr-jp-sample10.ts --kr=<path.json> --jp=<path.json>
 *
 * Input file schema: see KrResultEntry/JpResultEntry below. Run with no
 * args (or a missing/unreadable path) to print that schema instead of a
 * bare crash - this is the "원본 결과가 없으면 필요한 로그 항목만 요청"
 * behavior: it tells you exactly which fields to transcribe, rather than
 * asking for a re-run.
 *
 * RE-CLASSIFICATION: a `classification`/hint value sitting in an input
 * file can go stale the moment classifyCandidate() itself changes (e.g.
 * this review's own REJECTED_ACCESSORY/hardOptionGroups additions) - so
 * whenever an entry carries its raw name (productName/itemName), this
 * module ALWAYS recomputes classification/detectedOptionHints/
 * deliveryUncertain/rejectedAccessoryPhrase from that name with the
 * CURRENT classifier (reclassifyKr/reclassifyJp below), discarding
 * whatever was stored in the file. This is what "기존 JP JSON을 수정된
 * 분류기로 오프라인 재검증" means in practice - no network call, just a
 * pure re-run of the latest matching logic over already-captured names.
 *
 * Never prints or reads any API key/credential - these result files are
 * plain product data (name/seller/price/URL), not secrets.
 */
import { readFileSync } from "node:fs";
import { normalize } from "../match";
import { SELECTED_ITEMS, classifyCandidate, type Classification, type SelectedItem } from "./supply-11st-sample10";
import { JP_ITEMS } from "./supply-rakuten-sample10";

export interface KrResultEntry {
  n: number;
  /** Raw product name - when present, classification/hints below are
   * ALWAYS recomputed from this via the current classifier (see file
   * header); a value already in the file is only a fallback for when
   * productName is missing (e.g. hand-entered without it). */
  productName?: string;
  productCode?: string;
  seller?: string;
  priceKrw?: number;
  salePriceKrw?: number;
  url?: string;
  classification?: Classification;
  /** "label:token" strings - recomputed when productName is present. */
  detectedOptionHints?: string[];
  /** Recomputed when productName is present. */
  deliveryUncertain?: string[];
  /** Recomputed when productName is present - which exclude term(s) or
   * accessory modifier+noun pair caused NEEDS_REVIEW/REJECTED_ACCESSORY. */
  reviewReason?: string[];
  /** Whether a human has actually looked at this specific candidate and
   * confirmed it's the same real listing - separate from the automatic
   * classification, which only ever says "looks right by text rules".
   * Defaults to false/unset (never assumed true). */
  humanVerified?: boolean;
}

export interface JpResultEntry {
  n: number;
  itemName?: string;
  shop?: string;
  priceJpy?: number;
  availability?: 0 | 1;
  url?: string;
  classification?: Classification;
  detectedOptionHints?: string[];
  deliveryUncertain?: string[];
  reviewReason?: string[];
  humanVerified?: boolean;
}

/**
 * Canonicalizes a hardOptionGroups token to a language-neutral label so
 * "실버"(KR)/"シルバー"(JP)/"Silver"(either) are recognized as the same
 * value. Deliberately a small, explicit, hand-written table - only
 * covers the tokens SELECTED_ITEMS/JP_ITEMS actually declare for color/
 * mount today; an unrecognized token falls back to its own normalized
 * form (still comparable to itself, just not cross-mapped), rather than
 * silently guessing a translation.
 */
const OPTION_TOKEN_CANON: Record<string, string> = {
  // color
  실버: "silver",
  silver: "silver",
  シルバー: "silver",
  블랙: "black",
  black: "black",
  ブラック: "black",
  차콜: "charcoal",
  charcoal: "charcoal",
  チャコール: "charcoal",
  그레이: "grey",
  grey: "grey",
  gray: "grey",
  グレー: "grey",
  화이트: "white",
  white: "white",
  ホワイト: "white",
  // mount - "FE"/"소니FE"/"ソニーFE" map to the SAME mount_e value as
  // "E마운트"/"Sony E" etc.: FE is Sony's own full-frame E-mount branding,
  // and a real KR candidate written as "Sony FE용" went unrecognized
  // before this was added (see supply-11st-sample10.ts item #5's comment).
  "e마운트": "mount_e",
  소니e: "mount_e",
  sonye: "mount_e",
  "eマウント": "mount_e",
  ソニーe: "mount_e",
  fe: "mount_e",
  소니fe: "mount_e",
  sonyfe: "mount_e",
  "fe마운트": "mount_e",
  ソニーfe: "mount_e",
  "feマウント": "mount_e",
  "z마운트": "mount_z",
  니콘z: "mount_z",
  nikonz: "mount_z",
  "zマウント": "mount_z",
  ニコンz: "mount_z",
  "x마운트": "mount_x",
  후지x: "mount_x",
  fujix: "mount_x",
  "xマウント": "mount_x",
  フジx: "mount_x",
  "rf마운트": "mount_rf",
  canonrf: "mount_rf",
  "rfマウント": "mount_rf",
  // config (body-only vs lens-kit) - added after a real case: KR="X-H2 +
  // XF 16-80mm 렌즈킷" (kit) vs JP="X-H2 바디 단품" (body) individually
  // both classified EXACT but the configuration itself was never
  // compared - see supply-11st-sample10.ts's CAMERA_BODY_CONFIG_GROUP.
  바디: "config_body",
  단품: "config_body",
  body: "config_body",
  ボディ: "config_body",
  単品: "config_body",
  키트: "config_kit",
  렌즈킷: "config_kit",
  렌즈포함: "config_kit",
  세트: "config_kit",
  kit: "config_kit",
  キット: "config_kit",
  レンズキット: "config_kit",
  レンズ付き: "config_kit",
  セット: "config_kit",
};

function canon(rawToken: string): string {
  const key = normalize(rawToken);
  return OPTION_TOKEN_CANON[key] ?? key;
}

/** Groups "label:token" hints into label -> set of canonical tokens. */
function groupHintsByLabel(hints: string[] | undefined): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const h of hints ?? []) {
    const idx = h.indexOf(":");
    if (idx < 0) continue;
    const label = h.slice(0, idx);
    const token = h.slice(idx + 1);
    if (!map.has(label)) map.set(label, new Set());
    map.get(label)!.add(canon(token));
  }
  return map;
}

export type OptionAxisStatus = "일치" | "불일치" | "미확인" | "해당없음";

export interface OptionAxisResult {
  label: string;
  status: OptionAxisStatus;
  krValues: string[];
  jpValues: string[];
}

/**
 * Compares every hardOptionGroups axis the item declares (empty array
 * when the item has none). "불일치" ALWAYS requires POSITIVE evidence on
 * both sides that disagrees (e.g. KR detected silver, JP detected black)
 * - this is true for both hard and soft axes, and is what forces
 * compareRow's status to 불일치 regardless of axis kind.
 *
 * When neither/one side detected anything, the result differs by axis
 * kind:
 *   - hard axis (color/mount - g.soft is falsy): "미확인" - compareRow
 *     treats this as a reason to fall back to 검수 필요, since these
 *     axes are expected to basically always be checkable on a real
 *     listing.
 *   - soft axis (config - g.soft is true): "해당없음" - NOT surfaced as
 *     a reason at all, so an item whose real text never mentions kit/
 *     body wording on either side is completely unaffected by this axis
 *     existing (requirement: adding config-conflict detection to #1/#3
 *     must not regress their current classification when there's no
 *     actual conflict to find).
 */
export function compareOptionAxes(item: SelectedItem, krHints: string[] | undefined, jpHints: string[] | undefined): OptionAxisResult[] {
  const krByLabel = groupHintsByLabel(krHints);
  const jpByLabel = groupHintsByLabel(jpHints);
  return (item.hardOptionGroups ?? []).map((g) => {
    const kr = krByLabel.get(g.label) ?? new Set<string>();
    const jp = jpByLabel.get(g.label) ?? new Set<string>();
    let status: OptionAxisStatus;
    if (kr.size === 0 || jp.size === 0) status = g.soft ? "해당없음" : "미확인";
    else status = [...kr].some((v) => jp.has(v)) ? "일치" : "불일치";
    return { label: g.label, status, krValues: [...kr], jpValues: [...jp] };
  });
}

function buildReviewReason(c: ReturnType<typeof classifyCandidate>): string[] {
  const reasons = [...c.matchedExcludeTerms];
  if (c.rejectedAccessoryPhrase) reasons.push(`accessory:${c.rejectedAccessoryPhrase}`);
  return reasons;
}

/** Recomputes classification/detectedOptionHints/deliveryUncertain/
 * reviewReason from entry.productName using the CURRENT classifier - see
 * file header's "RE-CLASSIFICATION" note. A no-op (returns entry as-is)
 * when productName is missing or n doesn't match a SELECTED_ITEMS entry. */
export function reclassifyKr(entry: KrResultEntry): KrResultEntry {
  const item = SELECTED_ITEMS.find((i) => i.n === entry.n);
  if (!item || !entry.productName) return entry;
  const c = classifyCandidate(item, {
    productName: entry.productName,
    productCode: entry.productCode,
    seller: entry.seller,
    productPrice: entry.priceKrw?.toString(),
    salePrice: entry.salePriceKrw?.toString(),
    detailPageUrl: entry.url,
  });
  return {
    ...entry,
    classification: c.classification,
    detectedOptionHints: c.detectedOptionHints,
    deliveryUncertain: c.matchedDeliveryUncertaintyTerms,
    reviewReason: buildReviewReason(c),
  };
}

/** JP equivalent of reclassifyKr - see file header. */
export function reclassifyJp(entry: JpResultEntry): JpResultEntry {
  const item = JP_ITEMS.find((i) => i.n === entry.n);
  if (!item || !entry.itemName) return entry;
  const c = classifyCandidate(item, { productName: entry.itemName });
  return {
    ...entry,
    classification: c.classification,
    detectedOptionHints: c.detectedOptionHints,
    deliveryUncertain: c.matchedDeliveryUncertaintyTerms,
    reviewReason: buildReviewReason(c),
  };
}

/**
 * "자동 동일 모델 후보" (renamed from "동일 상품 확정" - the old name
 * overstated what a text-rule classifier can actually promise): this
 * status means the automatic rules found nothing wrong, NOT that a human
 * has verified it - see ComparisonRow.humanVerified/finalVerified for
 * that distinct question.
 */
export type RowStatus = "자동 동일 모델 후보" | "검수 필요" | "불일치" | "데이터없음";

export interface ComparisonRow {
  item: SelectedItem;
  kr?: KrResultEntry;
  jp?: JpResultEntry;
  optionAxes: OptionAxisResult[];
  status: RowStatus;
  reasons: string[];
  /** Pure data-presence signal, independent of status: true whenever
   * BOTH sides have a price field, even for a 검수필요/불일치 row. This
   * is "양국 가격 필드 확보 수" - how much raw price data exists at all,
   * separate from how much of it is verified/trustworthy. */
  bothPricesPresent: boolean;
  /** True only when BOTH kr.humanVerified and jp.humanVerified are true. */
  bothHumanVerified: boolean;
  /** "최종 검증 완료" - status is 자동 동일 모델 후보 AND a human has
   * actually verified both sides. This, not the raw classification, is
   * the bar for treating a KR/JP pair as a confirmed same-product price
   * comparison. */
  finalVerified: boolean;
}

const NON_IDENTITY_CLASSIFICATIONS: Classification[] = ["MISMATCH", "REJECTED_ACCESSORY"];

function hasPrice(kr?: KrResultEntry, jp?: JpResultEntry): boolean {
  if (!kr || !jp) return false;
  const krPrice = kr.salePriceKrw ?? kr.priceKrw;
  return krPrice != null && jp.priceJpy != null;
}

export function compareRow(item: SelectedItem, kr: KrResultEntry | undefined, jp: JpResultEntry | undefined): ComparisonRow {
  const bothPricesPresent = hasPrice(kr, jp);
  const bothHumanVerified = Boolean(kr?.humanVerified && jp?.humanVerified);
  const base = { item, kr, jp, bothPricesPresent, bothHumanVerified, finalVerified: false as const };

  // Checked FIRST and independently per side, BEFORE the "both must
  // exist" check below - requirement: a JP REJECTED_ACCESSORY (or
  // MISMATCH) must be reported as such even when KR has no data at all,
  // not swallowed into a generic "데이터없음".
  const reasons: string[] = [];
  if (jp && NON_IDENTITY_CLASSIFICATIONS.includes(jp.classification as Classification)) {
    reasons.push(`JP 쪽이 ${jp.classification} (본품 아님)${jp.reviewReason?.length ? ` [${jp.reviewReason.join(", ")}]` : ""}`);
  }
  if (kr && NON_IDENTITY_CLASSIFICATIONS.includes(kr.classification as Classification)) {
    reasons.push(`KR 쪽이 ${kr.classification} (본품 아님)${kr.reviewReason?.length ? ` [${kr.reviewReason.join(", ")}]` : ""}`);
  }
  if (reasons.length > 0) {
    return { ...base, optionAxes: [], status: "불일치", reasons };
  }

  if (!kr || !jp) {
    return {
      ...base,
      optionAxes: [],
      status: "데이터없음",
      reasons: [!kr && !jp ? "KR/JP 데이터 모두 없음" : !kr ? "KR 데이터 없음" : "JP 데이터 없음"],
    };
  }

  // 모델·세대·마운트·색상·구성(hardOptionGroups) 불일치는 절대 자동 확정
  // 하지 않음 - 양쪽이 서로 다른 값을 "확인"했을 때만 불일치로 간주하고,
  // 그 외에는(미확인 포함) 검수 필요로 내려간다(아래).
  const optionAxes = compareOptionAxes(item, kr.detectedOptionHints, jp.detectedOptionHints);
  const mismatchedAxes = optionAxes.filter((a) => a.status === "불일치");
  if (mismatchedAxes.length > 0) {
    for (const a of mismatchedAxes) reasons.push(`옵션 불일치(${a.label}): KR=${a.krValues.join("/")} vs JP=${a.jpValues.join("/")}`);
    return { ...base, optionAxes, status: "불일치", reasons };
  }

  const unresolvedAxes = optionAxes.filter((a) => a.status === "미확인");
  if (kr.classification === "NEEDS_REVIEW") reasons.push("KR 쪽이 NEEDS_REVIEW");
  if (jp.classification === "NEEDS_REVIEW") reasons.push("JP 쪽이 NEEDS_REVIEW");
  for (const a of unresolvedAxes) reasons.push(`옵션 미확인(${a.label}): KR=${a.krValues.join("/") || "-"} / JP=${a.jpValues.join("/") || "-"}`);

  if (reasons.length > 0) {
    return { ...base, optionAxes, status: "검수 필요", reasons };
  }

  return { ...base, optionAxes, status: "자동 동일 모델 후보", reasons: [], finalVerified: bothHumanVerified };
}

export interface ComparisonSummary {
  rows: ComparisonRow[];
  autoCandidateCount: number;
  needsReview: number;
  mismatch: number;
  noData: number;
  /** Rows rejected as 불일치 specifically because JP alone was
   * REJECTED_ACCESSORY, with no KR data at all to compare against -
   * surfaced separately per requirement: report the exclusion even
   * without KR data, not lump it into the generic 불일치 count. */
  jpRejectedAccessoryWithoutKr: number;
  /** "양국 가격 필드 확보 수" - data presence, independent of status. */
  bothPricesPresentCount: number;
  /** "최종 검증 완료 수" - the actual bar for a trustworthy comparison. */
  finalVerifiedCount: number;
}

export function summarize(rows: ComparisonRow[]): ComparisonSummary {
  return {
    rows,
    autoCandidateCount: rows.filter((r) => r.status === "자동 동일 모델 후보").length,
    needsReview: rows.filter((r) => r.status === "검수 필요").length,
    mismatch: rows.filter((r) => r.status === "불일치").length,
    noData: rows.filter((r) => r.status === "데이터없음").length,
    jpRejectedAccessoryWithoutKr: rows.filter((r) => !r.kr && r.jp?.classification === "REJECTED_ACCESSORY").length,
    bothPricesPresentCount: rows.filter((r) => r.bothPricesPresent).length,
    finalVerifiedCount: rows.filter((r) => r.finalVerified).length,
  };
}

export function buildReport(krEntries: KrResultEntry[], jpEntries: JpResultEntry[]): ComparisonSummary {
  const krByN = new Map(krEntries.map((e) => [e.n, reclassifyKr(e)]));
  const jpByN = new Map(jpEntries.map((e) => [e.n, reclassifyJp(e)]));
  const rows = SELECTED_ITEMS.map((item) => compareRow(item, krByN.get(item.n), jpByN.get(item.n)));
  return summarize(rows);
}

function printSchemaAndExit(): never {
  console.log(
    [
      "KR/JP 비교 리포트를 만들 원본 데이터가 없습니다 - 추가 API 호출 없이, 아래 스키마에 맞는 JSON 파일 2개만 필요합니다.",
      "",
      "각 파일은 이 10개 n 값(1,2,3,4,5,6,7,9,12,25)에 대한 항목 배열입니다 - 없는 n은 건너뛰어도 됩니다 (데이터없음으로 표시).",
      "classification/detectedOptionHints/deliveryUncertain/reviewReason은 productName(KR)/itemName(JP)만 있으면 현재 분류기로 자동 재계산되므로 안 넣어도 됩니다.",
      "",
      "KR 파일 (supply-11st-sample10.ts live 실행 시 --out으로 자동 저장되는 형식과 동일합니다):",
      JSON.stringify(
        [{ n: 4, productName: "...", productCode: "...", seller: "...", priceKrw: 0, salePriceKrw: 0, url: "...", humanVerified: false }],
        null,
        2,
      ),
      "",
      "JP 파일 (supply-rakuten-sample10.ts live 출력의 itemName/shop/price/url을 그대로 옮기면 됩니다):",
      JSON.stringify([{ n: 4, itemName: "...", shop: "...", priceJpy: 0, availability: 1, url: "...", humanVerified: false }], null, 2),
      "",
      "실행: npx tsx src/scripts/compare-kr-jp-sample10.ts --kr=<kr.json> --jp=<jp.json>",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function formatRow(row: ComparisonRow): string {
  const lines: string[] = [];
  lines.push(`#${row.item.n} [${row.item.type}] ${row.item.title} - ${row.status}${row.finalVerified ? " (최종 검증 완료)" : ""}`);
  if (row.kr) {
    lines.push(
      `  KR: ${row.kr.classification ?? "(미분류)"} | ${row.kr.productName ?? "(no name)"} | code=${row.kr.productCode ?? "-"} | seller=${row.kr.seller ?? "-"} | ` +
        `price=${row.kr.priceKrw ?? "-"}원 saleprice=${row.kr.salePriceKrw ?? "-"}원 | url=${row.kr.url ?? "-"} | humanVerified=${row.kr.humanVerified ?? false}`,
    );
    if (row.kr.deliveryUncertain?.length) lines.push(`      (KR 납기/재고 문구: ${row.kr.deliveryUncertain.join(", ")})`);
    if (row.kr.reviewReason?.length) lines.push(`      (KR 검수 사유: ${row.kr.reviewReason.join(", ")})`);
  } else {
    lines.push("  KR: (데이터 없음)");
  }
  if (row.jp) {
    lines.push(
      `  JP: ${row.jp.classification ?? "(미분류)"} | ${row.jp.itemName ?? "(no name)"} | shop=${row.jp.shop ?? "-"} | ` +
        `price=${row.jp.priceJpy ?? "-"}円 availability=${row.jp.availability ?? "-"} | url=${row.jp.url ?? "-"} | humanVerified=${row.jp.humanVerified ?? false}`,
    );
    if (row.jp.deliveryUncertain?.length) lines.push(`      (JP 납기/재고 문구: ${row.jp.deliveryUncertain.join(", ")})`);
    if (row.jp.reviewReason?.length) lines.push(`      (JP 검수 사유: ${row.jp.reviewReason.join(", ")})`);
  } else {
    lines.push("  JP: (데이터 없음)");
  }
  for (const a of row.optionAxes) lines.push(`  옵션[${a.label}]: ${a.status} (KR=${a.krValues.join("/") || "-"} / JP=${a.jpValues.join("/") || "-"})`);
  for (const r of row.reasons) lines.push(`  - ${r}`);
  if (row.bothPricesPresent) lines.push(`  (양국 가격 필드 모두 존재 - 최종 검증 여부와는 별개)`);
  return lines.join("\n");
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

  const summary = buildReport(krEntries, jpEntries);

  console.log("=== KR(11st)/JP(Rakuten) 10-item 비교 리포트 (오프라인, API 호출 없음, 최신 분류기로 재검증) ===\n");
  for (const row of summary.rows) {
    console.log(formatRow(row));
    console.log("");
  }

  console.log("=== 최종 집계 ===");
  console.log(`자동 동일 모델 후보: ${summary.autoCandidateCount} (사람 검수 전 - humanVerified 아님)`);
  console.log(`검수 필요: ${summary.needsReview}`);
  console.log(`불일치: ${summary.mismatch}`);
  console.log(`  - 그중 JP가 REJECTED_ACCESSORY라 KR 데이터 없이도 제외된 수: ${summary.jpRejectedAccessoryWithoutKr}`);
  console.log(`데이터없음: ${summary.noData}`);
  console.log(`양국 가격 필드 확보 수 (상태 무관, 데이터 존재 여부만): ${summary.bothPricesPresentCount}`);
  console.log(`>>> 최종 검증 완료 수 (자동 동일 모델 후보 + 양쪽 humanVerified=true) - 실제 목표 지표: ${summary.finalVerifiedCount}`);
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("compare-kr-jp-sample10.ts")) {
  main();
}
