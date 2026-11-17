/**
 * Tests for listMeaningfulPriceGaps() (Phase 2-F1.2) - the public "가격
 * 차이가 큰 상품" surface (Home's hero pick is this list's #1 entry) must
 * only include/rank a verified comparable MarketQuote pair; estimated,
 * single-market, duplicate-review-required, and no-data entries must never
 * appear here regardless of what the legacy leg-based `comparison` field
 * would have said. No test runner is configured in this repo (see
 * comparisonService.test.ts for the same plain-assertion convention) - run
 * directly:
 *   npx tsx src/services/catalogService.test.ts
 * Exits non-zero on any failure.
 *
 * All fake listings use currency "KRW" so convertToKrw() never calls
 * getFxRate() (no network dependency here) - same convention as
 * comparisonService.test.ts.
 */
import { listMeaningfulPriceGaps, listByCategory, searchCatalog, listRecentlyChecked } from "./catalogService";
import { parsePublicPriceSources } from "../domain/publicDisplay";
import type { CanonicalProduct, ProductVariant, Source, SourceListing } from "../domain/types";
import type { Repositories } from "../repository/types";
import type { ProductWithVariant } from "../repository/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function makeProduct(id: string): CanonicalProduct {
  return { id, category: "camera", brand: "Test", officialName: id, productType: null, createdAt: "", updatedAt: "" };
}

function makeVariant(id: string): ProductVariant {
  return { id, canonicalProductId: id, variantAttributes: {}, modelSku: null, displayName: null, imageUrl: null, createdAt: "" };
}

function makeListing(overrides: Partial<SourceListing> = {}): SourceListing {
  return {
    id: `${overrides.productVariantId ?? "v"}-${overrides.sourceId ?? "coupang"}`,
    productVariantId: "variant-1",
    sourceId: "coupang",
    externalId: "ext-1",
    externalIdType: "coupang_product_id",
    sourceUrl: null,
    searchKeywordUsed: "keyword",
    approvedAt: "2026-08-01T00:00:00.000Z",
    approvedBy: "tester",
    confidence: "verified",
    lastCheckedAt: "2026-09-17T00:00:00.000Z",
    lastSuccessAt: "2026-09-17T00:00:00.000Z",
    staleAfterHours: 24,
    reviewRequired: false,
    reviewReason: null,
    lastKnownPrice: 1000,
    lastKnownCurrency: "KRW",
    lastKnownAvailability: true,
    shippingStatus: "unknown",
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

const SOURCES: Source[] = [
  { id: "coupang", name: "Coupang", region: "KR", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
  { id: "rakuten", name: "Rakuten", region: "JP", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
];

async function run() {
  const pairs: ProductWithVariant[] = [
    { product: makeProduct("verified-big"), variant: makeVariant("verified-big") },
    { product: makeProduct("verified-small"), variant: makeVariant("verified-small") },
    { product: makeProduct("estimated-huge-gap"), variant: makeVariant("estimated-huge-gap") },
    { product: makeProduct("single-market"), variant: makeVariant("single-market") },
    { product: makeProduct("duplicate-market"), variant: makeVariant("duplicate-market") },
    { product: makeProduct("no-data"), variant: makeVariant("no-data") },
  ];

  const listingsByVariant: Record<string, SourceListing[]> = {
    "verified-big": [
      makeListing({ productVariantId: "verified-big", sourceId: "coupang", id: "vb-kr", lastKnownPrice: 300_000 }),
      makeListing({ productVariantId: "verified-big", sourceId: "rakuten", id: "vb-jp", lastKnownPrice: 100_000 }),
    ],
    "verified-small": [
      makeListing({ productVariantId: "verified-small", sourceId: "coupang", id: "vs-kr", lastKnownPrice: 110_000 }),
      makeListing({ productVariantId: "verified-small", sourceId: "rakuten", id: "vs-jp", lastKnownPrice: 100_000 }),
    ],
    // estimated confidence on both legs, but a MUCH bigger raw price gap
    // than either verified entry above - must still be excluded entirely,
    // not merely ranked lower.
    "estimated-huge-gap": [
      makeListing({ productVariantId: "estimated-huge-gap", sourceId: "coupang", id: "eg-kr", lastKnownPrice: 900_000, confidence: "estimated" }),
      makeListing({ productVariantId: "estimated-huge-gap", sourceId: "rakuten", id: "eg-jp", lastKnownPrice: 100_000, confidence: "estimated" }),
    ],
    "single-market": [makeListing({ productVariantId: "single-market", sourceId: "coupang", id: "sm-kr", lastKnownPrice: 100_000 })],
    // 2 eligible KR offers -> duplicate-review-required, no representative.
    "duplicate-market": [
      makeListing({ productVariantId: "duplicate-market", sourceId: "coupang", id: "dm-kr-a", externalId: "ext-a", lastKnownPrice: 120_000 }),
      makeListing({ productVariantId: "duplicate-market", sourceId: "coupang", id: "dm-kr-b", externalId: "ext-b", lastKnownPrice: 90_000 }),
    ],
    "no-data": [makeListing({ productVariantId: "no-data", sourceId: "coupang", id: "nd-kr", lastKnownPrice: null })],
  };

  const repos: Pick<Repositories, "canonicalProducts" | "sourceListings" | "sources"> = {
    canonicalProducts: {
      listAllVariants: async () => pairs,
      listVariantsByCategory: async () => pairs,
      searchProducts: async () => pairs,
    } as any,
    sourceListings: {
      listByVariant: async (variantId: string) => listingsByVariant[variantId] ?? [],
    } as any,
    sources: {
      listAll: async () => SOURCES,
    } as any,
  };

  // Ranking-semantics checks (Phase 2-F1.2) run with BOTH sources explicitly
  // allowed, so they keep testing exactly what they tested before the
  // public-display policy existed.
  const bothAllowed = { publicPolicy: parsePublicPriceSources("coupang,rakuten") };
  const result = await listMeaningfulPriceGaps(repos, 10, bothAllowed);
  const ids = result.map((e) => e.product.id);

  check("only the 2 verified comparable entries are included", ids, ["verified-big", "verified-small"]);
  check("estimated entry excluded despite a much bigger raw gap", ids.includes("estimated-huge-gap"), false);
  check("single-market entry excluded", ids.includes("single-market"), false);
  check("duplicate-review-required entry excluded", ids.includes("duplicate-market"), false);
  check("no-data entry excluded", ids.includes("no-data"), false);
  check("verified entries sorted by new diff descending (big first)", ids[0], "verified-big");

  // --- public-display policy (src/domain/publicDisplay.ts) ---
  const savedEnv = process.env.PUBLIC_PRICE_SOURCES;
  delete process.env.PUBLIC_PRICE_SOURCES;
  try {
    // No env var, no explicit policy -> default deny: nothing comparable,
    // no listing/price of ANY source carried on any public entry.
    const gapsDefault = await listMeaningfulPriceGaps(repos, 10);
    check("default (env missing): no price-gap entries at all", gapsDefault.length, 0);
    for (const [label, entries] of [
      ["listByCategory", await listByCategory(repos, "camera")],
      ["searchCatalog", await searchCatalog(repos, "test")],
    ] as const) {
      check(`default: ${label} still lists products (empty state, not an error)`, entries.length, pairs.length);
      check(`default: ${label} carries zero listings`, entries.reduce((n, e) => n + e.listings.length, 0), 0);
      check(`default: ${label} every marketComparison is no-data`, entries.every((e) => e.marketComparison.mode === "no-data"), true);
      check(`default: ${label} every legacy comparison is no-data`, entries.every((e) => e.comparison.mode === "no-data"), true);
    }
    check("default: listRecentlyChecked has nothing (no public check timestamps)", (await listRecentlyChecked(repos, 10)).length, 0);
  } finally {
    if (savedEnv === undefined) delete process.env.PUBLIC_PRICE_SOURCES;
    else process.env.PUBLIC_PRICE_SOURCES = savedEnv;
  }

  // Explicit coupang-only: rakuten listings never reach an entry, so no
  // KR/JP comparison can be formed from rakuten data.
  const coupangOnly = { publicPolicy: parsePublicPriceSources("coupang") };
  const cat = await listByCategory(repos, "camera", coupangOnly);
  const allSourceIds = cat.flatMap((e) => e.listings.map((l) => l.sourceId));
  check("coupang-only: no rakuten listing on any entry", allSourceIds.includes("rakuten"), false);
  check("coupang-only: coupang listings still present", allSourceIds.includes("coupang"), true);
  check(
    "coupang-only: no JP market quote on any entry",
    cat.some((e) => e.marketComparison.marketQuotes.some((q) => q.marketKey === "JP")),
    false,
  );
  check(
    "coupang-only: legacy comparison legs contain no rakuten",
    cat.some((e) => e.comparison.legs.some((l) => l.sourceId === "rakuten")),
    false,
  );
  check("coupang-only: price-gap list empty (only one market public)", (await listMeaningfulPriceGaps(repos, 10, coupangOnly)).length, 0);
  check(
    "coupang-only: verified-big becomes single-market (KR only)",
    cat.find((e) => e.product.id === "verified-big")?.marketComparison.mode,
    "single-market",
  );

  // Variant image provenance: a rakuten-hosted image is withheld unless rakuten is allowed.
  const imgPairs: ProductWithVariant[] = [
    { product: makeProduct("img"), variant: { ...makeVariant("img"), imageUrl: "https://thumbnail.image.rakuten.co.jp/x.jpg" } },
  ];
  const imgRepos = { ...repos, canonicalProducts: { searchProducts: async () => imgPairs } as any };
  check("coupang-only: rakuten-hosted variant image withheld", (await searchCatalog(imgRepos, "img", coupangOnly))[0].variant.imageUrl, null);
  check(
    "rakuten allowed: rakuten-hosted variant image kept",
    (await searchCatalog(imgRepos, "img", { publicPolicy: parsePublicPriceSources("rakuten") }))[0].variant.imageUrl,
    "https://thumbnail.image.rakuten.co.jp/x.jpg",
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

run();
