/**
 * Phase 1-A evaluation runner (읽기 전용, 분석 전용).
 *
 * Phase 0 baseline(commit a873520)의 429건 전체에 negativeFilter.ts를 돌려서
 * candidate 단위 auto-reject 성능을 측정한다. matching/search 로직은 전혀
 * 건드리지 않는다 - build-matching-baseline.ts가 이미 계산한 category를
 * ground truth로 그대로 쓰고, 같은 review.json/searched.json 원본에서
 * listing 텍스트만 다시 읽는다. 외부 API/DB/GCP 접근 없음, 쓰기 없음
 * (report만 stdout에 출력).
 *
 * Candidate 단위 auto-reject 정의: 그 candidate의 rakuten+coupang listing을
 * 합쳐 1건 이상 있고, 전부 negativeFilter가 negative로 판정하면 그
 * candidate는 "auto-reject"된 것으로 본다(사람이 볼 필요가 없어짐).
 * missing_source(listing 자체가 0건)는 필터 적용 대상이 아니다 - 이미
 * mechanical하게 걸러진 케이스라 이번 측정에서 제외한다.
 *
 * exact 후보에 대해서는 추가로, 실제 review.json에 기록된
 * rakuten/coupangSelectedIndex의 listing 텍스트 자체가 negative로
 * 오판되는지 별도로 확인한다(전체가 negative로 판정돼야 candidate가
 * auto-reject되지만, "선택된 그 listing"이 개별적으로 오분류되는 것 자체가
 * 더 엄격한 안전성 신호이기 때문) - regulator의 override-exact 7건은
 * review.json 자체에 selectedIndex가 없어(fitting 게이트로 pending) 이
 * 세부 체크에서는 제외하고 candidate 단위 결과로만 본다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseline, REVIEW_BATCHES, SEARCHED_ONLY_BATCHES, CANDIDATE_DATA_DIR, type BaselineItem, type BaselineCategory } from "./build-matching-baseline";
import { classifyListingText } from "./lib/negativeFilter";

interface RawListing {
  itemName?: string;
  productName?: string;
}

interface RawCandidate {
  productName: string;
  productType: string;
  rakutenResults?: RawListing[];
  coupangResults?: RawListing[];
  rakutenSelectedIndex?: number | null;
  coupangSelectedIndex?: number | null;
}

// 이번 phase에서 실제로 auto-reject 대상으로 삼는 카테고리. variant_mismatch는
// 지시대로 제외(키워드 매칭으로 세대/모델 구분은 안전하지 않음).
export const TARGET_CATEGORIES: BaselineCategory[] = ["accessory", "wrong_category", "bundle_condition_mismatch"];
// 이번 phase에서 절대 건드리면 안 되는 카테고리(false reject = 0 목표).
export const PROTECTED_CATEGORIES: BaselineCategory[] = ["exact", "ambiguous", "variant_mismatch"];

export interface CandidateEval {
  file: string;
  index: number;
  productType: string;
  productName: string;
  category: BaselineCategory;
  listingCount: number;
  autoReject: boolean;
  selectedListingFalselyFlagged: boolean | null; // null = not applicable(no recorded selectedIndex, e.g. missing_source or regulator override-exact)
}

function loadRaw(file: string): RawCandidate[] {
  return JSON.parse(readFileSync(join(CANDIDATE_DATA_DIR, file), "utf8"));
}

function evaluateCandidate(baselineItem: BaselineItem, raw: RawCandidate): CandidateEval {
  const listings: { text: string; isSelectedRakuten: boolean; isSelectedCoupang: boolean }[] = [];
  (raw.rakutenResults ?? []).forEach((r, i) => {
    if (r.itemName) listings.push({ text: r.itemName, isSelectedRakuten: raw.rakutenSelectedIndex === i, isSelectedCoupang: false });
  });
  (raw.coupangResults ?? []).forEach((r, i) => {
    if (r.productName) listings.push({ text: r.productName, isSelectedRakuten: false, isSelectedCoupang: raw.coupangSelectedIndex === i });
  });

  const classified = listings.map((l) => ({ ...l, negative: classifyListingText(l.text, raw.productType).negative }));
  const autoReject = classified.length > 0 && classified.every((c) => c.negative);

  let selectedListingFalselyFlagged: boolean | null = null;
  if (baselineItem.category === "exact") {
    const selected = classified.find((c) => c.isSelectedRakuten || c.isSelectedCoupang);
    selectedListingFalselyFlagged = selected ? selected.negative : null;
  }

  return {
    file: baselineItem.file,
    index: baselineItem.index,
    productType: baselineItem.productType,
    productName: baselineItem.productName,
    category: baselineItem.category,
    listingCount: classified.length,
    autoReject,
    selectedListingFalselyFlagged,
  };
}

export function computeEvals(): CandidateEval[] {
  const baselineItems = buildBaseline();
  const rawByFile = new Map<string, RawCandidate[]>();
  for (const batch of [...REVIEW_BATCHES, ...SEARCHED_ONLY_BATCHES]) {
    rawByFile.set(batch.file, loadRaw(batch.file));
  }

  return baselineItems.map((item) => {
    const raw = rawByFile.get(item.file)![item.index];
    return evaluateCandidate(item, raw);
  });
}

function main() {
  const evals = computeEvals();

  const applicable = evals.filter((e) => e.category !== "missing_source"); // 필터 적용 대상(listing이 있을 수 있는 것)

  const autoRejectCount = applicable.filter((e) => e.autoReject).length;
  const obviousRejectTotal = evals.filter((e) => ["accessory", "wrong_category", "variant_mismatch", "bundle_condition_mismatch"].includes(e.category)).length;
  const targetTotal = evals.filter((e) => TARGET_CATEGORIES.includes(e.category)).length;
  const targetCaught = evals.filter((e) => TARGET_CATEGORIES.includes(e.category) && e.autoReject).length;

  const exactCandidates = evals.filter((e) => e.category === "exact");
  const exactFalseReject = exactCandidates.filter((e) => e.autoReject).length;
  const exactSelectedFalselyFlagged = exactCandidates.filter((e) => e.selectedListingFalselyFlagged === true).length;
  const exactWithSelectedCheck = exactCandidates.filter((e) => e.selectedListingFalselyFlagged !== null).length;

  const ambiguousCandidates = evals.filter((e) => e.category === "ambiguous");
  const ambiguousFalseReject = ambiguousCandidates.filter((e) => e.autoReject).length;

  const variantCandidates = evals.filter((e) => e.category === "variant_mismatch");
  const variantFalseReject = variantCandidates.filter((e) => e.autoReject).length;

  // per-category TP/FP/FN (TP/FN only meaningful for TARGET_CATEGORIES; FP only meaningful for PROTECTED_CATEGORIES)
  const perCategory: Record<string, { total: number; autoRejected: number }> = {};
  for (const e of evals) {
    const bucket = (perCategory[e.category] ??= { total: 0, autoRejected: 0 });
    bucket.total++;
    if (e.autoReject) bucket.autoRejected++;
  }

  const totalNonExactNonMissing = evals.filter((e) => e.category !== "exact" && e.category !== "missing_source").length; // 원래 human-review가 필요했던 건(대략)
  const humanReviewNeededBefore = evals.filter((e) => e.category !== "missing_source").length; // missing_source는 애초에 review 대상 아님(리스팅 자체가 없음)
  const humanReviewNeededAfter = humanReviewNeededBefore - autoRejectCount;

  console.log("=== Phase 1-A negative filter evaluation (baseline: commit a873520, 429 candidates) ===\n");

  console.log(`대상(필터 적용 가능, missing_source 제외): ${applicable.length} / 429`);
  console.log(`auto-reject 총 건수: ${autoRejectCount}\n`);

  console.log(`obvious reject 49건 중 이번 phase 타깃(accessory+wrong_category+bundle_condition_mismatch=${targetTotal}건, variant_mismatch 7건 제외)`);
  console.log(`  잡은 수/비율: ${targetCaught} / ${targetTotal} (${((targetCaught / targetTotal) * 100).toFixed(1)}%)`);
  console.log(`  obvious reject 49건 전체 기준: ${targetCaught} / ${obviousRejectTotal} (${((targetCaught / obviousRejectTotal) * 100).toFixed(1)}%)\n`);

  console.log(`exact 후보(260건) false reject(candidate 전체 auto-reject): ${exactFalseReject} / ${exactCandidates.length}  <- 목표 0`);
  console.log(`exact 후보 중 "선택된 listing 자체"가 오분류된 건(더 엄격한 체크, review.json에 selectedIndex 있는 ${exactWithSelectedCheck}건 대상): ${exactSelectedFalselyFlagged}`);
  console.log(`  (regulator override-exact 7건은 review.json에 selectedIndex가 없어 이 세부 체크 대상 아님, candidate 단위 결과에는 포함됨)\n`);

  console.log(`ambiguous 후보(22건) false reject: ${ambiguousFalseReject} / ${ambiguousCandidates.length}  <- 목표 0(공격적 reject 금지)`);
  console.log(`variant_mismatch 후보(7건) false reject: ${variantFalseReject} / ${variantCandidates.length}  <- 목표 0(이번 phase 타깃 아님)\n`);

  console.log("카테고리별 TP/FP/FN:");
  console.log("| category | total | auto-rejected | 비고 |");
  console.log("|---|---|---|---|");
  for (const cat of Object.keys(perCategory).sort()) {
    const b = perCategory[cat];
    let note = "";
    if (TARGET_CATEGORIES.includes(cat as BaselineCategory)) note = `TP=${b.autoRejected}, FN=${b.total - b.autoRejected}`;
    else if (PROTECTED_CATEGORIES.includes(cat as BaselineCategory)) note = `FP=${b.autoRejected} (목표 0)`;
    else note = "필터 미적용(missing_source)";
    console.log(`| ${cat} | ${b.total} | ${b.autoRejected} | ${note} |`);
  }

  console.log(`\nhuman-review-needed (missing_source 제외 기준): ${humanReviewNeededBefore} -> ${humanReviewNeededAfter} (${autoRejectCount}건 감소, ${((autoRejectCount / humanReviewNeededBefore) * 100).toFixed(1)}% 감소)`);

  // False positive 상세 (있으면 즉시 보이도록)
  const fpDetails = evals.filter((e) => PROTECTED_CATEGORIES.includes(e.category) && e.autoReject);
  if (fpDetails.length > 0) {
    console.log("\n!!! FALSE POSITIVE 상세 (target=0, 즉시 확인 필요) !!!");
    for (const fp of fpDetails) {
      console.log(`  [${fp.category}] ${fp.file} #${fp.index} "${fp.productName}"`);
    }
  } else {
    console.log("\nFalse positive 없음 (exact/ambiguous/variant_mismatch 전부 0).");
  }
}

if (process.argv[1] && process.argv[1].endsWith("evaluate-negative-filter.ts")) {
  main();
}
