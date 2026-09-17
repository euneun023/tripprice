/**
 * Phase 0 matching baseline builder (읽기 전용, 분석 전용).
 *
 * 이미 존재하는 human-review 산출물(*.review.json, phase3-bcd만 예외로
 * *.searched.json + review-proposal.md)을 그대로 재사용해 고정된
 * classification benchmark를 만든다. 이 스크립트는 SEARCH/EVALUATE/matching
 * 로직을 전혀 건드리지 않고, review.json에 이미 기록된 인간의 결정만 읽는다.
 *
 * 두 계층으로 분류한다:
 *  - mechanical: review.json 자체의 reviewStatus/selectedIndex/rakutenResults
 *    필드만으로 확정 가능한 것 (exact = 어느 한쪽이라도 selected, missing_source
 *    = rakutenResults가 0건 - 이 repo의 모든 review-proposal.md 문서가 실제로
 *    쓰고 있는 "Rakuten 0건 = missing-source hard gate" 관례를 그대로 따름).
 *  - documented: review-proposal.md에 사람이 이미 적어놓은 세부 판정
 *    (accessory/wrong_category/variant_mismatch/bundle_condition_mismatch/
 *    ambiguous/exact/missing_source)을 OVERRIDES에 그대로 옮겨 적용한 것.
 *    문서가 없는 나머지 후보 중 selected/missing_source가 아닌 것은 전부
 *    "ambiguous" + reasoningRecorded=false로 남긴다 - 왜 거절됐는지 이
 *    스크립트가 재해석하지 않는다(추측 금지).
 *
 * regulator-candidates.review.json은 특이 케이스: fitting(DIN/Yoke) 값을
 *확인할 수 없어 review.json 자체는 전부 pending으로 남아있지만,
 * regulator-candidates.review-proposal.md에 실제 canonical 판정이 이미
 * 기록되어 있으므로 OVERRIDES로 그 판정을 그대로 적용한다.
 *
 * phase3-bcd는 review.json이 아예 없어(제안 단계에서 중단) searched.json +
 * review-proposal.md를 대신 사용한다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DATA_DIR = join(__dirname, "candidate-data");

export type BaselineCategory =
  | "exact"
  | "accessory"
  | "wrong_category"
  | "variant_mismatch"
  | "bundle_condition_mismatch"
  | "missing_source"
  | "ambiguous";

interface ReviewJsonCandidate {
  productName: string;
  productType: string;
  rakutenResults?: unknown[];
  coupangResults?: unknown[];
  rakutenReviewStatus?: string;
  coupangReviewStatus?: string;
}

interface Batch {
  file: string;
  sourceDoc: string | null;
}

// 19 review.json (완료된 human review) + phase3-bcd는 review.json이 없어
// searched.json으로 대체(EVALUATE/등록 이전, proposal 단계에서 중단된 배치).
const REVIEW_BATCHES: Batch[] = [
  { file: "bcd-candidates.review.json", sourceDoc: "bcd-candidates.review-proposal.md" },
  { file: "camera-candidates.review.json", sourceDoc: null },
  { file: "camera-lens-candidates.review.json", sourceDoc: null },
  { file: "cressi-frog-plus-shipping.review.json", sourceDoc: null },
  { file: "dive-computer-candidates.review.json", sourceDoc: null },
  { file: "dive-light-candidates.review.json", sourceDoc: "dive-light-candidates.review-proposal.md" },
  { file: "diving-mask-candidates.review.json", sourceDoc: null },
  { file: "earbuds-candidates.review.json", sourceDoc: null },
  { file: "fins-candidates.review.json", sourceDoc: null },
  { file: "headphones-candidates.review.json", sourceDoc: null },
  { file: "phase2-bcd-candidates.review.json", sourceDoc: "phase2-bcd-candidates.review-proposal.md" },
  { file: "phase2-bcd-pro-hd-compact-retry.review.json", sourceDoc: null },
  { file: "phase2-camera-candidates.review.json", sourceDoc: "phase2-camera-candidates.review-proposal.md" },
  { file: "phase2-camera-lens-candidates.review.json", sourceDoc: "phase2-camera-lens-candidates.review-proposal.md" },
  { file: "phase2-dive-computer-candidates.review.json", sourceDoc: "phase2-dive-computer-candidates.review-proposal.md" },
  { file: "phase2-fins-candidates.review.json", sourceDoc: "phase2-fins-candidates.review-proposal.md" },
  { file: "regulator-candidates.review.json", sourceDoc: "regulator-candidates.review-proposal.md" },
  { file: "smartwatch-candidates.review.json", sourceDoc: null },
  { file: "wetsuit-candidates.review.json", sourceDoc: null },
];

const SEARCHED_ONLY_BATCHES: Batch[] = [
  { file: "phase3-bcd-candidates.searched.json", sourceDoc: "phase3-bcd-candidates.review-proposal.md" },
];

interface OverrideEntry {
  file: string;
  productName: string;
  category: BaselineCategory;
}

// review-proposal.md에 이미 적힌 사람의 세부 판정을 그대로 옮긴 것.
// 이 스크립트가 새로 판단한 게 아니라, 각 *.review-proposal.md 문서의
// "정밀 검토"/"최종 집계" 표에 있는 근거를 그대로 반영한다.
const OVERRIDES: OverrideEntry[] = [
  // bcd-candidates.review-proposal.md
  { file: "bcd-candidates.review.json", productName: "Aqua Lung Axiom i3", category: "ambiguous" },
  { file: "bcd-candidates.review.json", productName: "Oceanic OceanPro", category: "wrong_category" },

  // phase2-bcd-candidates.review-proposal.md
  { file: "phase2-bcd-candidates.review.json", productName: "Scubapro Go BC+", category: "ambiguous" },
  { file: "phase2-bcd-candidates.review.json", productName: "TUSA Liberator", category: "ambiguous" },
  { file: "phase2-bcd-candidates.review.json", productName: "IST Sports Hope", category: "wrong_category" },
  { file: "phase2-bcd-candidates.review.json", productName: "Poseidon One BCD", category: "wrong_category" },

  // dive-light-candidates.review-proposal.md
  { file: "dive-light-candidates.review.json", productName: "Light & Motion Sola Video 2000", category: "bundle_condition_mismatch" },
  { file: "dive-light-candidates.review.json", productName: "Bigblue VL15000P", category: "bundle_condition_mismatch" },
  { file: "dive-light-candidates.review.json", productName: "SeaLife Sea Dragon 2500", category: "bundle_condition_mismatch" },

  // phase2-camera-candidates.review-proposal.md
  { file: "phase2-camera-candidates.review.json", productName: "Canon EOS R100", category: "ambiguous" },
  { file: "phase2-camera-candidates.review.json", productName: "Sony α6600 BODY", category: "accessory" },
  { file: "phase2-camera-candidates.review.json", productName: "FUJIFILM X-Pro3 BODY", category: "bundle_condition_mismatch" },
  { file: "phase2-camera-candidates.review.json", productName: "FUJIFILM GFX50S II BODY", category: "bundle_condition_mismatch" },
  { file: "phase2-camera-candidates.review.json", productName: "Panasonic LUMIX G100D BODY", category: "bundle_condition_mismatch" },
  { file: "phase2-camera-candidates.review.json", productName: "OM SYSTEM OM-5 BODY", category: "variant_mismatch" },
  { file: "phase2-camera-candidates.review.json", productName: "Ricoh GR III", category: "variant_mismatch" },
  { file: "phase2-camera-candidates.review.json", productName: "Sigma fp BODY", category: "variant_mismatch" },

  // phase2-camera-lens-candidates.review-proposal.md
  { file: "phase2-camera-lens-candidates.review.json", productName: "Viltrox 27mm F1.2 Pro", category: "ambiguous" },
  { file: "phase2-camera-lens-candidates.review.json", productName: "Sony FE 400mm F2.8 GM OSS II", category: "variant_mismatch" },
  { file: "phase2-camera-lens-candidates.review.json", productName: "Sony FE 600mm F4 GM OSS II", category: "accessory" },
  { file: "phase2-camera-lens-candidates.review.json", productName: "Canon RF24-105mm F4 L IS USM II", category: "bundle_condition_mismatch" },
  { file: "phase2-camera-lens-candidates.review.json", productName: "Panasonic LUMIX G 12-60mm F2.8-4.0", category: "missing_source" },
  { file: "phase2-camera-lens-candidates.review.json", productName: "Leica Super-Vario-Elmar-SL 16-35mm f/3.5-4.5 ASPH.", category: "missing_source" },

  // phase2-dive-computer-candidates.review-proposal.md
  { file: "phase2-dive-computer-candidates.review.json", productName: "Garmin Descent Mk3i (51mm)", category: "accessory" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Garmin Descent Mk2i", category: "accessory" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Suunto Vyper Novo", category: "variant_mismatch" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Suunto D4i Novo", category: "accessory" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Shearwater NERD 2", category: "accessory" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Mares Smart Air", category: "accessory" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Deep 6 Excursion Dive Computer", category: "wrong_category" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Ratio iX3M GPS Easy", category: "wrong_category" },
  { file: "phase2-dive-computer-candidates.review.json", productName: "Seac Jack", category: "wrong_category" },

  // phase2-fins-candidates.review-proposal.md
  { file: "phase2-fins-candidates.review.json", productName: "Scubapro Jet Fin", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Aqua Lung Stratos 3", category: "bundle_condition_mismatch" },
  { file: "phase2-fins-candidates.review.json", productName: "Aqua Lung Express", category: "accessory" },
  { file: "phase2-fins-candidates.review.json", productName: "Atomic Aquatics Full Foot SplitFin", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Oceanic Accel", category: "bundle_condition_mismatch" },
  { file: "phase2-fins-candidates.review.json", productName: "Seac Space", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Beuchat Rocket", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Omer Millennium 3.0", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Leaderfins Carbon Monofin", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Dive Rite XT Fins", category: "wrong_category" },
  { file: "phase2-fins-candidates.review.json", productName: "Molchanovs CP4 Fins", category: "wrong_category" },

  // regulator-candidates.review-proposal.md - review.json 자체는 fitting 게이트
  // 때문에 전부 pending이라 mechanical 분류가 통하지 않음. 문서 판정을 그대로 적용.
  { file: "regulator-candidates.review.json", productName: "Scubapro MK25 EVO/S620Ti", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Mares Abyss 22", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Scubapro MK2 EVO/R095", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Aqua Lung Core", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Mares Prestige 15X", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Zeagle F8", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Sherwood SR2", category: "exact" },
  { file: "regulator-candidates.review.json", productName: "Aqua Lung Leg3nd", category: "ambiguous" },
  { file: "regulator-candidates.review.json", productName: "Apeks XTX50", category: "accessory" },
  { file: "regulator-candidates.review.json", productName: "Apeks MTX-R", category: "accessory" },
  { file: "regulator-candidates.review.json", productName: "Cressi MC9-SC Compact Pro", category: "wrong_category" },
  { file: "regulator-candidates.review.json", productName: "Tusa RS-1001", category: "wrong_category" },
  { file: "regulator-candidates.review.json", productName: "Oceanic Zeo/FDXi", category: "wrong_category" },
  { file: "regulator-candidates.review.json", productName: "Atomic Aquatics B2", category: "accessory" },
  { file: "regulator-candidates.review.json", productName: "Hollis 500SE/DC7", category: "wrong_category" },
  { file: "regulator-candidates.review.json", productName: "Dive Rite XT1/XT4", category: "wrong_category" },
  { file: "regulator-candidates.review.json", productName: "Beuchat VX10 Iceberg", category: "variant_mismatch" },
  { file: "regulator-candidates.review.json", productName: "Seac DX200", category: "variant_mismatch" },
  { file: "regulator-candidates.review.json", productName: "Poseidon Xstream Deep MK3", category: "wrong_category" },

  // phase3-bcd-candidates.review-proposal.md - review.json이 존재하지 않아
  // searched.json을 대신 읽음. 15건 전부 문서에 판정이 있어 전량 override.
  { file: "phase3-bcd-candidates.searched.json", productName: "Genesis Origin", category: "wrong_category" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Genesis Odyssey", category: "wrong_category" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Subgear Levo Travel BCD", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "XS Scuba SeaBlazer", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "AP Diving AP Commando", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Aropec BC-SUMMIT", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Aquatec BC-003 X-wing Tech BCD", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Palantic Neptune Weight Integrated BCD", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Northern Diver Guardian BCD", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Tilos Armada Rear Inflation BC", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "H2Odyssey BC3 Flitepac", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Beaver Sports Lightning BCD", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "Sub-Gravity Paragon", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "ScubaMax BC-2000 Altima", category: "missing_source" },
  { file: "phase3-bcd-candidates.searched.json", productName: "DiveSystem Fly Tech", category: "missing_source" },
];

function buildOverrideMap(): Map<string, BaselineCategory> {
  const map = new Map<string, BaselineCategory>();
  for (const o of OVERRIDES) {
    const key = `${o.file}::${o.productName}`;
    if (map.has(key)) {
      throw new Error(`Duplicate override for ${key}`);
    }
    map.set(key, o.category);
  }
  return map;
}

/**
 * Rakuten 0건 = missing_source(hard gate). 이 repo의 모든
 * review-proposal.md가 실제로 채택한 관례를 그대로 코드로 옮긴 것 -
 * Coupang은 실매치가 없을 때도 "인기 채움" 상품 5건을 거의 항상 반환하는
 * 노이즈 패턴이 문서마다 반복 관찰되어(phase2-fins 문서 등), Coupang
 * 결과 존재 여부는 missing_source 판정 기준으로 쓰지 않는다.
 */
function classifyMechanical(c: ReviewJsonCandidate): { category: BaselineCategory; reasoningRecorded: boolean } {
  const rSelected = c.rakutenReviewStatus === "selected";
  const cSelected = c.coupangReviewStatus === "selected";
  if (rSelected || cSelected) {
    return { category: "exact", reasoningRecorded: true };
  }
  const rHasResults = (c.rakutenResults?.length ?? 0) > 0;
  if (!rHasResults) {
    return { category: "missing_source", reasoningRecorded: true };
  }
  // no_match/pending인데 rakuten에 결과가 있음 - 왜 거절됐는지(또는 왜 아직
  // 결정이 안 됐는지) review.json 필드만으로는 알 수 없다. 추측하지 않고
  // ambiguous + reasoningRecorded=false로 남겨 후속 검토 대상임을 표시한다.
  return { category: "ambiguous", reasoningRecorded: false };
}

export interface BaselineItem {
  file: string;
  /** Position within the source file's array. productName is NOT a unique key
   * within a file - e.g. phase2-camera-lens-candidates.review.json lists
   * "Sigma 15mm F1.4 DG DN Diagonal Fisheye Art" twice (sony_e and leica_l
   * mount variants, see the proposal doc's #13/#59) as two distinct
   * candidates sharing one productName. */
  index: number;
  productType: string;
  productName: string;
  category: BaselineCategory;
  reasoningRecorded: boolean;
  sourceDoc: string | null;
}

function loadBatch(batch: Batch): BaselineItem[] {
  const raw = readFileSync(join(CANDIDATE_DATA_DIR, batch.file), "utf8");
  const candidates: ReviewJsonCandidate[] = JSON.parse(raw);
  const overrides = buildOverrideMap();

  return candidates.map((c, index) => {
    const key = `${batch.file}::${c.productName}`;
    const overrideCategory = overrides.get(key);
    if (overrideCategory) {
      return {
        file: batch.file,
        index,
        productType: c.productType,
        productName: c.productName,
        category: overrideCategory,
        reasoningRecorded: true,
        sourceDoc: batch.sourceDoc,
      };
    }
    const mechanical = classifyMechanical(c);
    return {
      file: batch.file,
      index,
      productType: c.productType,
      productName: c.productName,
      category: mechanical.category,
      reasoningRecorded: mechanical.reasoningRecorded,
      sourceDoc: null,
    };
  });
}

export function buildBaseline(): BaselineItem[] {
  const items: BaselineItem[] = [];
  for (const batch of [...REVIEW_BATCHES, ...SEARCHED_ONLY_BATCHES]) {
    items.push(...loadBatch(batch));
  }
  return items;
}

export interface BaselineSummary {
  total: number;
  exact: number;
  obviousReject: number;
  ambiguous: number;
  missingSource: number;
  manualReviewNeeded: number;
  byCategory: Record<BaselineCategory, number>;
  byProductType: Record<string, { total: number; exact: number; obviousReject: number; ambiguous: number; missingSource: number }>;
}

const OBVIOUS_REJECT_CATEGORIES: BaselineCategory[] = ["accessory", "wrong_category", "variant_mismatch", "bundle_condition_mismatch"];

export function summarize(items: BaselineItem[]): BaselineSummary {
  const byCategory: Record<BaselineCategory, number> = {
    exact: 0,
    accessory: 0,
    wrong_category: 0,
    variant_mismatch: 0,
    bundle_condition_mismatch: 0,
    missing_source: 0,
    ambiguous: 0,
  };
  const byProductType: BaselineSummary["byProductType"] = {};

  for (const item of items) {
    byCategory[item.category]++;
    const pt = (byProductType[item.productType] ??= { total: 0, exact: 0, obviousReject: 0, ambiguous: 0, missingSource: 0 });
    pt.total++;
    if (item.category === "exact") pt.exact++;
    else if (OBVIOUS_REJECT_CATEGORIES.includes(item.category)) pt.obviousReject++;
    else if (item.category === "ambiguous") pt.ambiguous++;
    else if (item.category === "missing_source") pt.missingSource++;
  }

  const obviousReject = OBVIOUS_REJECT_CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0);
  const manualReviewNeeded = items.filter((i) => !i.reasoningRecorded).length;

  return {
    total: items.length,
    exact: byCategory.exact,
    obviousReject,
    ambiguous: byCategory.ambiguous,
    missingSource: byCategory.missing_source,
    manualReviewNeeded,
    byCategory,
    byProductType,
  };
}

function renderSummaryMarkdown(summary: BaselineSummary): string {
  const lines: string[] = [];
  lines.push("# Matching Baseline Summary (Phase 0)");
  lines.push("");
  lines.push("`src/scripts/build-matching-baseline.ts`로 생성. 기존 human-review 산출물");
  lines.push("(*.review.json + phase3-bcd는 searched.json/review-proposal.md)만 재사용했고,");
  lines.push("matching 로직은 변경하지 않았다. 외부 API/GCP/DB 접근 없음.");
  lines.push("");
  lines.push("## 전체 측정");
  lines.push("");
  lines.push("| 항목 | 건수 |");
  lines.push("|---|---|");
  lines.push(`| total | ${summary.total} |`);
  lines.push(`| exact | ${summary.exact} |`);
  lines.push(`| obvious reject (accessory+wrong_category+variant_mismatch+bundle_condition_mismatch) | ${summary.obviousReject} |`);
  lines.push(`| ambiguous | ${summary.ambiguous} |`);
  lines.push(`| missing_source | ${summary.missingSource} |`);
  lines.push(`| manual-review-needed (reasoningRecorded=false — 이 스크립트가 근거 문서 없이 분류) | ${summary.manualReviewNeeded} |`);
  lines.push("");
  lines.push("## category 세부");
  lines.push("");
  lines.push("| category | 건수 |");
  lines.push("|---|---|");
  for (const [cat, count] of Object.entries(summary.byCategory)) {
    lines.push(`| ${cat} | ${count} |`);
  }
  lines.push("");
  lines.push("## productType별");
  lines.push("");
  lines.push("| productType | total | exact | obvious reject | ambiguous | missing_source |");
  lines.push("|---|---|---|---|---|---|");
  for (const [pt, s] of Object.entries(summary.byProductType).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${pt} | ${s.total} | ${s.exact} | ${s.obviousReject} | ${s.ambiguous} | ${s.missingSource} |`);
  }
  lines.push("");
  lines.push("## 방법론 한계 (다음 phase에서 다룰 것)");
  lines.push("");
  lines.push("- **documented** (reasoningRecorded=true, override 적용): review-proposal.md가 있는 9개");
  lines.push("  배치(bcd/phase2-bcd/dive-light/phase2-camera/phase2-camera-lens/phase2-dive-computer/");
  lines.push("  phase2-fins/regulator/phase3-bcd)는 사람이 이미 적어놓은 세부 판정을 그대로 옮겼다.");
  lines.push("- **mechanical** (reasoningRecorded=true): exact(selected)와 missing_source(rakuten 0건)는");
  lines.push("  review.json 필드만으로 확정 가능해 모든 배치에 동일하게 적용했다.");
  lines.push("- **manual-review-needed** (reasoningRecorded=false): proposal 문서가 없는 나머지 배치에서");
  lines.push("  no_match/pending인데 rakuten 결과가 있는 건은 왜 거절됐는지 이 스크립트가 재해석하지");
  lines.push("  않고 전부 `ambiguous`로 남겼다 - accessory/wrong_category/variant_mismatch/");
  lines.push("  bundle_condition_mismatch로 세분화하려면 각 listing 텍스트를 다시 읽는 human review가");
  lines.push("  더 필요하다.");
  lines.push("");
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("build-matching-baseline.ts")) {
  const items = buildBaseline();
  const summary = summarize(items);
  writeFileSync(join(CANDIDATE_DATA_DIR, "matching-baseline.json"), JSON.stringify(items, null, 2), "utf8");
  writeFileSync(join(CANDIDATE_DATA_DIR, "matching-baseline-summary.md"), renderSummaryMarkdown(summary), "utf8");
  console.log(`Wrote ${items.length} baseline item(s).`);
  console.log(JSON.stringify(summary, null, 2));
}
