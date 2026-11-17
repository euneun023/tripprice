/**
 * Tests for the product page's server-side public gate and JSON-LD builder:
 * a source not allowed by the public-display policy must never reach a
 * MarketQuote, an out-of-stock row or a JSON-LD Offer, and an all-withheld
 * product must degrade to a normal empty state. No network: groupIntoMarketQuotes()
 * is sync and never converts currency. No test runner is configured in this
 * repo - run directly from web/ (for the @core path alias):
 *   cd web && npx tsx "app/(site)/lib/productPublicView.test.ts"
 * Exits non-zero on any failure.
 */
import { preparePublicListings, buildJsonLdOffers } from "./productPublicView";
import { groupIntoMarketQuotes, offersFromListings } from "@core/services/marketQuoteService";
import { parsePublicPriceSources } from "@core/domain/publicDisplay";
import type { Source, SourceListing } from "@core/domain/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const SOURCES: Source[] = [
  { id: "coupang", name: "Coupang Partners (Affiliate Open API)", region: "KR", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
  { id: "rakuten", name: "Rakuten Ichiba (Item Search API)", region: "JP", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
];
const sourceById = new Map(SOURCES.map((s) => [s.id, s]));
const regionOf = (id: string) => sourceById.get(id)?.region;

function listing(o: Partial<SourceListing>): SourceListing {
  return {
    id: "l",
    productVariantId: "v1",
    sourceId: "coupang",
    externalId: "e",
    externalIdType: "x",
    sourceUrl: "https://link.coupang.com/re/AFFSDP?x=1",
    searchKeywordUsed: "k",
    approvedAt: "",
    approvedBy: "t",
    confidence: "verified",
    lastCheckedAt: "2026-11-01T00:00:00Z",
    lastSuccessAt: "2026-11-01T00:00:00Z",
    staleAfterHours: 24,
    reviewRequired: false,
    reviewReason: null,
    lastKnownPrice: 1_200_000,
    lastKnownCurrency: "KRW",
    lastKnownAvailability: true,
    shippingStatus: "unknown",
    isActive: true,
    createdAt: "",
    updatedAt: "",
    ...o,
  };
}

const kr = listing({ id: "kr", sourceId: "coupang" });
const jp = listing({
  id: "jp",
  sourceId: "rakuten",
  sourceUrl: "https://item.rakuten.co.jp/shop/item/",
  lastKnownPrice: 215_000,
  lastKnownCurrency: "JPY",
});
const jpOut = listing({
  id: "jp-out",
  sourceId: "rakuten",
  externalId: "e2",
  sourceUrl: "https://item.rakuten.co.jp/shop/item2/",
  lastKnownPrice: 199_000,
  lastKnownCurrency: "JPY",
  lastKnownAvailability: false,
});
const raw = [kr, jp, jpOut];

/** Mirrors the page's own derivation from the filtered listings. */
function pageJsonLd(listings: SourceListing[]) {
  const quotes = groupIntoMarketQuotes(offersFromListings(listings, regionOf));
  const outOfStock = listings.filter((l) => l.lastKnownPrice !== null && l.lastKnownAvailability === false);
  return { quotes, outOfStock, offers: buildJsonLdOffers(quotes, outOfStock, sourceById) };
}
const blob = (x: unknown) => JSON.stringify(x);

// --- default policy (env missing): nothing public ---
{
  const view = preparePublicListings(raw, SOURCES, parsePublicPriceSources(undefined));
  check("default: no listings reach the page", view.listings.length, 0);
  check("default: both markets reported as withheld", [...view.withheldRegions].sort(), ["JP", "KR"]);
  const { quotes, outOfStock, offers } = pageJsonLd(view.listings);
  check("default: no MarketQuotes", quotes.length, 0);
  check("default: no out-of-stock rows", outOfStock.length, 0);
  check("default: zero JSON-LD offers (page then omits JSON-LD entirely)", offers.length, 0);
}

// --- coupang-only: rakuten blocked everywhere ---
{
  const view = preparePublicListings(raw, SOURCES, parsePublicPriceSources("coupang"));
  check("coupang-only: only the coupang listing passes", view.listings.map((l) => l.id), ["kr"]);
  check("coupang-only: JP reported as withheld", view.withheldRegions, ["JP"]);
  const { quotes, outOfStock, offers } = pageJsonLd(view.listings);
  check("coupang-only: no JP MarketQuote", quotes.some((q) => q.marketKey === "JP"), false);
  check("coupang-only: rakuten out-of-stock row not shown", outOfStock.length, 0);
  check("coupang-only: JSON-LD has exactly the KR offer", offers.length, 1);
  check("coupang-only: JSON-LD has no JPY price", blob(offers).includes("JPY"), false);
  check("coupang-only: JSON-LD has no rakuten URL", blob(offers).includes("rakuten"), false);
  check("coupang-only: JSON-LD has no rakuten seller name", blob(offers).includes("라쿠텐"), false);
  check("coupang-only: KR offer is in KRW", offers[0]?.priceCurrency, "KRW");
}

// --- rakuten-only (hypothetical future permission): coupang blocked too, no implicit allow ---
{
  const view = preparePublicListings(raw, SOURCES, parsePublicPriceSources("rakuten"));
  check("rakuten-only: coupang listing blocked", view.listings.some((l) => l.sourceId === "coupang"), false);
  check("rakuten-only: KR reported as withheld", view.withheldRegions, ["KR"]);
  const { offers } = pageJsonLd(view.listings);
  check("rakuten-only: JSON-LD has no coupang URL", blob(offers).includes("coupang"), false);
}

// --- both explicitly allowed: unchanged pre-policy behavior ---
{
  const view = preparePublicListings(raw, SOURCES, parsePublicPriceSources("coupang,rakuten"));
  check("both allowed: all listings pass", view.listings.length, 3);
  check("both allowed: nothing withheld", view.withheldRegions, []);
  const { offers } = pageJsonLd(view.listings);
  check("both allowed: KR + JP in-stock + JP out-of-stock offers", offers.map((o) => `${o.priceCurrency}:${o.availability.split("/").pop()}`), [
    "KRW:InStock",
    "JPY:InStock",
    "JPY:OutOfStock",
  ]);
}

// --- a region with a public listing is never "withheld", even if another source there is blocked ---
{
  const view = preparePublicListings([kr, listing({ id: "kr2", sourceId: "manual-kr" })], [...SOURCES, { ...SOURCES[0], id: "manual-kr" }], parsePublicPriceSources("coupang"));
  check("mixed KR: not marked withheld when a public KR listing exists", view.withheldRegions, []);
}

// --- input not mutated ---
check("raw input untouched", raw.map((l) => l.id), ["kr", "jp", "jp-out"]);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
