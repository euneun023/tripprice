#!/usr/bin/env node
/**
 * Candidate Evaluator v0 dry-run runner. Wraps candidateEvaluationService.ts
 * for a batch of 150-200 candidate products, in two explicit passes:
 *
 *   1. SEARCH  - calls the existing searchRakutenCandidates()/
 *                searchCoupangCandidates() (mappingService.ts) for each
 *                candidate and writes their search results to a JSON file
 *                for a human to look at.
 *   2. EVALUATE - reads that same file back (now edited by a human to add
 *                rakutenSelectedIndex/coupangSelectedIndex/matchConfidence/
 *                riskFlags) and runs evaluateCandidate() on the two
 *                human-picked results per candidate.
 *
 * Never touches the DB, never calls approveListing()/createProduct()/
 * createVariant(), never writes a canonical_product or source_listing row.
 * Search-mode output is purely informational - nothing here ever assumes
 * result #0 on either source is the same product; matching is always a
 * human decision recorded in the file between the two passes.
 *
 * Usage:
 *   npx tsx src/scripts/evaluate-candidates.ts --mode=search --input=<seed.json> --output=<searched.json> [--hits=5]
 *   npx tsx src/scripts/evaluate-candidates.ts --mode=evaluate --input=<searched.json> --output=<results.json> [--countByType=<counts.json>]
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { searchRakutenCandidates, searchCoupangCandidates, type RakutenCreds } from "../services/mappingService";
import type { RakutenItem } from "../adapters/rakuten";
import type { CoupangCredentials, CoupangProduct } from "../adapters/coupang";
import {
  evaluateCandidate,
  type CandidateEvaluationResult,
  type CandidateConfidence,
  type ConvertToKrwFn,
} from "../services/candidateEvaluationService";
import type { RiskFlag } from "../domain/riskFlags";
import { isProductType } from "../domain/searchAliases";

// ---------------------------------------------------------------------
// Shared types (also used directly by candidateEvaluationService.test.ts-
// style unit tests for this file).
// ---------------------------------------------------------------------

export interface CandidateSeed {
  productName: string;
  brand?: string;
  productType: string;
  modelSkuHint?: string | null;
}

/** Only fields the real Rakuten adapter (RakutenItem) actually returns -
 * no fabricated fields. currency is fixed "JPY" (Rakuten Ichiba, not
 * something the response reliably echoes back - same assumption
 * candidateEvaluationService.ts itself makes). */
export interface SafeRakutenResult {
  index: number;
  itemName: string;
  itemPrice: number;
  itemUrl: string;
  currency: "JPY";
  availability: boolean;
  externalId: string;
  shopName: string;
}

/** Only fields the real Coupang adapter (CoupangProduct) actually returns.
 * There is no availability/stock field in that response at all - this
 * type deliberately does NOT invent one. */
export interface SafeCoupangResult {
  index: number;
  productName: string;
  productPrice: number;
  productUrl: string;
  currency: "KRW";
  externalId: string;
  isRocket: boolean;
}

export interface CandidateSearchOutput extends CandidateSeed {
  rakutenResults: SafeRakutenResult[];
  coupangResults: SafeCoupangResult[];
  /** filled in by a human after reviewing rakutenResults/coupangResults - absent/null means "not yet reviewed" */
  rakutenSelectedIndex?: number | null;
  coupangSelectedIndex?: number | null;
  /** filled in by a human - never inferred automatically */
  matchConfidence?: CandidateConfidence | null;
  riskFlags?: RiskFlag[];
}

function toSafeRakutenResult(item: RakutenItem, index: number): SafeRakutenResult {
  return {
    index,
    itemName: item.itemName,
    itemPrice: item.itemPrice,
    itemUrl: item.itemUrl, // informational only - never used as an identity signal, matches source_listings.source_url's own documented policy
    currency: "JPY",
    availability: item.availability === 1,
    externalId: item.itemCode,
    shopName: item.shopName,
  };
}

function toSafeCoupangResult(item: CoupangProduct, index: number): SafeCoupangResult {
  return {
    index,
    productName: item.productName,
    productPrice: item.productPrice,
    productUrl: item.productUrl, // informational only, same policy as above
    currency: "KRW",
    externalId: String(item.productId),
    isRocket: item.isRocket,
  };
}

// ---------------------------------------------------------------------
// 1. SEARCH MODE
// ---------------------------------------------------------------------

export type SearchRakutenFn = typeof searchRakutenCandidates;
export type SearchCoupangFn = typeof searchCoupangCandidates;

export interface SearchModeOptions {
  hitsPerSource?: number;
  /** injectable so tests never call the real adapters/real APIs */
  searchRakuten?: SearchRakutenFn;
  searchCoupang?: SearchCoupangFn;
}

export async function runSearchMode(
  seeds: CandidateSeed[],
  creds: { rakuten: RakutenCreds; coupang: CoupangCredentials },
  options: SearchModeOptions = {},
): Promise<CandidateSearchOutput[]> {
  const hits = options.hitsPerSource ?? 5;
  const searchRakuten = options.searchRakuten ?? searchRakutenCandidates;
  const searchCoupang = options.searchCoupang ?? searchCoupangCandidates;

  const results: CandidateSearchOutput[] = [];
  for (const seed of seeds) {
    const [rakutenItems, coupangItems] = await Promise.all([
      searchRakuten(seed.productName, creds.rakuten, hits),
      searchCoupang(seed.productName, creds.coupang, hits),
    ]);
    results.push({
      ...seed,
      rakutenResults: rakutenItems.map(toSafeRakutenResult),
      coupangResults: coupangItems.map(toSafeCoupangResult),
      rakutenSelectedIndex: null,
      coupangSelectedIndex: null,
      matchConfidence: null,
      riskFlags: [],
    });
  }
  return results;
}

// ---------------------------------------------------------------------
// 2. EVALUATE MODE
// ---------------------------------------------------------------------

export interface EvaluateModeOutcome {
  evaluated: CandidateEvaluationResult[];
  /** candidates whose rakutenSelectedIndex/coupangSelectedIndex is still null/undefined - never evaluated */
  skippedUnselected: string[];
  /** candidates with an out-of-range selected index - never evaluated, never crashes the whole batch */
  invalidSelections: { productName: string; reason: string }[];
}

function isSelected(index: number | null | undefined): index is number {
  return typeof index === "number";
}

export async function runEvaluateMode(
  candidates: CandidateSearchOutput[],
  countByType: Record<string, number>,
  convertFn?: ConvertToKrwFn,
): Promise<EvaluateModeOutcome> {
  const evaluated: CandidateEvaluationResult[] = [];
  const skippedUnselected: string[] = [];
  const invalidSelections: { productName: string; reason: string }[] = [];

  for (const c of candidates) {
    if (!isSelected(c.rakutenSelectedIndex) || !isSelected(c.coupangSelectedIndex)) {
      skippedUnselected.push(c.productName);
      continue;
    }
    const rakutenPick = c.rakutenResults[c.rakutenSelectedIndex];
    const coupangPick = c.coupangResults[c.coupangSelectedIndex];
    if (!rakutenPick) {
      invalidSelections.push({ productName: c.productName, reason: `rakutenSelectedIndex ${c.rakutenSelectedIndex} out of range (0-${c.rakutenResults.length - 1})` });
      continue;
    }
    if (!coupangPick) {
      invalidSelections.push({ productName: c.productName, reason: `coupangSelectedIndex ${c.coupangSelectedIndex} out of range (0-${c.coupangResults.length - 1})` });
      continue;
    }

    const result = await evaluateCandidate(
      {
        productName: c.productName,
        productType: c.productType,
        rakuten: { itemName: rakutenPick.itemName, itemPrice: rakutenPick.itemPrice, itemUrl: rakutenPick.itemUrl },
        coupang: { productName: coupangPick.productName, productPrice: coupangPick.productPrice, productUrl: coupangPick.productUrl },
        modelSkuHint: c.modelSkuHint,
        matchConfidence: c.matchConfidence,
        riskFlags: c.riskFlags,
      },
      countByType,
      convertFn,
    );
    evaluated.push(result);
  }

  return { evaluated, skippedUnselected, invalidSelections };
}

// ---------------------------------------------------------------------
// Console summary (search/response bodies and any Secret/header values are
// never printed here - only the same safe fields written to the result
// files).
// ---------------------------------------------------------------------

export function printEvaluationSummary(outcome: EvaluateModeOutcome): void {
  console.log(`\n=== Candidate Evaluation Summary ===`);
  console.log(`evaluated: ${outcome.evaluated.length}, skipped (unselected): ${outcome.skippedUnselected.length}, invalid selections: ${outcome.invalidSelections.length}`);

  const byDecision = { ADD: 0, REVIEW: 0, SKIP: 0 } as Record<string, number>;
  for (const r of outcome.evaluated) byDecision[r.decision]++;
  console.log(`ADD=${byDecision.ADD} REVIEW=${byDecision.REVIEW} SKIP=${byDecision.SKIP}`);

  const sorted = [...outcome.evaluated].sort((a, b) => b.totalScore - a.totalScore);
  for (const r of sorted) {
    console.log(
      `[${r.decision.padEnd(6)}] ${String(r.totalScore).padStart(3)} pts  ${r.productName} (${r.productType})  ` +
        `saving=${r.savingKrw ?? "-"}KRW/${r.savingPercent?.toFixed(1) ?? "-"}%  ` +
        `price=${r.priceScore} match=${r.matchScore} coverage=${r.coverageScore}`,
    );
    for (const reason of r.reasons) console.log(`          - ${reason}`);
  }

  if (outcome.skippedUnselected.length > 0) {
    console.log(`\n미선택(아직 review 안 됨): ${outcome.skippedUnselected.join(", ")}`);
  }
  if (outcome.invalidSelections.length > 0) {
    console.log(`\n선택 index 오류:`);
    for (const inv of outcome.invalidSelections) console.log(`  - ${inv.productName}: ${inv.reason}`);
  }
}

// ---------------------------------------------------------------------
// CLI entrypoint - thin: argv/file I/O only, no evaluation logic of its
// own (mirrors src/cli/index.ts's own "thin wrapper" convention).
// ---------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const mode = arg("mode");
  const inputPath = arg("input");
  const outputPath = arg("output");
  if (!mode || !inputPath || !outputPath) {
    console.error("Usage: --mode=search|evaluate --input=<path> --output=<path> [--hits=5] [--countByType=<path>]");
    process.exit(1);
  }

  if (mode === "search") {
    const seeds: CandidateSeed[] = JSON.parse(readFileSync(inputPath!, "utf8"));
    const rakutenCreds: RakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
    const coupangCreds: CoupangCredentials = {
      accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
      secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
    };
    const hits = arg("hits") ? Number(arg("hits")) : undefined;
    const results = await runSearchMode(seeds, { rakuten: rakutenCreds, coupang: coupangCreds }, { hitsPerSource: hits });
    writeFileSync(outputPath!, JSON.stringify(results, null, 2), "utf8");
    console.log(`Wrote ${results.length} candidate(s) with search results to ${outputPath}`);
    console.log(`다음: ${outputPath} 파일을 열어 rakutenSelectedIndex/coupangSelectedIndex/matchConfidence/riskFlags를 채운 뒤 --mode=evaluate로 재실행하세요.`);
    return;
  }

  if (mode === "evaluate") {
    const candidates: CandidateSearchOutput[] = JSON.parse(readFileSync(inputPath!, "utf8"));
    // Default is a point-in-time snapshot (23 products, taken at the read-only audit
    // this evaluator follows) checked in as sample data, NOT read from the DB and NOT
    // hardcoded here - always pass --countByType=<fresh export> for a real batch run.
    const countByTypePath = arg("countByType", "src/scripts/sample-data/product-type-counts.example.json")!;
    const countByType: Record<string, number> = JSON.parse(readFileSync(countByTypePath, "utf8"));

    for (const c of candidates) {
      if (!isProductType(c.productType)) {
        console.warn(`경고: "${c.productName}"의 productType "${c.productType}"는 허용된 값이 아닙니다 - evaluateCandidate가 SKIP으로 처리합니다.`);
      }
    }

    const outcome = await runEvaluateMode(candidates, countByType);
    writeFileSync(outputPath!, JSON.stringify(outcome, null, 2), "utf8");
    printEvaluationSummary(outcome);
    console.log(`\nWrote full results to ${outputPath}`);
    return;
  }

  console.error(`Unknown --mode="${mode}" (expected "search" or "evaluate")`);
  process.exit(1);
}

// Only run when executed directly (tsx src/scripts/evaluate-candidates.ts ...),
// never when imported by a test.
if (process.argv[1] && process.argv[1].endsWith("evaluate-candidates.ts")) {
  main().catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  });
}
