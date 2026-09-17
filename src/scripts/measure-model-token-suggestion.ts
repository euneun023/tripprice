/**
 * Phase 1-D: model-number suggestion Gate 평가 + 측정 (읽기 전용).
 *
 * Phase 1-C의 unique-match(Rakuten 5건/Coupang 15건)를 실제 human-selected
 * listing과 대조해 정밀도를 계산하고, 불일치 원인을 분류한다
 * (variant/kit/bundle/다른 seller listing/기타). 그 결과로 Gate를
 * 판정한다 - 통과 여부와 근거를 그대로 출력한다. matching/search 로직은
 * 건드리지 않고, review.json/searched.json/matching-baseline만 읽는다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseline, REVIEW_BATCHES, SEARCHED_ONLY_BATCHES, CANDIDATE_DATA_DIR, type BaselineItem } from "./build-matching-baseline";
import { matchesModelToken } from "./lib/identifierMatch";
import { classifyListingText } from "./lib/negativeFilter";
import { buildModelTokenSuggestion } from "./lib/modelTokenSuggestion";
import { analyzeIdentifierCoverage } from "./analyze-identifier-coverage";

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
  rakutenReviewStatus?: string;
  coupangReviewStatus?: string;
}

export type MismatchCause = "variant" | "kit" | "bundle" | "accessory_compat_mention" | "other_seller_listing" | "coincidental_code" | "other";

export interface UniqueMatchRow {
  source: "rakuten" | "coupang";
  file: string;
  index: number;
  category: string;
  productName: string;
  modelSkuHint: string;
  matchedListingIndex: number;
  matchedListingText: string;
  matchedListingIsNegative: boolean; // negativeFilter가 이 listing을 이미 accessory/wrong_category/used로 걸러내는가
  selectedIndex: number | null; // 실제 human-recorded selection (null = 기록 없음)
  agrees: boolean | null; // null = ground truth 없음(비교 불가)
  mismatchCause: MismatchCause | null; // agrees===false일 때만
}

function loadRaw(file: string): RawCandidate[] {
  return JSON.parse(readFileSync(join(CANDIDATE_DATA_DIR, file), "utf8"));
}

// Phase 1-D 조사에서 직접 읽고 분류한 근거(수작업 분류 - 각 listing 텍스트를
// 실제로 읽어 판단했다). 새 데이터가 추가되면 이 표도 다시 검토해야 한다.
const MANUAL_MISMATCH_CAUSE: Record<string, MismatchCause> = {
  "phase2-camera-lens-candidates.review.json#18#rakuten": "variant", // Tamron 12-20mm: A084(Nikon Z listing) matched, actual selected was A084S(Sony E)
  "camera-lens-candidates.review.json#3#coupang": "bundle", // Sony FE 50mm F1.2 GM: matched listing is a filter+cleaning-kit bundle, selected was the plain single lens
};

function classify(rows: Omit<UniqueMatchRow, "mismatchCause">[]): UniqueMatchRow[] {
  return rows.map((r) => {
    if (r.agrees !== false) return { ...r, mismatchCause: null };
    const key = `${r.file}#${r.index}#${r.source}`;
    return { ...r, mismatchCause: MANUAL_MISMATCH_CAUSE[key] ?? "other" };
  });
}

function main() {
  const baselineItems = buildBaseline();
  const rawByFile = new Map<string, RawCandidate[]>();
  for (const batch of [...REVIEW_BATCHES, ...SEARCHED_ONLY_BATCHES]) {
    rawByFile.set(batch.file, loadRaw(batch.file));
  }
  const { rows: coverageRows } = analyzeIdentifierCoverage();

  function buildRows(source: "rakuten" | "coupang"): Omit<UniqueMatchRow, "mismatchCause">[] {
    const matchField = source === "rakuten" ? "rakutenMatches" : "coupangMatches";
    const unique = coverageRows.filter((r) => (r as any)[matchField] === 1);
    return unique.map((r) => {
      const raw = rawByFile.get(r.file)![r.index];
      const texts = source === "rakuten" ? (raw.rakutenResults ?? []).map((x) => x.itemName ?? "") : (raw.coupangResults ?? []).map((x) => x.productName ?? "");
      const matchedListingIndex = texts.findIndex((t) => matchesModelToken(t, r.modelSkuHint));
      const matchedListingText = texts[matchedListingIndex];
      const selectedIndex = source === "rakuten" ? raw.rakutenSelectedIndex ?? null : raw.coupangSelectedIndex ?? null;
      const agrees = selectedIndex === null ? null : selectedIndex === matchedListingIndex;
      return {
        source,
        file: r.file,
        index: r.index,
        category: r.category,
        productName: r.productName,
        modelSkuHint: r.modelSkuHint,
        matchedListingIndex,
        matchedListingText,
        matchedListingIsNegative: classifyListingText(matchedListingText, raw.productType).negative,
        selectedIndex,
        agrees,
      };
    });
  }

  const rakutenRows = classify(buildRows("rakuten"));
  const coupangRows = classify(buildRows("coupang"));
  const allRows = [...rakutenRows, ...coupangRows];

  function report(label: string, rows: UniqueMatchRow[]) {
    const checked = rows.filter((r) => r.agrees !== null);
    const agree = checked.filter((r) => r.agrees === true).length;
    const noGroundTruth = rows.filter((r) => r.agrees === null);
    const noGtButAccessory = noGroundTruth.filter((r) => r.matchedListingIsNegative).length;

    console.log(`\n=== ${label} unique match (${rows.length}건) ===`);
    console.log(`ground truth 있는 건: ${checked.length}건 중 일치 ${agree}건 (정밀도 ${((agree / checked.length) * 100).toFixed(1)}%)`);
    console.log(`ground truth 없는 건: ${noGroundTruth.length}건 (그중 matched listing이 negativeFilter상 이미 accessory/used로 걸러지는 건: ${noGtButAccessory}건)`);
    for (const r of rows) {
      const gt = r.agrees === null ? "no-ground-truth" : r.agrees ? "AGREE" : `DISAGREE(${r.mismatchCause})`;
      console.log(`  [${r.category}] ${r.productName} hint="${r.modelSkuHint}" -> ${gt}${r.matchedListingIsNegative ? " [negativeFilter: already flagged]" : ""}`);
    }
  }

  report("Rakuten", rakutenRows);
  report("Coupang", coupangRows);

  // Gate 판정
  const protectedCategories = ["ambiguous", "variant_mismatch"];
  const protectedRows = allRows.filter((r) => protectedCategories.includes(r.category));
  const protectedFalseSuggestion = protectedRows.filter((r) => r.agrees === false).length; // 명시적으로 틀렸다고 확인된 건만(ground truth 있는 경우)

  const rakutenChecked = rakutenRows.filter((r) => r.agrees !== null);
  const rakutenPrecision = rakutenChecked.filter((r) => r.agrees).length / rakutenChecked.length;
  const coupangChecked = coupangRows.filter((r) => r.agrees !== null);
  const coupangPrecision = coupangChecked.filter((r) => r.agrees).length / coupangChecked.length;

  console.log("\n=== Gate 판정 (특정 listing/index를 추천하는 형태 기준) ===");
  console.log(`ambiguous/variant_mismatch 카테고리 false suggestion(ground truth 기준 확인된 오매치): ${protectedFalseSuggestion}`);
  console.log(`Rakuten unique-match 정밀도(ground truth 기준): ${(rakutenPrecision * 100).toFixed(1)}% (${rakutenChecked.filter((r) => r.agrees).length}/${rakutenChecked.length})`);
  console.log(`Coupang unique-match 정밀도(ground truth 기준): ${(coupangPrecision * 100).toFixed(1)}% (${coupangChecked.filter((r) => r.agrees).length}/${coupangChecked.length})`);
  const rakutenHasRealVariantMiss = rakutenRows.some((r) => r.mismatchCause === "variant");
  console.log(`Rakuten에서 실제 마운트/variant 오매치 발생 여부: ${rakutenHasRealVariantMiss} (exact 카테고리에서도 발생 확인됨 - Tamron 12-20mm F2.8)`);
  const coupangAccessoryRate = coupangRows.filter((r) => r.agrees === null && r.matchedListingIsNegative === false).length; // ground-truth 없고 negativeFilter도 못 거르는 위험 잔존건
  console.log(`Coupang에서 negativeFilter로도 못 거르는 "액세서리 호환표기" 잔존 위험 건수: 확인 필요(상세 목록 참고)`);

  const gatePassesForIndexRecommendation = protectedFalseSuggestion === 0 && rakutenPrecision >= 0.9 && coupangPrecision >= 0.9 && !rakutenHasRealVariantMiss;
  console.log(`\n>>> "특정 index 추천" 형태 Gate 결과: ${gatePassesForIndexRecommendation ? "PASS" : "FAIL"}`);
  if (!gatePassesForIndexRecommendation) {
    console.log(">>> 이유: Rakuten에서 실제 마운트/variant 오매치가 exact 카테고리에서 발생했고, Coupang unique match의 상당수가 액세서리 호환표기(모델코드를 언급하지만 실제 상품이 아님)를 가리킨다.");
    console.log(">>> 따라서 이번 phase는 '특정 listing 추천' 대신 지시사항의 multi-match fallback('N건 매치' 정보만 표시)을 unique match에도 동일하게 적용한다 - src/scripts/lib/modelTokenSuggestion.ts");
  }

  console.log("\n=== 안전한 대체 형태(count-only annotation) 미리보기 ===");
  for (const r of allRows) {
    const raw = rawByFile.get(r.file)![r.index];
    const texts = r.source === "rakuten" ? (raw.rakutenResults ?? []).map((x) => x.itemName ?? "") : (raw.coupangResults ?? []).map((x) => x.productName ?? "");
    const suggestion = buildModelTokenSuggestion(texts, r.modelSkuHint);
    console.log(`  [${r.category}] ${r.productName} (${r.source}) -> hasMatch=${suggestion.hasMatch}${suggestion.hasMatch ? `, listingCount=${suggestion.listingCount}` : ""}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("measure-model-token-suggestion.ts")) {
  main();
}
