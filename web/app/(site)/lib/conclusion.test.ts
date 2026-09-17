/**
 * Tests for buildConclusion()'s wording contract (Phase 2-F1) - no
 * "최저가"/"가장 저렴해요"/"N원 절약" framing, a neutral "차이" only for
 * mode === "comparable", and the "다른 판매처에서 더 저렴할 수 있습니다"
 * disclosure exactly once per result (never duplicated across cardLine/
 * headline/diffLine). No test runner is configured in this repo (see
 * comparisonService.test.ts for the same plain-assertion convention) - run
 * directly:
 *   npx tsx "web/app/(site)/lib/conclusion.test.ts"
 * Exits non-zero on any failure.
 */
import { buildConclusion, quoteByRegion } from "./conclusion";
import type { MarketComparisonResult, MarketComparisonLeg, MarketQuote, Offer } from "@core/services/marketQuoteService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const FORBIDDEN = ["최저가", "가장 저렴", "절약"];
function checkNeverContainsForbiddenWording(name: string, conclusion: ReturnType<typeof buildConclusion>) {
  const haystack = [conclusion.cardLine, conclusion.headline, conclusion.diffLine ?? "", conclusion.disclosure ?? ""].join(" ");
  for (const word of FORBIDDEN) {
    check(`${name} - never contains "${word}"`, haystack.includes(word), false);
  }
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

function leg(overrides: Partial<MarketComparisonLeg> = {}): MarketComparisonLeg {
  return {
    marketKey: "KR",
    offer: offer(),
    krwPrice: 1000,
    fxRateUsed: null,
    fxAsOf: null,
    isWinner: false,
    diffFromWinnerKrw: 0,
    savingsVsHighestKrw: 0,
    ...overrides,
  };
}

function quote(marketKey: string, representativeOffer: Offer | null, status: MarketQuote["status"] = "single"): MarketQuote {
  return {
    marketKey,
    eligibleOffers: representativeOffer ? [representativeOffer] : [],
    excludedOffersWithReasons: [],
    representativeOffer,
    offerCount: representativeOffer ? 1 : 0,
    hasDuplicate: status === "duplicate-review-required",
    allVerified: representativeOffer?.confidence === "verified",
    status,
  };
}

function result(overrides: Partial<MarketComparisonResult>): MarketComparisonResult {
  return { mode: "no-data", marketQuotes: [], legs: [], headlineAllowed: false, ...overrides };
}

// --- no-data ---
{
  const c = buildConclusion(result({ mode: "no-data" }));
  check("no-data headline", c.headline, "아직 비교할 가격 정보가 없어요");
  check("no-data has no diffLine", c.diffLine, null);
  check("no-data has no disclosure", c.disclosure, null);
  checkNeverContainsForbiddenWording("no-data", c);
}

// --- single-market ---
{
  const krLeg = leg({ marketKey: "KR", krwPrice: 1000 });
  const c = buildConclusion(result({ mode: "single-market", legs: [krLeg], marketQuotes: [quote("KR", krLeg.offer)] }));
  check("single-market headline mentions the market, not a winner claim", c.headline, "한국에서 확인한 가격이에요");
  check("single-market has no diffLine", c.diffLine, null);
  check("single-market carries the disclosure once", c.disclosure, "다른 판매처에서 더 저렴할 수 있습니다");
  checkNeverContainsForbiddenWording("single-market", c);
}

// --- comparable (KR1 + JP1, both verified) -> diffLine allowed ---
{
  const krLeg = leg({ marketKey: "KR", krwPrice: 150_000, savingsVsHighestKrw: 0 });
  const jpLeg = leg({ marketKey: "JP", krwPrice: 100_000, isWinner: true, savingsVsHighestKrw: 50_000 });
  const c = buildConclusion(
    result({ mode: "comparable", legs: [krLeg, jpLeg], marketQuotes: [quote("KR", krLeg.offer), quote("JP", jpLeg.offer)] }),
  );
  check("comparable headline names both markets", c.headline, "한국·일본에서 확인한 가격이에요");
  check("comparable diffLine states a neutral difference", c.diffLine, "확인한 가격 기준 약 50,000원 차이");
  check("comparable carries the disclosure once", c.disclosure, "다른 판매처에서 더 저렴할 수 있습니다");
  checkNeverContainsForbiddenWording("comparable", c);
}

// --- comparable-unverified (one side estimated) -> price framing only, no diff ---
{
  const krLeg = leg({ marketKey: "KR", krwPrice: 150_000 });
  const jpLeg = leg({ marketKey: "JP", krwPrice: 100_000, offer: offer({ confidence: "estimated" }) });
  const c = buildConclusion(
    result({ mode: "comparable-unverified", legs: [krLeg, jpLeg], marketQuotes: [quote("KR", krLeg.offer), quote("JP", jpLeg.offer)] }),
  );
  check("comparable-unverified headline still names both markets", c.headline, "한국·일본에서 확인한 가격이에요");
  check("comparable-unverified suppresses diffLine", c.diffLine, null);
  check("comparable-unverified still discloses", c.disclosure, "다른 판매처에서 더 저렴할 수 있습니다");
  checkNeverContainsForbiddenWording("comparable-unverified", c);
}

// --- duplicate-review-required -> no price claim at all ---
{
  const c = buildConclusion(
    result({
      mode: "duplicate-review-required",
      legs: [],
      marketQuotes: [quote("KR", null, "duplicate-review-required"), quote("JP", offer({ region: "JP" }))],
    }),
  );
  check("duplicate headline signals review, not a price", c.headline, "판매처 확인이 필요해요");
  check("duplicate has no diffLine", c.diffLine, null);
  check("duplicate has no disclosure (no confident price to disclose against)", c.disclosure, null);
  checkNeverContainsForbiddenWording("duplicate", c);
}

// --- quoteByRegion: plain reindex by marketKey ---
{
  const krQuote = quote("KR", offer());
  const jpQuote = quote("JP", offer({ region: "JP", sourceId: "rakuten" }));
  const byRegion = quoteByRegion(result({ marketQuotes: [krQuote, jpQuote] }));
  check("quoteByRegion.KR", byRegion.KR, krQuote);
  check("quoteByRegion.JP", byRegion.JP, jpQuote);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
