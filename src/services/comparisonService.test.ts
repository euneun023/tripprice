/**
 * Tests for compareVariant(), focused on the reviewRequired exclusion added
 * in Phase 2-B1. No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention) - run directly:
 *   npx tsx src/services/comparisonService.test.ts
 * Exits non-zero on any failure.
 *
 * All fake listings use currency "KRW" so convertToKrw() never calls
 * getFxRate() (no network/DB dependency here) - same convention as
 * refreshJobService.test.ts's plain in-file fakes.
 */
import { compareVariant } from "./comparisonService";
import type { SourceListing } from "../domain/types";
import type { Repositories } from "../repository/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function makeListing(overrides: Partial<SourceListing> = {}): SourceListing {
  return {
    id: "listing-1",
    productVariantId: "variant-1",
    sourceId: "coupang",
    externalId: "ext-1",
    externalIdType: "coupang_product_id",
    sourceUrl: null,
    searchKeywordUsed: "keyword",
    approvedAt: "2026-08-01T00:00:00.000Z",
    approvedBy: "tester",
    confidence: "verified",
    lastCheckedAt: "2026-08-19T00:00:00.000Z",
    lastSuccessAt: "2026-08-19T00:00:00.000Z",
    staleAfterHours: 24,
    reviewRequired: false,
    reviewReason: null,
    lastKnownPrice: 1000,
    lastKnownCurrency: "KRW",
    lastKnownAvailability: true,
    shippingStatus: "unknown",
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function fakeRepos(listings: SourceListing[]): Pick<Repositories, "sourceListings"> {
  return {
    sourceListings: {
      listByVariant: async () => listings,
    } as any,
  };
}

async function run() {
  // A reviewRequired listing with a real price is excluded entirely - never
  // counted as a leg, never eligible to win.
  {
    const result = await compareVariant(
      fakeRepos([
        makeListing({ id: "kr-1", sourceId: "coupang", lastKnownPrice: 1000, reviewRequired: false }),
        makeListing({ id: "jp-flagged", sourceId: "rakuten", lastKnownPrice: 1, reviewRequired: true, reviewReason: "NOT_FOUND" }),
      ]),
      "variant-1",
    );
    check("reviewRequired leg is excluded from legs entirely", result.legs.map((l) => l.sourceListingId), ["kr-1"]);
    check("mode falls back to single when only one non-flagged listing remains", result.mode, "single");
  }

  // Both legs clean -> normal n-way comparison, unaffected by this change.
  {
    const result = await compareVariant(
      fakeRepos([
        makeListing({ id: "kr-1", sourceId: "coupang", lastKnownPrice: 1000 }),
        makeListing({ id: "jp-1", sourceId: "rakuten", lastKnownPrice: 800 }),
      ]),
      "variant-1",
    );
    check("two clean legs still produce n-way with the cheaper one winning", { mode: result.mode, winner: result.legs.find((l) => l.isWinner)?.sourceListingId }, { mode: "n-way", winner: "jp-1" });
  }

  // A reviewRequired listing that's also unavailable/no-price is already
  // filtered by the pre-existing checks - this just confirms the two
  // conditions compose (no double-counting/crash) rather than testing
  // pre-existing behavior again.
  {
    const result = await compareVariant(
      fakeRepos([makeListing({ id: "only-1", lastKnownPrice: null, reviewRequired: true })]),
      "variant-1",
    );
    check("no-data mode when the only listing has neither a price nor a valid state", result.mode, "no-data");
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

run();
