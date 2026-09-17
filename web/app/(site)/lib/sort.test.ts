/**
 * Tests for sortEntries()'s "diff" sort (Phase 2-F1.2) - only a verified
 * comparable MarketQuote pair counts as a real gap; everything else keeps
 * its existing relative order, placed after every verified entry, and
 * never gets ranked by the legacy leg-based `comparison` field's savings
 * figure. No test runner is configured in this repo (see
 * comparisonService.test.ts for the same plain-assertion convention) - run
 * directly:
 *   npx tsx "web/app/(site)/lib/sort.test.ts"
 * Exits non-zero on any failure.
 */
import { sortEntries } from "./sort";
import type { CatalogEntry } from "@core/services/catalogService";
import type { ComparisonResult } from "@core/services/comparisonService";
import type { MarketComparisonResult, MarketComparisonLeg, Offer } from "@core/services/marketQuoteService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    sourceListingId: "listing-1",
    sourceId: "coupang",
    region: "KR",
    price: 1000,
    currency: "KRW",
    availability: true,
    reviewRequired: false,
    confidence: "verified",
    shippingStatus: "unknown",
    sourceUrl: null,
    ...overrides,
  };
}

/** legacy `comparison` shape - never consulted by sortEntries anymore, but
 * still present on CatalogEntry, so fakes need SOME value here. Deliberately
 * given a huge, obviously-wrong savings figure in a couple of tests below to
 * prove sortEntries() genuinely ignores it. */
function legacyComparison(mode: ComparisonResult["mode"], winnerSavings: number): ComparisonResult {
  const leg = {
    sourceListingId: "legacy-1",
    sourceId: "rakuten",
    price: 1,
    currency: "KRW",
    krwPrice: 1,
    availability: true,
    isWinner: true,
    diffFromWinnerKrw: 0,
    savingsVsHighestKrw: winnerSavings,
    fxRateUsed: null,
    fxAsOf: null,
  };
  return { productVariantId: "v", mode, legCount: 1, legs: mode === "no-data" ? [] : [leg] };
}

function comparableResult(diffKrw: number, confidence: "verified" | "estimated" = "verified"): MarketComparisonResult {
  const krLeg: MarketComparisonLeg = {
    marketKey: "KR",
    offer: offer({ region: "KR", confidence }),
    krwPrice: 100_000 + diffKrw,
    fxRateUsed: null,
    fxAsOf: null,
    isWinner: false,
    diffFromWinnerKrw: diffKrw,
    savingsVsHighestKrw: 0,
  };
  const jpLeg: MarketComparisonLeg = {
    marketKey: "JP",
    offer: offer({ region: "JP", sourceId: "rakuten", confidence }),
    krwPrice: 100_000,
    fxRateUsed: 1,
    fxAsOf: "2026-09-17T00:00:00.000Z",
    isWinner: true,
    diffFromWinnerKrw: 0,
    savingsVsHighestKrw: diffKrw,
  };
  const mode = confidence === "verified" ? "comparable" : "comparable-unverified";
  return { mode, marketQuotes: [], legs: [krLeg, jpLeg], headlineAllowed: mode === "comparable" };
}

function noDataResult(): MarketComparisonResult {
  return { mode: "no-data", marketQuotes: [], legs: [], headlineAllowed: false };
}

function entry(id: string, marketComparison: MarketComparisonResult, legacySavings = 0, legacyMode: ComparisonResult["mode"] = "n-way"): CatalogEntry {
  return {
    product: { id, category: "camera", brand: "Test", officialName: id, productType: null, createdAt: "", updatedAt: "" },
    variant: { id, canonicalProductId: id, variantAttributes: {}, modelSku: null, displayName: null, imageUrl: null, createdAt: "" },
    listings: [],
    comparison: legacyComparison(legacyMode, legacySavings),
    marketComparison,
    lastCheckedAt: null,
  };
}

// --- estimated with a huge legacy savings must NOT outrank a verified entry ---
{
  const estimatedBig = entry("estimated-big", comparableResult(500_000, "estimated"), 999_999);
  const verifiedSmall = entry("verified-small", comparableResult(1_000, "verified"), 1);
  const sorted = sortEntries([estimatedBig, verifiedSmall], "diff");
  check("verified entry ranks before estimated entry regardless of legacy savings", sorted.map((e) => e.product.id), ["verified-small", "estimated-big"]);
}

// --- verified comparable entries sort by NEW diff, descending ---
{
  const small = entry("verified-small", comparableResult(10_000));
  const big = entry("verified-big", comparableResult(90_000));
  const mid = entry("verified-mid", comparableResult(50_000));
  const sorted = sortEntries([small, big, mid], "diff");
  check("verified comparable entries sorted by new diff descending", sorted.map((e) => e.product.id), ["verified-big", "verified-mid", "verified-small"]);
}

// --- single-market / duplicate / no-data all keep their relative order, after every verified entry ---
{
  const dup: MarketComparisonResult = { mode: "duplicate-review-required", marketQuotes: [], legs: [], headlineAllowed: false };
  const single: MarketComparisonResult = {
    mode: "single-market",
    marketQuotes: [],
    legs: [{ marketKey: "KR", offer: offer(), krwPrice: 100_000, fxRateUsed: null, fxAsOf: null, isWinner: false, diffFromWinnerKrw: 0, savingsVsHighestKrw: 0 }],
    headlineAllowed: false,
  };
  const noData = noDataResult();
  const verified = entry("verified", comparableResult(10_000));
  const entries = [entry("dup", dup, 500_000), entry("single", single, 400_000), verified, entry("no-data", noData, 300_000)];
  const sorted = sortEntries(entries, "diff");
  check(
    "verified first, then dup/single/no-data in their original relative order",
    sorted.map((e) => e.product.id),
    ["verified", "dup", "single", "no-data"],
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
