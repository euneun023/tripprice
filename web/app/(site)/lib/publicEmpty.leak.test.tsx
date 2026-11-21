/**
 * Release check: with PUBLIC_PRICE_SOURCES empty/unset, nothing derived from a
 * source's data (price, seller URL, image URL, source name, JSON-LD offers,
 * OG image) may reach rendered output, while products still render.
 * Run from web/:  npx tsx "app/(site)/lib/publicEmpty.leak.test.tsx"
 */
import { renderToStaticMarkup } from "react-dom/server";
import { listByCategory, searchCatalog, listMeaningfulPriceGaps, listRecentlyChecked, listFeaturedProducts } from "@core/services/catalogService";
import { offersFromListings, groupIntoMarketQuotes } from "@core/services/marketQuoteService";
import { publicDisplayPolicyFromEnv, withPublicImage } from "@core/domain/publicDisplay";
import type { CanonicalProduct, ProductVariant, Source, SourceListing } from "@core/domain/types";
import { ProductCardGrid } from "../components/ProductCardGrid";
import { RecentRowList } from "../components/RecentRowList";
import { preparePublicListings, buildJsonLdOffers } from "./productPublicView";
import { buildMetadata } from "../../lib/seo";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const KR_IMG = "https://ads-partners.coupang.com/image1/LEAK-KR-IMG.jpg";
const JP_IMG = "https://thumbnail.image.rakuten.co.jp/LEAK-JP-IMG.jpg";
const MARKERS = ["987,654", "987654", "123,456", "123456", "LEAK-KR", "LEAK-JP", "LEAK-SELLER", "coupang.com", "rakuten.co.jp", "Coupang", "Rakuten", "쿠팡", "라쿠텐"];

const product: CanonicalProduct = { id: "p1", category: "camera", brand: "Test", officialName: "Leak Camera", productType: null, createdAt: "", updatedAt: "" };
const variant: ProductVariant = { id: "v1", canonicalProductId: "p1", variantAttributes: {}, modelSku: "M-1", displayName: null, imageUrl: KR_IMG, createdAt: "" };
const variant2: ProductVariant = { ...variant, id: "v2", imageUrl: JP_IMG };
const base = {
  externalId: "e", externalIdType: "coupang_product_id" as const, searchKeywordUsed: "k", approvedAt: "2026-08-01T00:00:00Z", approvedBy: "t",
  confidence: "verified" as const, lastCheckedAt: "2026-11-20T00:00:00Z", lastSuccessAt: "2026-11-20T00:00:00Z", staleAfterHours: 24,
  reviewRequired: false, reviewReason: null, lastKnownAvailability: true, shippingStatus: "unknown" as const, isActive: true, createdAt: "", updatedAt: "",
};
const listings: SourceListing[] = [
  { ...base, id: "l-kr", productVariantId: "v1", sourceId: "coupang", sourceUrl: "https://link.coupang.com/LEAK-SELLER-KR", lastKnownPrice: 123456, lastKnownCurrency: "KRW" },
  { ...base, id: "l-jp", productVariantId: "v1", sourceId: "rakuten", externalIdType: "rakuten_item_code", sourceUrl: "https://item.rakuten.co.jp/LEAK-SELLER-JP", lastKnownPrice: 987654, lastKnownCurrency: "JPY" },
  { ...base, id: "l-oos", productVariantId: "v1", sourceId: "coupang", externalId: "e2", sourceUrl: "https://link.coupang.com/LEAK-SELLER-OOS", lastKnownPrice: 987654, lastKnownCurrency: "KRW", lastKnownAvailability: false },
];
const SOURCES: Source[] = [
  { id: "coupang", name: "Coupang", region: "KR", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
  { id: "rakuten", name: "Rakuten", region: "JP", updateMethod: "api", automationStatus: "semi-auto", defaultStaleAfterHours: 24, rateLimitPerHour: null },
];
const pairs = [{ product, variant }, { product: { ...product, id: "p2", officialName: "Second" }, variant: variant2 }];
const repos = {
  canonicalProducts: { listAllVariants: async () => pairs, listVariantsByCategory: async () => pairs, searchProducts: async () => pairs } as any,
  sourceListings: { listByVariant: async (id: string) => listings.filter((l) => l.productVariantId === id) } as any,
  sources: { listAll: async () => SOURCES } as any,
};

function leaks(label: string, text: string) {
  for (const m of MARKERS) check(`${label}: no "${m}"`, text.includes(m), false);
}

async function run() {
  for (const raw of [undefined, "", "   ", "all", "*", "true"]) {
    if (raw === undefined) delete process.env.PUBLIC_PRICE_SOURCES;
    else process.env.PUBLIC_PRICE_SOURCES = raw;
    const tag = `env=${JSON.stringify(raw)}`;

    const category = await listByCategory(repos, "camera");
    const search = await searchCatalog(repos, "leak");
    const gaps = await listMeaningfulPriceGaps(repos, 8);
    const recent = await listRecentlyChecked(repos, 6);
    const featured = await listFeaturedProducts(repos, 8);

    check(`${tag}: category/search still list products`, [category.length, search.length], [2, 2]);
    check(`${tag}: gaps/recent empty, featured fallback present`, [gaps.length, recent.length, featured.length], [0, 0, 2]);

    const html = renderToStaticMarkup(<ProductCardGrid entries={category} variant="grid" />)
      + renderToStaticMarkup(<ProductCardGrid entries={search} variant="grid" />)
      + renderToStaticMarkup(<ProductCardGrid entries={featured} />)
      + renderToStaticMarkup(<RecentRowList entries={featured} />);
    check(`${tag}: product names still rendered`, html.includes("Leak Camera"), true);
    check(`${tag}: no <img>/next-image src leaked`, /<img/i.test(html), false);
    check(`${tag}: no price-comparison claim on cards`, /최저가|절약|원 차이/.test(html), false);
    leaks(`${tag} cards`, html);

    // product detail pipeline
    const policy = publicDisplayPolicyFromEnv();
    const pub = preparePublicListings(listings, SOURCES, policy);
    check(`${tag}: detail listings empty`, pub.listings.length, 0);
    check(`${tag}: both regions marked withheld`, pub.withheldRegions.sort(), ["JP", "KR"]);
    const quotes = groupIntoMarketQuotes(offersFromListings(pub.listings, (id) => SOURCES.find((s) => s.id === id)?.region));
    const offers = buildJsonLdOffers(quotes, pub.listings, new Map(SOURCES.map((s) => [s.id, s])));
    check(`${tag}: JSON-LD offers empty (page omits JSON-LD)`, offers.length, 0);
    const img = withPublicImage(variant, policy).imageUrl;
    check(`${tag}: detail image withheld`, img, null);
    const meta = buildMetadata({ title: "t", description: "d", path: "/products/v1", image: img });
    leaks(`${tag} metadata`, JSON.stringify(meta));
  }
  delete process.env.PUBLIC_PRICE_SOURCES;

  // positive control: the leak markers WOULD show if coupang were allowed.
  process.env.PUBLIC_PRICE_SOURCES = "coupang";
  const ctl = (await listByCategory(repos, "camera")).map((e) => ({ ...e, variant: { ...e.variant, imageUrl: null } })); // next/image can't load hosts outside a Next runtime
  check("control: coupang-only exposes coupang price (test can detect leaks)", renderToStaticMarkup(<ProductCardGrid entries={ctl} variant="grid" />).includes("123,456"), true);
  delete process.env.PUBLIC_PRICE_SOURCES;

  if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nAll checks passed");
}
run();
