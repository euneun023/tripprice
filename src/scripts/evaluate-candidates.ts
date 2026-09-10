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
 *
 * Cloud Run alternative for --mode=search only: set INPUT_URI=gs://... and
 * OUTPUT_URI=gs://... (both must be gs:// URIs) instead of --input/--output -
 * the seed file is downloaded from and the search results uploaded straight
 * to GCS (via src/scripts/lib/gcsCandidateIo.ts), entirely in memory, no
 * local/temp file involved. --input/--output still work exactly as before
 * when INPUT_URI/OUTPUT_URI aren't both set to gs:// URIs.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { searchRakutenCandidates, searchCoupangCandidates, type RakutenCreds } from "../services/mappingService";
import { RakutenApiError, type RakutenItem } from "../adapters/rakuten";
import { CoupangApiError, type CoupangCredentials, type CoupangProduct } from "../adapters/coupang";
import {
  evaluateCandidate,
  type CandidateEvaluationResult,
  type CandidateConfidence,
  type ConvertToKrwFn,
} from "../services/candidateEvaluationService";
import type { RiskFlag } from "../domain/riskFlags";
import { isProductType } from "../domain/searchAliases";
import { downloadJsonFromGcs, uploadJsonToGcs, isGsUri, type FetchFn } from "./lib/gcsCandidateIo";

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

/** Which of the two candidate SEARCH-only Coupang queries (see
 * searchCoupangWithSkuUnion) a result came from - "both" when the same
 * externalId appeared in both. Provenance only, never used to auto-select or
 * score anything. */
export type CoupangMatchedQuery = "productName" | "modelSkuHint";

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
  matchedQueries: CoupangMatchedQuery[];
}

/**
 * Deliberately carries NO dynamic message string, request URL, header, or
 * response body content - only a fixed `kind`, the numeric HTTP status (safe:
 * just a number), and `code` (extracted from a narrow, known-safe subset of
 * the server's own RESPONSE body fields - never the request). Rakuten's
 * search URL puts applicationId/accessKey in the query string
 * (adapters/rakuten.ts) and a transport-level fetch error's own .message can
 * echo that full URL back - so transport errors never carry ANY dynamic text
 * at all, on either source, to keep this policy uniform and simple.
 */
export interface SafeSourceError {
  kind: "http_error" | "transport_error" | "unknown_error";
  status?: number;
  code?: string;
}

/** Safe error-code shape: short, alphanumeric plus _.- only - never long enough to carry a sentence. */
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function extractSafeErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  // Rakuten (IP/auth-level errors, e.g. CLIENT_IP_NOT_ALLOWED): { errors: { errorCode, errorMessage } }
  if (b.errors && typeof b.errors === "object") {
    const inner = b.errors as Record<string, unknown>;
    if (typeof inner.errorMessage === "string") return inner.errorMessage;
    if (inner.errorCode !== undefined) return String(inner.errorCode);
  }
  // Rakuten (flat, parameter-validation errors): { error: "wrong_parameter", error_description: "..." } -
  // only `error` is ever read; `error_description` may echo back request content and is never touched.
  if (typeof b.error === "string" && SAFE_ERROR_CODE_PATTERN.test(b.error)) {
    return b.error;
  }
  // Coupang: { rCode, rMessage } (CoupangSearchResponse)
  if (typeof b.rMessage === "string") return b.rMessage;
  if (typeof b.rCode === "string") return b.rCode;
  return undefined;
}

function classifySourceError(err: unknown): SafeSourceError {
  if (err instanceof RakutenApiError || err instanceof CoupangApiError) {
    if (err.status === 0) {
      // Transport/network failure - err.body here is the raw underlying
      // Error object, never a server response; never read from it.
      return { kind: "transport_error" };
    }
    return { kind: "http_error", status: err.status, code: extractSafeErrorCode(err.body) };
  }
  return { kind: "unknown_error" };
}

export interface CandidateSearchOutput extends CandidateSeed {
  rakutenResults: SafeRakutenResult[];
  coupangResults: SafeCoupangResult[];
  /** null when that source succeeded (or hasn't been searched yet) - see SafeSourceError for what is/isn't captured */
  rakutenError?: SafeSourceError | null;
  coupangError?: SafeSourceError | null;
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

function toSafeCoupangResult(item: CoupangUnionItem, index: number): SafeCoupangResult {
  return {
    index,
    productName: item.productName,
    productPrice: item.productPrice,
    productUrl: item.productUrl, // informational only, same policy as above
    currency: "KRW",
    externalId: String(item.productId),
    isRocket: item.isRocket,
    matchedQueries: item.matchedQueries,
  };
}

/**
 * candidate SEARCH-only dedupe (never used by the general Rakuten/Coupang
 * refresh flow - mappingService.ts/adapters/coupang.ts are untouched): a
 * single keyword search can return the exact same listing more than once
 * (observed live: two entries sharing productId 9715042060, differing only
 * in itemId/vendorItemId). Keeps the first occurrence of each productId and
 * its original order/rank; later repeats are dropped before toSafeCoupangResult()
 * assigns index, so index stays 0-based sequential over the deduped list.
 * Deliberately does NOT fall back to matching by productName/productPrice
 * when productId is absent - CoupangProduct.productId is a required field on
 * every real response, so that fallback would only ever fire on a bug
 * elsewhere, and a title/price heuristic risks collapsing two genuinely
 * different listings that happen to share a title and price (also observed
 * live, one keyword over: same title/price, two distinct productIds).
 */
export function dedupeCoupangProductsByExternalId(products: CoupangProduct[]): CoupangProduct[] {
  const seen = new Set<number>();
  const deduped: CoupangProduct[] = [];
  for (const p of products) {
    if (seen.has(p.productId)) continue;
    seen.add(p.productId);
    deduped.push(p);
  }
  return deduped;
}

/**
 * candidate SEARCH-only heuristic (never used by the general Rakuten/Coupang
 * refresh flow): does modelSkuHint look like an actual SKU/model code (e.g.
 * "SEL2470GM2", "A063", "DC-S9") rather than a long descriptive spec string
 * (e.g. "RF24-70mm F2.8 L IS USM", "24-70mm F2.8 DG DN II")? A single
 * alnum/hyphen token, short, with no "mm" unit substring - deliberately no
 * per-brand hardcoding.
 *
 * Confirmed live against Coupang's product search (2026-09-10, 12 products
 * spanning Nikon/Sigma/Tamron/Panasonic/FUJIFILM/Canon/OM SYSTEM): this flag
 * is a reasonable predictor of "worth trying modelSkuHint as an EXTRA query"
 * but not of "modelSkuHint alone is reliable" - half of the SKU-like codes
 * tested (Tamron A063/A058, Panasonic DC-S5M2/DC-S9) returned ZERO relevant
 * results when searched alone, colliding with unrelated products sharing the
 * same short alnum code (air-purifier filter part numbers, generic "DC-"
 * power/electronics listings). That is exactly why searchCoupangWithSkuUnion
 * below only ever ADDS a modelSkuHint query alongside productName - it never
 * replaces it.
 */
export function isSkuLikeModelSku(modelSkuHint: string | null | undefined): boolean {
  if (!modelSkuHint) return false;
  return /^[A-Za-z0-9-]{2,14}$/.test(modelSkuHint) && !/mm/i.test(modelSkuHint);
}

export interface CoupangUnionItem extends CoupangProduct {
  matchedQueries: CoupangMatchedQuery[];
}

/**
 * candidate SEARCH-only union (never used by the general Rakuten/Coupang
 * refresh flow): merges two already-deduped Coupang result lists by
 * externalId (productId), preserving order - every productName-query result
 * first (in its own order), then only the modelSkuHint-query results whose
 * externalId wasn't already present (in their own order). A productId
 * present in both gets matchedQueries: ["productName", "modelSkuHint"].
 * Never re-sorts or scores - the two source orders are the only ordering
 * signal available, and re-ranking them would need real relevance data this
 * function doesn't have.
 */
export function unionCoupangResults(
  productNameResults: CoupangProduct[],
  modelSkuResults: CoupangProduct[],
): CoupangUnionItem[] {
  const merged = new Map<number, CoupangUnionItem>();
  const order: number[] = [];

  for (const p of productNameResults) {
    merged.set(p.productId, { ...p, matchedQueries: ["productName"] });
    order.push(p.productId);
  }
  for (const p of modelSkuResults) {
    const existing = merged.get(p.productId);
    if (existing) {
      if (!existing.matchedQueries.includes("modelSkuHint")) existing.matchedQueries.push("modelSkuHint");
    } else {
      merged.set(p.productId, { ...p, matchedQueries: ["modelSkuHint"] });
      order.push(p.productId);
    }
  }

  return order.map((id) => merged.get(id)!);
}

// ---------------------------------------------------------------------
// 1. SEARCH MODE
// ---------------------------------------------------------------------

export type SearchRakutenFn = typeof searchRakutenCandidates;
export type SearchCoupangFn = typeof searchCoupangCandidates;

/**
 * candidate SEARCH-only normalization (never used by the general Rakuten
 * refresh flow - mappingService/adapters/rakuten.ts are untouched). Merges
 * every standalone single ASCII-letter token (/^[A-Za-z]$/ - e.g. the "V" in
 * "Sony α7 V") into an adjacent token, since Rakuten's Ichiba Item Search API
 * rejects (400) keywords containing a lone 1-character word. Standalone
 * digit tokens ("2", "II" being 2 chars anyway) are left alone - only bare
 * letters trigger Rakuten's 400.
 *
 * For each standalone token, in left-to-right order over the already-merged
 * output so far (so an earlier merge is visible as the "previous" token to a
 * later one):
 *   1. if the previous token contains a digit, append to it - "F2.8 L" ->
 *      "F2.8L" (digit-bearing tokens are aperture/model numbers; fusing an
 *      adjacent letter is the same shape Rakuten already accepts elsewhere,
 *      e.g. naturally-written "R50V").
 *   2. else if there is a next token and it starts with a digit, prepend to
 *      it - "Z 24-70mm" -> "Z24-70mm".
 *   3. else if there is a next token, prepend to it - "S PRO" -> "SPRO".
 *   4. else (last token, previous token has no digit or there is no
 *      previous) - drop it rather than force-merge into the previous
 *      token. A blind "merge into previous" here would fuse two
 *      independently meaningful all-letter words - e.g. "VR S" -> "VRS" -
 *      corrupting the query's meaning (VR = Vibration Reduction). Leaving
 *      it standalone instead doesn't help either: it's still a lone
 *      1-character word, so Rakuten 400s on the fallback exactly like it
 *      did on the raw query - confirmed live against Rakuten's Item Search
 *      API (2026-09-10): "NIKKOR Z 70-200mm f/2.8 VR S" still 400s if "S"
 *      is left standalone, but succeeds with real results once "S" is
 *      dropped. Only case 1 is safe to force-merge, because a digit-bearing
 *      token is already a model/spec fragment, not a standalone word; a
 *      trailing word like "VR" that isn't is better silently dropped from
 *      this search-only fallback keyword than left to guarantee a repeat
 *      400 - the search is a discovery aid, not the identity check (that
 *      happens later in candidate review), so losing "VR" from the
 *      keyword costs nothing there.
 *
 * Returns null when the keyword has no standalone token, or when the
 * transform (merges and drops together) leaves the string identical to the
 * original - i.e. there is nothing to retry with.
 */
export function buildRakutenFallbackKeyword(keyword: string): string | null {
  const isStandaloneLetter = (token: string) => /^[A-Za-z]$/.test(token);
  const hasDigit = (token: string) => /\d/.test(token);
  const startsWithDigit = (token: string) => /^\d/.test(token);

  const tokens = keyword.split(" ");
  if (!tokens.some(isStandaloneLetter)) return null;

  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isStandaloneLetter(token)) {
      merged.push(token);
      continue;
    }
    const prevIndex = merged.length - 1;
    const next = tokens[i + 1];
    if (prevIndex >= 0 && hasDigit(merged[prevIndex])) {
      merged[prevIndex] = merged[prevIndex] + token;
    } else if (next !== undefined) {
      merged.push(token + next);
      i++; // next has been fused into this entry - don't push it again
    }
    // else: last token, previous has no digit (or there is no previous) -
    // drop it (see case 4 above), i.e. push nothing
  }

  const result = merged.join(" ");
  return result === keyword ? null : result;
}

/**
 * Wraps a single candidate's Rakuten search with exactly one fallback retry,
 * and only for the specific failure this exists to work around: an HTTP 400
 * whose keyword has at least one mergeable standalone single-letter token
 * (see buildRakutenFallbackKeyword). Any other error (non-400 HTTP, transport
 * failure, or a 400 with no mergeable token) propagates unchanged - the
 * caller's existing classifySourceError()/isolation handling is untouched.
 * The fallback keyword is retried at most once - if it also 400s, that error
 * propagates as-is (no fallback of the fallback).
 */
async function searchRakutenWithFallback(
  productName: string,
  creds: RakutenCreds,
  hits: number,
  searchRakuten: SearchRakutenFn,
): Promise<RakutenItem[]> {
  try {
    return await searchRakuten(productName, creds, hits);
  } catch (err) {
    if (!(err instanceof RakutenApiError) || err.status !== 400) throw err;
    const fallbackKeyword = buildRakutenFallbackKeyword(productName);
    if (!fallbackKeyword) throw err;
    return await searchRakuten(fallbackKeyword, creds, hits);
  }
}

/**
 * Wraps a single candidate's Coupang search as productName + (only when
 * modelSkuHint is SKU-like, see isSkuLikeModelSku) an additional modelSkuHint
 * query, unioned by externalId (unionCoupangResults) - never a fallback, both
 * queries always run independently via Promise.allSettled so one failing
 * never discards the other's results:
 *  - productName succeeds, modelSkuHint fails or isn't run -> productName's
 *    results only, no error (this is exactly today's pre-union behavior when
 *    modelSkuHint isn't SKU-like).
 *  - productName fails, modelSkuHint succeeds -> modelSkuHint's results only,
 *    no error - this is the case this whole feature exists for (e.g. a Sony
 *    lens where the descriptive productName search returns plenty of
 *    results but never the real product itself; SEL2470GM2 alone found it -
 *    see evaluate-candidates.ts's Coupang query experiment notes).
 *  - both fail -> the error from productName (the always-attempted query) is
 *    reported, matching pre-union error semantics exactly when modelSkuHint
 *    was never attempted.
 *  - both succeed -> union, productName's own order first, then only the
 *    modelSkuHint results not already present, in their own order. Never
 *    re-sorted/re-scored.
 */
async function searchCoupangWithSkuUnion(
  seed: CandidateSeed,
  creds: CoupangCredentials,
  hits: number,
  searchCoupang: SearchCoupangFn,
): Promise<{ products: CoupangUnionItem[]; error: SafeSourceError | null }> {
  const modelSkuHint = seed.modelSkuHint;
  const useModelSku = isSkuLikeModelSku(modelSkuHint);

  const [productNameOutcome, modelSkuOutcome] = await Promise.allSettled([
    searchCoupang(seed.productName, creds, hits),
    // useModelSku true guarantees modelSkuHint is a non-empty string (see
    // isSkuLikeModelSku) - the cast just tells TS what that guard already established.
    useModelSku ? searchCoupang(modelSkuHint as string, creds, hits) : Promise.resolve<CoupangProduct[]>([]),
  ]);

  const productNameOk = productNameOutcome.status === "fulfilled";
  const modelSkuOk = modelSkuOutcome.status === "fulfilled";

  const productNameResults = productNameOk ? dedupeCoupangProductsByExternalId(productNameOutcome.value) : [];
  const modelSkuResults = modelSkuOk ? dedupeCoupangProductsByExternalId(modelSkuOutcome.value) : [];

  const products = unionCoupangResults(productNameResults, modelSkuResults);

  // An error is only reported when every query actually attempted failed -
  // any attempted query that succeeds (even with zero hits) means this
  // candidate's Coupang search overall "worked", so a sibling query's
  // failure is never promoted into an error that would discard already-good
  // results.
  const error = !productNameOk && (!useModelSku || !modelSkuOk) ? classifySourceError(productNameOutcome.reason) : null;

  return { products, error };
}

export interface SearchModeOptions {
  hitsPerSource?: number;
  /** injectable so tests never call the real adapters/real APIs */
  searchRakuten?: SearchRakutenFn;
  searchCoupang?: SearchCoupangFn;
}

/**
 * Isolates failures at two levels so a batch of 30-200 candidates always
 * finishes and always writes an output file:
 *  - per source, per candidate: Promise.allSettled means a Rakuten failure
 *    never discards an already-succeeded Coupang result for the same
 *    candidate, and vice versa.
 *  - per candidate, across the batch: the whole per-candidate body is
 *    wrapped in try/catch, and nothing here ever throws past the loop - one
 *    candidate's failure (search or otherwise) never stops the next one, and
 *    every seed always produces exactly one output entry.
 */
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
    let rakutenResults: SafeRakutenResult[] = [];
    let coupangResults: SafeCoupangResult[] = [];
    let rakutenError: SafeSourceError | null = null;
    let coupangError: SafeSourceError | null = null;

    try {
      const [rakutenOutcome, coupangOutcome] = await Promise.allSettled([
        searchRakutenWithFallback(seed.productName, creds.rakuten, hits, searchRakuten),
        searchCoupangWithSkuUnion(seed, creds.coupang, hits, searchCoupang),
      ]);

      if (rakutenOutcome.status === "fulfilled") {
        rakutenResults = rakutenOutcome.value.map(toSafeRakutenResult);
      } else {
        rakutenError = classifySourceError(rakutenOutcome.reason);
      }

      if (coupangOutcome.status === "fulfilled") {
        coupangResults = coupangOutcome.value.products.map(toSafeCoupangResult);
        coupangError = coupangOutcome.value.error;
      } else {
        // searchCoupangWithSkuUnion never throws itself (its two internal
        // queries are already wrapped in Promise.allSettled) - this branch
        // only guards against a bug in that wrapper.
        coupangError = classifySourceError(coupangOutcome.reason);
      }
    } catch (candidateLevelError) {
      // Should not normally happen (allSettled itself never rejects; this
      // guards against a bug in the mapping helpers above or similar) - never
      // let an unexpected exception here take down the rest of the batch.
      // Whatever a source already captured above is kept; only a source that
      // is still empty/unmarked gets this generic error.
      if (rakutenResults.length === 0 && !rakutenError) rakutenError = classifySourceError(candidateLevelError);
      if (coupangResults.length === 0 && !coupangError) coupangError = classifySourceError(candidateLevelError);
    }

    results.push({
      ...seed,
      rakutenResults,
      coupangResults,
      rakutenError,
      coupangError,
      rakutenSelectedIndex: null,
      coupangSelectedIndex: null,
      matchConfidence: null,
      riskFlags: [],
    });
  }
  return results;
}

// ---------------------------------------------------------------------
// SEARCH MODE I/O wiring - local file or GCS, chosen by the caller (main()
// below resolves this from argv/env). Kept separate from runSearchMode()
// itself so tests can exercise this wiring with an injected fake GCS client
// without touching the real GCS API, while runSearchMode()'s own tests stay
// completely unaffected by this.
// ---------------------------------------------------------------------

export type SearchIoLocation = { kind: "local"; path: string } | { kind: "gcs"; uri: string };

export interface SearchIoConfig {
  input: SearchIoLocation;
  output: SearchIoLocation;
}

export interface RunSearchModeWithIoOptions extends SearchModeOptions {
  /** injectable so tests never call the real metadata server/GCS API */
  fetchFn?: FetchFn;
}

export interface RunSearchModeWithIoResult {
  results: CandidateSearchOutput[];
  outputLocation: string;
}

export async function runSearchModeWithIo(
  config: SearchIoConfig,
  creds: { rakuten: RakutenCreds; coupang: CoupangCredentials },
  options: RunSearchModeWithIoOptions = {},
): Promise<RunSearchModeWithIoResult> {
  const seeds: CandidateSeed[] =
    config.input.kind === "gcs"
      ? ((await downloadJsonFromGcs(config.input.uri, options.fetchFn)) as CandidateSeed[])
      : JSON.parse(readFileSync(config.input.path, "utf8"));

  const results = await runSearchMode(seeds, creds, options);

  const outputLocation = config.output.kind === "gcs" ? config.output.uri : config.output.path;
  if (config.output.kind === "gcs") {
    await uploadJsonToGcs(config.output.uri, results, options.fetchFn);
  } else {
    writeFileSync(config.output.path, JSON.stringify(results, null, 2), "utf8");
  }

  return { results, outputLocation };
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
  // Cloud Run path: only for --mode=search, only when BOTH env vars are set
  // and both are gs:// URIs - any other combination (one missing, one not
  // gs://) falls straight through to the local --input/--output requirement
  // below, unchanged from before this env-var path existed.
  const inputUri = process.env.INPUT_URI;
  const outputUri = process.env.OUTPUT_URI;
  const useGcs = mode === "search" && !!inputUri && !!outputUri && isGsUri(inputUri) && isGsUri(outputUri);

  if (!mode || (!useGcs && (!inputPath || !outputPath))) {
    console.error(
      "Usage: --mode=search|evaluate --input=<path> --output=<path> [--hits=5] [--countByType=<path>]\n" +
        "  (--mode=search only) alternatively set INPUT_URI=gs://... and OUTPUT_URI=gs://... instead of --input/--output",
    );
    process.exit(1);
  }

  if (mode === "search") {
    const rakutenCreds: RakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
    const coupangCreds: CoupangCredentials = {
      accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
      secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
    };
    const hits = arg("hits") ? Number(arg("hits")) : undefined;
    const input: SearchIoLocation = useGcs ? { kind: "gcs", uri: inputUri! } : { kind: "local", path: inputPath! };
    const output: SearchIoLocation = useGcs ? { kind: "gcs", uri: outputUri! } : { kind: "local", path: outputPath! };

    const { results, outputLocation } = await runSearchModeWithIo(
      { input, output },
      { rakuten: rakutenCreds, coupang: coupangCreds },
      { hitsPerSource: hits },
    );
    console.log(`Wrote ${results.length} candidate(s) with search results to ${outputLocation}`);
    console.log(`다음: ${outputLocation} 파일을 열어 rakutenSelectedIndex/coupangSelectedIndex/matchConfidence/riskFlags를 채운 뒤 --mode=evaluate로 재실행하세요.`);
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
