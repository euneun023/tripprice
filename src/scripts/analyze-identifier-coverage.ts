/**
 * Phase 1-C step 1-2: identifier/model-number coverage analysis (읽기 전용).
 *
 * Phase 0 baseline(commit 5c88042) 429건 + 원본 review.json/searched.json만
 * 읽는다. matching/search 로직은 건드리지 않는다. JAN/UPC/EAN 및
 * modelSkuHint가 실제로 얼마나 존재하고, 존재할 때 listing 텍스트에서
 * token 경계 기준으로 몇 건이나 매치되는지 집계해 "benchmark signal을 만들
 * 근거가 있는지"만 판단한다. 아무것도 evaluator/selectedIndex 자동결정에
 * 연결하지 않는다 - matchesModelToken()(src/scripts/lib/identifierMatch.ts)은
 * 순수 텍스트 판정 함수이고, 이 스크립트는 그 결과를 집계/보고만 한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseline, REVIEW_BATCHES, SEARCHED_ONLY_BATCHES, CANDIDATE_DATA_DIR } from "./build-matching-baseline";
import { isSkuLikeModelSku } from "./evaluate-candidates";
import { matchesModelToken } from "./lib/identifierMatch";

interface RawListing {
  itemName?: string;
  productName?: string;
}
interface RawCandidate {
  productName: string;
  productType: string;
  modelSkuHint?: string | null;
  rakutenResults?: RawListing[];
  coupangResults?: RawListing[];
  rakutenSelectedIndex?: number | null;
  coupangSelectedIndex?: number | null;
}

function loadRaw(file: string): RawCandidate[] {
  return JSON.parse(readFileSync(join(CANDIDATE_DATA_DIR, file), "utf8"));
}

// JAN/EAN(13자리)·UPC(12자리) 바코드가 listing 텍스트 안에 섞여 있는지
// 확인용(구조화된 필드가 아니라 텍스트에 우연히 포함된 경우까지 전부 카운트).
const BARCODE_PATTERN = /\b(?:JAN[:\s]?)?\d{12,13}\b/g;

export interface ModelSkuRow {
  file: string;
  index: number;
  category: string;
  productName: string;
  modelSkuHint: string;
  rakutenMatches: number;
  coupangMatches: number;
  rakutenSelectedMatched: boolean | null; // null = no selection recorded for this source
  coupangSelectedMatched: boolean | null;
}

export interface IdentifierCoverageResult {
  totalCandidates: number;
  barcodeCandidateCount: number;
  totalBarcodeHits: number;
  hasModelSkuHint: number;
  skuLikeModelSkuHint: number;
  notSkuLike: number;
  rows: ModelSkuRow[];
}

export function analyzeIdentifierCoverage(): IdentifierCoverageResult {
  const baselineItems = buildBaseline();
  const rawByFile = new Map<string, RawCandidate[]>();
  for (const batch of [...REVIEW_BATCHES, ...SEARCHED_ONLY_BATCHES]) {
    rawByFile.set(batch.file, loadRaw(batch.file));
  }

  let totalBarcodeHits = 0;
  const barcodeCandidates = new Set<string>();
  let hasModelSkuHint = 0;
  let skuLikeModelSkuHint = 0;
  let notSkuLike = 0;
  const rows: ModelSkuRow[] = [];

  for (const item of baselineItems) {
    const raw = rawByFile.get(item.file)![item.index];
    const allTexts = [...(raw.rakutenResults ?? []).map((r) => r.itemName ?? ""), ...(raw.coupangResults ?? []).map((r) => r.productName ?? "")];
    for (const t of allTexts) {
      const hits = t.match(BARCODE_PATTERN);
      if (hits) {
        totalBarcodeHits += hits.length;
        barcodeCandidates.add(`${item.file}#${item.index}`);
      }
    }

    const hint = raw.modelSkuHint;
    if (!hint) continue;
    hasModelSkuHint++;
    if (isSkuLikeModelSku(hint)) skuLikeModelSkuHint++;
    else {
      notSkuLike++;
      continue; // "24-105mm F4" 형태 등, 이미 repo가 신뢰 불가로 분류한 값 - 분석 제외
    }

    const rakutenTexts = (raw.rakutenResults ?? []).map((r) => r.itemName ?? "");
    const coupangTexts = (raw.coupangResults ?? []).map((r) => r.productName ?? "");
    const rakutenMatches = rakutenTexts.filter((t) => matchesModelToken(t, hint)).length;
    const coupangMatches = coupangTexts.filter((t) => matchesModelToken(t, hint)).length;
    const rakutenSelectedMatched =
      typeof raw.rakutenSelectedIndex === "number" ? matchesModelToken(rakutenTexts[raw.rakutenSelectedIndex] ?? "", hint) : null;
    const coupangSelectedMatched =
      typeof raw.coupangSelectedIndex === "number" ? matchesModelToken(coupangTexts[raw.coupangSelectedIndex] ?? "", hint) : null;

    rows.push({
      file: item.file,
      index: item.index,
      category: item.category,
      productName: item.productName,
      modelSkuHint: hint,
      rakutenMatches,
      coupangMatches,
      rakutenSelectedMatched,
      coupangSelectedMatched,
    });
  }

  return {
    totalCandidates: baselineItems.length,
    barcodeCandidateCount: barcodeCandidates.size,
    totalBarcodeHits,
    hasModelSkuHint,
    skuLikeModelSkuHint,
    notSkuLike,
    rows,
  };
}

function main() {
  const r = analyzeIdentifierCoverage();

  console.log("=== Phase 1-C step 1: JAN/UPC/EAN coverage ===\n");
  console.log(`listing 텍스트 안에서 12~13자리 바코드 패턴이 발견된 candidate 수: ${r.barcodeCandidateCount} / ${r.totalCandidates}`);
  console.log(`발견된 바코드 총 개수(중복 listing 포함): ${r.totalBarcodeHits}`);
  console.log("(참고: candidate-data에 구조화된 JAN/UPC/EAN 필드는 존재하지 않음 - 텍스트 우연 포함만 카운트)\n");

  console.log("=== Phase 1-C step 1: modelSkuHint coverage ===\n");
  console.log(`total candidates: ${r.totalCandidates}`);
  console.log(`modelSkuHint != null: ${r.hasModelSkuHint} (${((r.hasModelSkuHint / r.totalCandidates) * 100).toFixed(1)}%)`);
  console.log(`  중 isSkuLikeModelSku()=true(기존 repo 휴리스틱): ${r.skuLikeModelSkuHint}`);
  console.log(`  중 isSkuLikeModelSku()=false(예: "24-105mm F4" 형태, 분석 제외): ${r.notSkuLike}\n`);

  console.log("=== Phase 1-C step 2: token-boundary match 결과 (SKU-like modelSkuHint 보유 candidate만) ===\n");
  const { rows } = r;
  const uniqueRakuten = rows.filter((x) => x.rakutenMatches === 1).length;
  const multiRakuten = rows.filter((x) => x.rakutenMatches > 1).length;
  const noneRakuten = rows.filter((x) => x.rakutenMatches === 0).length;
  const uniqueCoupang = rows.filter((x) => x.coupangMatches === 1).length;
  const multiCoupang = rows.filter((x) => x.coupangMatches > 1).length;
  const noneCoupang = rows.filter((x) => x.coupangMatches === 0).length;

  console.log(`분석 대상: ${rows.length}건`);
  console.log(`Rakuten: 유일 매치(1건) ${uniqueRakuten} / 다중 매치(2건+, 대개 같은 제품을 여러 판매자가 취급 - 정상) ${multiRakuten} / 매치 없음 ${noneRakuten}`);
  console.log(`Coupang: 유일 매치(1건) ${uniqueCoupang} / 다중 매치(2건+) ${multiCoupang} / 매치 없음 ${noneCoupang}\n`);

  console.log("=== 정밀도 확인: 실제 선택된(selected) listing과 token 매치가 일치하는가 (exact 카테고리) ===\n");
  const exactRows = rows.filter((x) => x.category === "exact");
  const rakutenChecked = exactRows.filter((x) => x.rakutenSelectedMatched !== null);
  const rakutenAgree = rakutenChecked.filter((x) => x.rakutenSelectedMatched === true).length;
  const coupangChecked = exactRows.filter((x) => x.coupangSelectedMatched !== null);
  const coupangAgree = coupangChecked.filter((x) => x.coupangSelectedMatched === true).length;
  console.log(`exact 후보 중 SKU-like modelSkuHint 보유: ${exactRows.length}건`);
  console.log(`  Rakuten selected listing과 token 매치 일치: ${rakutenAgree} / ${rakutenChecked.length}`);
  console.log(`  Coupang selected listing과 token 매치 일치: ${coupangAgree} / ${coupangChecked.length}\n`);

  console.log("=== ambiguous/variant_mismatch 카테고리에서 SKU-like modelSkuHint를 가진 건(false positive 위험 검증 대상) ===\n");
  for (const x of rows.filter((x) => x.category === "ambiguous" || x.category === "variant_mismatch")) {
    console.log(`  [${x.category}] ${x.file} #${x.index} "${x.productName}" hint="${x.modelSkuHint}" rakutenMatches=${x.rakutenMatches} coupangMatches=${x.coupangMatches}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("analyze-identifier-coverage.ts")) {
  main();
}
