/**
 * Offline KR(11st)/JP(Rakuten) comparison report for the same 10-item
 * sample (SELECTED_ITEMS in supply-11st-sample10.ts). Makes NO API call
 * of any kind - reads two already-captured result files the operator
 * supplies (transcribed from the `live` runs of supply-11st-sample10.ts
 * and supply-rakuten-sample10.ts) and cross-matches them by `n`.
 *
 * The headline number this produces is NOT a search-result count - it's
 * "얼마나 많은 품목에서 한국·일본 양쪽 모두 판매자별 가격이 확인됐는가"
 * (동일 상품 확정 rows where BOTH a KRW and a JPY price are present).
 *
 * Usage:
 *   npx tsx src/scripts/compare-kr-jp-sample10.ts --kr=<path.json> --jp=<path.json>
 *
 * Input file schema: see KrResultEntry/JpResultEntry below. Run with no
 * args (or a missing/unreadable path) to print that schema instead of a
 * bare crash - this is the "원본 결과가 없으면 필요한 로그 항목만 요청"
 * behavior: it tells you exactly which fields to transcribe from the
 * `live` console output, rather than asking for a re-run.
 *
 * Never prints or reads any API key/credential - these result files are
 * plain product data (name/seller/price/URL), not secrets.
 */
import { readFileSync } from "node:fs";
import { normalize } from "../match";
import { SELECTED_ITEMS, type Classification, type SelectedItem } from "./supply-11st-sample10";

export interface KrResultEntry {
  n: number;
  classification: Classification;
  productName?: string;
  seller?: string;
  priceKrw?: number;
  salePriceKrw?: number;
  url?: string;
  /** "label:token" strings, copied verbatim from supply-11st-sample10.ts
   * live output's "detected: ..." line, if present. */
  detectedOptionHints?: string[];
  /** Copied from that same output's "delivery/stock wording found: ..." line. */
  deliveryUncertain?: string[];
}

export interface JpResultEntry {
  n: number;
  classification: Classification;
  itemName?: string;
  shop?: string;
  priceJpy?: number;
  availability?: 0 | 1;
  url?: string;
  detectedOptionHints?: string[];
  deliveryUncertain?: string[];
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
  // mount
  "e마운트": "mount_e",
  소니e: "mount_e",
  sonye: "mount_e",
  "eマウント": "mount_e",
  ソニーe: "mount_e",
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

export type OptionAxisStatus = "일치" | "불일치" | "미확인";

export interface OptionAxisResult {
  label: string;
  status: OptionAxisStatus;
  krValues: string[];
  jpValues: string[];
}

/** Compares every hardOptionGroups axis the item declares (empty array
 * when the item has none - callers treat that as "해당없음", not a
 * failure). "불일치" requires POSITIVE evidence on both sides that
 * disagrees (e.g. KR detected silver, JP detected black) - absence of
 * detection on either side is "미확인", never silently treated as a
 * match or a mismatch. */
export function compareOptionAxes(item: SelectedItem, krHints: string[] | undefined, jpHints: string[] | undefined): OptionAxisResult[] {
  const krByLabel = groupHintsByLabel(krHints);
  const jpByLabel = groupHintsByLabel(jpHints);
  return (item.hardOptionGroups ?? []).map((g) => {
    const kr = krByLabel.get(g.label) ?? new Set<string>();
    const jp = jpByLabel.get(g.label) ?? new Set<string>();
    let status: OptionAxisStatus;
    if (kr.size === 0 || jp.size === 0) status = "미확인";
    else status = [...kr].some((v) => jp.has(v)) ? "일치" : "불일치";
    return { label: g.label, status, krValues: [...kr], jpValues: [...jp] };
  });
}

export type RowStatus = "동일 상품 확정" | "검수 필요" | "불일치" | "데이터없음";

export interface ComparisonRow {
  item: SelectedItem;
  kr?: KrResultEntry;
  jp?: JpResultEntry;
  optionAxes: OptionAxisResult[];
  status: RowStatus;
  reasons: string[];
  /** The headline KPI's per-row ingredient: true only when status is
   * "동일 상품 확정" AND both a KRW and a JPY price are present. */
  bothPricesConfirmed: boolean;
}

const NON_IDENTITY_CLASSIFICATIONS: Classification[] = ["MISMATCH", "REJECTED_ACCESSORY"];

export function compareRow(item: SelectedItem, kr: KrResultEntry | undefined, jp: JpResultEntry | undefined): ComparisonRow {
  if (!kr || !jp) {
    return {
      item,
      kr,
      jp,
      optionAxes: [],
      status: "데이터없음",
      reasons: [!kr && !jp ? "KR/JP 데이터 모두 없음" : !kr ? "KR 데이터 없음" : "JP 데이터 없음"],
      bothPricesConfirmed: false,
    };
  }

  const reasons: string[] = [];

  if (NON_IDENTITY_CLASSIFICATIONS.includes(kr.classification)) reasons.push(`KR 쪽이 ${kr.classification} (본품 아님)`);
  if (NON_IDENTITY_CLASSIFICATIONS.includes(jp.classification)) reasons.push(`JP 쪽이 ${jp.classification} (본품 아님)`);
  if (reasons.length > 0) {
    return { item, kr, jp, optionAxes: [], status: "불일치", reasons, bothPricesConfirmed: false };
  }

  const optionAxes = compareOptionAxes(item, kr.detectedOptionHints, jp.detectedOptionHints);
  const mismatchedAxes = optionAxes.filter((a) => a.status === "불일치");
  if (mismatchedAxes.length > 0) {
    for (const a of mismatchedAxes) reasons.push(`옵션 불일치(${a.label}): KR=${a.krValues.join("/")} vs JP=${a.jpValues.join("/")}`);
    return { item, kr, jp, optionAxes, status: "불일치", reasons, bothPricesConfirmed: false };
  }

  const unresolvedAxes = optionAxes.filter((a) => a.status === "미확인");
  if (kr.classification === "NEEDS_REVIEW") reasons.push("KR 쪽이 NEEDS_REVIEW");
  if (jp.classification === "NEEDS_REVIEW") reasons.push("JP 쪽이 NEEDS_REVIEW");
  for (const a of unresolvedAxes) reasons.push(`옵션 미확인(${a.label}): KR=${a.krValues.join("/") || "-"} / JP=${a.jpValues.join("/") || "-"}`);

  if (reasons.length > 0) {
    return { item, kr, jp, optionAxes, status: "검수 필요", reasons, bothPricesConfirmed: false };
  }

  const krPrice = kr.salePriceKrw ?? kr.priceKrw;
  const jpPrice = jp.priceJpy;
  const bothPricesConfirmed = krPrice != null && jpPrice != null;
  return { item, kr, jp, optionAxes, status: "동일 상품 확정", reasons: [], bothPricesConfirmed };
}

export interface ComparisonSummary {
  rows: ComparisonRow[];
  confirmed: number;
  needsReview: number;
  mismatch: number;
  noData: number;
  bothPricesConfirmedCount: number;
}

export function summarize(rows: ComparisonRow[]): ComparisonSummary {
  return {
    rows,
    confirmed: rows.filter((r) => r.status === "동일 상품 확정").length,
    needsReview: rows.filter((r) => r.status === "검수 필요").length,
    mismatch: rows.filter((r) => r.status === "불일치").length,
    noData: rows.filter((r) => r.status === "데이터없음").length,
    bothPricesConfirmedCount: rows.filter((r) => r.bothPricesConfirmed).length,
  };
}

export function buildReport(krEntries: KrResultEntry[], jpEntries: JpResultEntry[]): ComparisonSummary {
  const krByN = new Map(krEntries.map((e) => [e.n, e]));
  const jpByN = new Map(jpEntries.map((e) => [e.n, e]));
  const rows = SELECTED_ITEMS.map((item) => compareRow(item, krByN.get(item.n), jpByN.get(item.n)));
  return summarize(rows);
}

function printSchemaAndExit(): never {
  console.log(
    [
      "KR/JP 비교 리포트를 만들 원본 데이터가 없습니다 - 추가 API 호출 없이, 아래 스키마에 맞는 JSON 파일 2개만 필요합니다.",
      "",
      "각 파일은 이 10개 n 값(1,2,3,4,5,6,7,9,12,25)에 대한 항목 배열입니다 - 없는 n은 건너뛰어도 됩니다 (데이터없음으로 표시).",
      "",
      "KR 파일 (supply-11st-sample10.ts live 출력의 'best candidate' 줄에서 그대로 옮기면 됩니다):",
      JSON.stringify(
        [
          {
            n: 4,
            classification: "EXACT_CANDIDATE",
            productName: "...",
            seller: "...",
            priceKrw: 0,
            salePriceKrw: 0,
            url: "...",
            detectedOptionHints: [],
            deliveryUncertain: [],
          },
        ],
        null,
        2,
      ),
      "",
      "JP 파일 (supply-rakuten-sample10.ts live 출력에서 그대로 옮기면 됩니다):",
      JSON.stringify(
        [
          {
            n: 4,
            classification: "EXACT_CANDIDATE",
            itemName: "...",
            shop: "...",
            priceJpy: 0,
            availability: 1,
            url: "...",
            detectedOptionHints: [],
            deliveryUncertain: [],
          },
        ],
        null,
        2,
      ),
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
  lines.push(`#${row.item.n} [${row.item.type}] ${row.item.title} - ${row.status}`);
  if (row.kr) {
    lines.push(
      `  KR: ${row.kr.classification} | ${row.kr.productName ?? "(no name)"} | seller=${row.kr.seller ?? "-"} | ` +
        `price=${row.kr.priceKrw ?? "-"}원 saleprice=${row.kr.salePriceKrw ?? "-"}원 | url=${row.kr.url ?? "-"}`,
    );
    if (row.kr.deliveryUncertain?.length) lines.push(`      (KR 납기/재고 문구: ${row.kr.deliveryUncertain.join(", ")})`);
  } else {
    lines.push("  KR: (데이터 없음)");
  }
  if (row.jp) {
    lines.push(
      `  JP: ${row.jp.classification} | ${row.jp.itemName ?? "(no name)"} | shop=${row.jp.shop ?? "-"} | ` +
        `price=${row.jp.priceJpy ?? "-"}円 availability=${row.jp.availability ?? "-"} | url=${row.jp.url ?? "-"}`,
    );
    if (row.jp.deliveryUncertain?.length) lines.push(`      (JP 납기/재고 문구: ${row.jp.deliveryUncertain.join(", ")})`);
  } else {
    lines.push("  JP: (데이터 없음)");
  }
  for (const a of row.optionAxes) lines.push(`  옵션[${a.label}]: ${a.status} (KR=${a.krValues.join("/") || "-"} / JP=${a.jpValues.join("/") || "-"})`);
  for (const r of row.reasons) lines.push(`  - ${r}`);
  if (row.bothPricesConfirmed) lines.push(`  >> 양국 판매자 가격 모두 확인됨 (KRW ${row.kr!.salePriceKrw ?? row.kr!.priceKrw} / JPY ${row.jp!.priceJpy})`);
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

  console.log("=== KR(11st)/JP(Rakuten) 10-item 비교 리포트 (오프라인, API 호출 없음) ===\n");
  for (const row of summary.rows) {
    console.log(formatRow(row));
    console.log("");
  }

  console.log("=== 최종 집계 ===");
  console.log(`동일 상품 확정: ${summary.confirmed}`);
  console.log(`검수 필요: ${summary.needsReview}`);
  console.log(`불일치: ${summary.mismatch}`);
  console.log(`데이터없음: ${summary.noData}`);
  console.log(`>>> 양국 판매자별 가격이 모두 확인된 상품 수 (최종 목표 지표): ${summary.bothPricesConfirmedCount}`);
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("compare-kr-jp-sample10.ts")) {
  main();
}
