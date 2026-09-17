/**
 * Tests for Phase 2-F1's eligibility -> groupBy(region) -> MarketQuote ->
 * compareMarkets() pipeline. No test runner is configured in this repo (see
 * comparisonService.test.ts for the same plain-assertion convention) - run
 * directly:
 *   npx tsx src/services/marketQuoteService.test.ts
 * Exits non-zero on any failure.
 *
 * All fake offers use currency "KRW" so convertToKrw() never calls
 * getFxRate() (no network dependency here) - same convention as
 * comparisonService.test.ts.
 */
import { evaluateOfferEligibility, groupIntoMarketQuotes, compareMarkets, offersFromListings, type Offer } from "./marketQuoteService";
import type { SourceListing } from "../domain/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
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

async function run() {
  // --- evaluateOfferEligibility ---
  check("clean offer is eligible", evaluateOfferEligibility(makeOffer()), { eligible: true, reasons: [] });
  check(
    "reviewRequired offer is ineligible",
    evaluateOfferEligibility(makeOffer({ reviewRequired: true })),
    { eligible: false, reasons: ["review_required"] },
  );
  check(
    "unavailable offer is ineligible",
    evaluateOfferEligibility(makeOffer({ availability: false })),
    { eligible: false, reasons: ["unavailable"] },
  );
  check(
    "no price / no currency offer collects both reasons",
    evaluateOfferEligibility(makeOffer({ price: null, currency: null })),
    { eligible: false, reasons: ["no_price", "no_currency"] },
  );
  check("null availability (never observed) still passes", evaluateOfferEligibility(makeOffer({ availability: null })).eligible, true);

  // --- Scenario 1: KR1 + JP1, both verified -> comparable, headline allowed ---
  {
    const kr = makeOffer({ sourceListingId: "kr-1", sourceId: "coupang", region: "KR", price: 1000, confidence: "verified" });
    const jp = makeOffer({ sourceListingId: "jp-1", sourceId: "rakuten", region: "JP", price: 800, confidence: "verified" });
    const quotes = groupIntoMarketQuotes([kr, jp]);
    const result = await compareMarkets(quotes);
    check("KR1+JP1 verified -> mode comparable", result.mode, "comparable");
    check("KR1+JP1 verified -> headline allowed", result.headlineAllowed, true);
    check("KR1+JP1 verified -> cheaper (JP) wins", result.legs.find((l) => l.isWinner)?.marketKey, "JP");
    check("KR1+JP1 verified -> 2 legs", result.legs.length, 2);
  }

  // --- Scenario 2: one side estimated -> comparable-unverified, price shown, headline suppressed ---
  {
    const kr = makeOffer({ sourceListingId: "kr-1", sourceId: "coupang", region: "KR", price: 1000, confidence: "verified" });
    const jp = makeOffer({ sourceListingId: "jp-1", sourceId: "rakuten", region: "JP", price: 800, confidence: "estimated" });
    const result = await compareMarkets(groupIntoMarketQuotes([kr, jp]));
    check("one side estimated -> mode comparable-unverified", result.mode, "comparable-unverified");
    check("one side estimated -> headline NOT allowed", result.headlineAllowed, false);
    check("one side estimated -> both legs still present (price displayable)", result.legs.length, 2);
  }

  // --- Scenario 3: one side reviewRequired -> excluded entirely, falls back to single-market ---
  {
    const kr = makeOffer({ sourceListingId: "kr-1", sourceId: "coupang", region: "KR", price: 1000 });
    const jp = makeOffer({ sourceListingId: "jp-1", sourceId: "rakuten", region: "JP", price: 800, reviewRequired: true });
    const quotes = groupIntoMarketQuotes([kr, jp]);
    const jpQuote = quotes.find((q) => q.marketKey === "JP")!;
    check("reviewRequired offer excluded with review_required reason", jpQuote.excludedOffersWithReasons[0]?.reasons, ["review_required"]);
    check("JP market has no eligible offer", jpQuote.status, "no-eligible-offer");
    const result = await compareMarkets(quotes);
    check("one side reviewRequired -> mode single-market", result.mode, "single-market");
    check("one side reviewRequired -> headline NOT allowed", result.headlineAllowed, false);
    check("one side reviewRequired -> only KR leg present", result.legs.map((l) => l.marketKey), ["KR"]);
  }

  // --- Scenario 4: same-region eligible 2개 -> duplicate-review-required, no auto-pick ---
  {
    const krA = makeOffer({ sourceListingId: "kr-a", sourceId: "coupang", region: "KR", price: 1200 });
    const krB = makeOffer({ sourceListingId: "kr-b", sourceId: "coupang", region: "KR", price: 900 });
    const jp = makeOffer({ sourceListingId: "jp-1", sourceId: "rakuten", region: "JP", price: 800 });
    const quotes = groupIntoMarketQuotes([krA, krB, jp]);
    const krQuote = quotes.find((q) => q.marketKey === "KR")!;
    check("KR duplicate -> status duplicate-review-required", krQuote.status, "duplicate-review-required");
    check("KR duplicate -> no automatic cheapest pick", krQuote.representativeOffer, null);
    check("KR duplicate -> offerCount 2", krQuote.offerCount, 2);
    check("KR duplicate -> hasDuplicate true", krQuote.hasDuplicate, true);
    const result = await compareMarkets(quotes);
    check("KR duplicate -> overall mode duplicate-review-required", result.mode, "duplicate-review-required");
    check("KR duplicate -> headline NOT allowed", result.headlineAllowed, false);
    // JP is still single/eligible - its own price must still be displayable
    // even though KR needs review (price-display vs headline are separate).
    check("KR duplicate -> JP's own price still surfaces in legs", result.legs.map((l) => l.marketKey), ["JP"]);
  }

  // --- Scenario 5: same-region 1 eligible + 1 excluded -> single, not duplicate ---
  {
    const krEligible = makeOffer({ sourceListingId: "kr-ok", sourceId: "coupang", region: "KR", price: 1000 });
    const krExcluded = makeOffer({ sourceListingId: "kr-oos", sourceId: "coupang", region: "KR", price: 1000, availability: false });
    const quotes = groupIntoMarketQuotes([krEligible, krExcluded]);
    const krQuote = quotes.find((q) => q.marketKey === "KR")!;
    check("1 eligible + 1 excluded -> status single (not duplicate)", krQuote.status, "single");
    check("1 eligible + 1 excluded -> representative is the eligible one", krQuote.representativeOffer?.sourceListingId, "kr-ok");
    check("1 eligible + 1 excluded -> excluded list carries the unavailable one", krQuote.excludedOffersWithReasons.map((e) => e.offer.sourceListingId), ["kr-oos"]);
  }

  // --- Scenario 6: no price / unavailable -> no-data ---
  {
    const kr = makeOffer({ sourceListingId: "kr-1", price: null });
    const result = await compareMarkets(groupIntoMarketQuotes([kr]));
    check("no price -> mode no-data", result.mode, "no-data");
    check("no price -> no legs", result.legs.length, 0);
    check("no price -> headline not allowed", result.headlineAllowed, false);
  }
  {
    const kr = makeOffer({ sourceListingId: "kr-1", availability: false });
    const result = await compareMarkets(groupIntoMarketQuotes([kr]));
    check("unavailable-only -> mode no-data", result.mode, "no-data");
  }

  // --- Scenario 7: existing single-offer regression - exactly one eligible offer overall ---
  {
    const kr = makeOffer({ sourceListingId: "kr-only", sourceId: "coupang", region: "KR", price: 1000 });
    const result = await compareMarkets(groupIntoMarketQuotes([kr]));
    check("single offer overall -> mode single-market", result.mode, "single-market");
    check("single offer overall -> exactly 1 leg", result.legs.length, 1);
    check("single offer overall -> headline not allowed", result.headlineAllowed, false);
  }

  // --- offersFromListings: region resolution + unmapped source dropped ---
  {
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
    const regionOf = (sourceId: string) => (sourceId === "coupang" ? ("KR" as const) : sourceId === "rakuten" ? ("JP" as const) : undefined);
    const offers = offersFromListings(
      [makeListing({ id: "a", sourceId: "coupang" }), makeListing({ id: "b", sourceId: "unknown-source" })],
      regionOf,
    );
    check("offersFromListings drops listings whose source has no known region", offers.map((o) => o.sourceListingId), ["a"]);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

run();
