/**
 * Integration checks for the A->B bridge (rakutenProductIntake.ts): Rakuten
 * Product Search rows (adapters/rakutenProduct.ts) flowing through the
 * multi-provider intake pipeline (listingIntakeService.ts). No test runner is
 * configured in this repo - run directly:
 *   npx tsx src/services/rakutenProductIntake.test.ts
 * Exits non-zero on any failure. Pure in-memory: no network, DB or files.
 *
 * Every product/maker/price below is FABRICATED test data (fake brand
 * "Aquora"), except the Japanese brand-name spellings, which are the same
 * ones BRAND_SYNONYMS already carries.
 */
import { parseProductSearchResponse } from "../adapters/rakutenProduct";
import { mapCoupangProduct, mapRakutenItem, buildProviderBatch, UNKNOWN } from "../domain/providerListing";
import { runIntake, type CatalogEntry } from "./listingIntakeService";
import { RAKUTEN_PRODUCT_PROVIDER, buildRakutenProductBatch, mapRakutenProduct } from "./rakutenProductIntake";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const GRANTED = { usageRights: "granted" as const, fetchedAt: "2026-11-04T00:00:00Z" };
const catalog: CatalogEntry[] = [{ variantId: "v-sony", productType: "camera", brand: "Sony", name: "Sony ILCE-7M5 body", modelSku: "ILCE-7M5" }];

/** a Product Search response body in the documented formatVersion=2 shape, parsed with A's own parser */
const parse = (products: Array<Record<string, unknown>>) => parseProductSearchResponse({ Products: products, count: products.length, page: 1, pageCount: 1, hits: products.length }).products;
const prod = (over: Record<string, unknown> = {}) => ({
  productId: "p1", productName: "ソニー ILCE-7M5 ボディ", productNo: "ILCE-7M5", makerName: "ソニー",
  salesMinPrice: 300000, salesItemCount: 4, productUrlPC: "https://example.invalid/p1", ...over,
});
/** seller-level Rakuten Ichiba Item Search row (one shop's own listing) - the comparable kind */
const shopItem = (code: string, shop: string, price: number) => buildProviderBatch("rakuten", [{ itemCode: code, itemName: "ソニー ILCE-7M5 ボディ", itemPrice: price, shopName: shop, availability: 1, itemUrl: `https://item.rakuten.example/${code}` }], (x) => mapRakutenItem(x, GRANTED));
const kr = (over: Record<string, unknown> = {}) => mapCoupangProduct({ productId: 9001, productName: "소니 ILCE-7M5 바디", productPrice: 3000000, productUrl: "https://example.invalid/c1", ...over }, GRANTED);

// ---------------- field mapping ----------------
{
  const r = mapRakutenProduct(parse([prod()])[0], GRANTED);
  if (!r.ok) throw new Error(r.error);
  const l = r.listing;
  check("provider is rakuten_product (never 'rakuten')", [l.provider, RAKUTEN_PRODUCT_PROVIDER], ["rakuten_product", "rakuten_product"]);
  check("externalId=productId, type labelled", [l.externalId, l.externalIdType], ["p1", "rakuten_product_id"]);
  check("productNo->modelNumber, makerName->manufacturer", [l.modelNumber, l.manufacturer], ["ILCE-7M5", "ソニー"]);
  check("JP/JPY and price=salesMinPrice", [l.region, l.currency, l.price], ["JP", "JPY", 300000]);
  check("seller stays UNKNOWN (product row aggregates many shops)", l.seller, UNKNOWN);
  check("price is labelled a roll-up and there is no purchase URL", [l.priceBasis, l.sourceUrl], ["product_aggregate", null]);
  check("listings>0 -> in_stock", l.availability, "in_stock");
  check("usageRights is not granted unless the caller says so", (mapRakutenProduct(parse([prod()])[0]) as { listing: { usageRights: string } }).listing.usageRights, UNKNOWN);
}
check("salesItemCount 0 -> out_of_stock", (mapRakutenProduct(parse([prod({ salesItemCount: 0 })])[0], GRANTED) as { listing: { availability: string } }).listing.availability, "out_of_stock");
check("salesItemCount null -> UNKNOWN (absence is not sold out)", (mapRakutenProduct(parse([prod({ salesItemCount: "" })])[0], GRANTED) as { listing: { availability: string } }).listing.availability, UNKNOWN);
check("no productNo/maker -> UNKNOWN, not guessed from the name", (() => { const l = (mapRakutenProduct(parse([prod({ productNo: "", makerName: null })])[0], GRANTED) as { listing: { modelNumber: string; manufacturer: string } }).listing; return [l.modelNumber, l.manufacturer]; })(), [UNKNOWN, UNKNOWN]);
check("salesMinPrice emptied by Rakuten -> price null, still a valid row", (mapRakutenProduct(parse([prod({ salesMinPrice: "" })])[0], GRANTED) as { ok: boolean; listing: { price: number | null } }).listing.price, null);
check("missing productId rejected", mapRakutenProduct(parse([prod({ productId: null })])[0]).ok, false);
check("missing productName rejected", mapRakutenProduct(parse([prod({ productName: "" })])[0]).ok, false);

check("full-width productNo is folded (NFKC) so it can link to the catalog code", (mapRakutenProduct(parse([prod({ productNo: "ＩＬＣＥ－７Ｍ５" })])[0], GRANTED) as { listing: { modelNumber: string } }).listing.modelNumber, "ILCE-7M5");
check("NFKC folding does NOT strip a suffix or hyphen (suffix stays a different SKU)", (mapRakutenProduct(parse([prod({ productNo: "ＩＬＣＥ－７Ｍ５／Ｂ" })])[0], GRANTED) as { listing: { modelNumber: string } }).listing.modelNumber, "ILCE-7M5/B");

// ---------------- batch behaviour ----------------
{
  const b = buildRakutenProductBatch(parse([prod(), prod({ productId: null })]), GRANTED);
  check("one malformed row counted, valid row kept", b.ok ? [b.listings.length, b.malformed] : "failed", [1, 1]);
  const allBad = buildRakutenProductBatch(parse([prod({ productId: null }), prod({ productName: null })]), GRANTED);
  check("all rows malformed -> failed batch (format change), not '0 results'", allBad.ok, false);
  const emptyPriceOnly = buildRakutenProductBatch(parse([prod({ salesMinPrice: "" }), prod({ productId: "p2", salesMinPrice: null })]), GRANTED);
  check("rows with emptied price do NOT fail the batch", emptyPriceOnly.ok, true);
}

// ---------------- through the real pipeline ----------------
const key = (r: ReturnType<typeof runIntake>, k: string) => r.outcomes.find((o) => o.key === k)!;
{
  const jp = buildRakutenProductBatch(parse([prod()]), GRANTED);
  const kor = buildProviderBatch("coupang", [{ productId: 9001, productName: "소니 ILCE-7M5 바디", productPrice: 3000000, productUrl: "https://example.invalid/c1" }], (x) => mapCoupangProduct(x, GRANTED));
  const res = runIntake([jp, kor], { catalog });
  const jpOut = key(res, "rakuten_product|p1");

  // --- product roll-up vs seller listing ---
  check("productNo hits the catalog code (Japanese maker name resolved)", [jpOut.modelSource, jpOut.variantId], ["catalog_code", "v-sony"]);
  check("Rakuten PRODUCT roll-up row is HOLD (discovery only): no review batch, no comparable group", [jpOut.action, jpOut.reasons[0].split(":")[0], res.reviewBatches.length, res.stats.comparableGroups], ["HOLD", "product_level_price_only", 0, 0]);
  check("roll-up price is NOT counted as a seller price: no REVIEW, no AUTO_REFRESH", [res.stats.actions.REVIEW, res.stats.actions.AUTO_REFRESH], [0, 0]);
  check("the lone KR listing stays HOLD (single region)", key(res, "coupang|9001").reasons[0], "single_region:KR");

  // --- real comparison needs SELLER-level rows: two Rakuten shops + Coupang ---
  const two = runIntake([shopItem("a:1", "shopA", 300000), shopItem("b:2", "shopB", 310000), kor, jp], { catalog });
  check("2 Rakuten shops + Coupang -> ONE comparable review batch of 3 seller listings (roll-up excluded)", [two.stats.comparableGroups, two.reviewBatches.length, two.reviewBatches[0]?.listingKeys, two.reviewBatches[0]?.regions], [1, 1, ["coupang|9001", "rakuten|a:1", "rakuten|b:2"], ["JP", "KR"]]);
  check("each shop keeps its own price/seller (not merged)", [key(two, "rakuten|a:1").listing.price, key(two, "rakuten|a:1").listing.seller, key(two, "rakuten|b:2").listing.price, key(two, "rakuten|b:2").listing.seller], [300000, "shopA", 310000, "shopB"]);
  check("first mapping is never auto-approved: REVIEW only, AUTO_REFRESH 0", [two.stats.actions.REVIEW, two.stats.actions.AUTO_REFRESH], [3, 0]);
  check("batch tells the reviewer the multiple-shop situation", two.reviewBatches[0].reasons.includes("multiple_offers_same_provider_region: choose/keep per market"), true);
  check("Coupang's missing stock is flagged, not silently 'available'", key(two, "coupang|9001").reasons.some((r) => r.startsWith("availability_unconfirmed")), true);

  // --- rights ---
  const noRights = runIntake([buildRakutenProductBatch(parse([prod()])), buildProviderBatch("rakuten", [{ itemCode: "a:1", itemName: "ソニー ILCE-7M5 ボディ", itemPrice: 300000, shopName: "shopA", availability: 1 }], (x) => mapRakutenItem(x)), kor], { catalog });
  check("rights unverified -> roll-up AND seller rows are HOLD rights_unverified; nothing reviewable", [key(noRights, "rakuten_product|p1").reasons[0], key(noRights, "rakuten|a:1").reasons[0], noRights.reviewBatches.length], ["rights_unverified", "rights_unverified", 0]);
  const denied = runIntake([jp, kor], { catalog, providerRights: { rakuten_product: "denied" } });
  check("providerRights=denied overrides -> AUTO_DROP rights_denied", key(denied, "rakuten_product|p1").reasons[0], "rights_denied");

  // --- provider failure / approved vs new ---
  const base3 = runIntake([shopItem("a:1", "shopA", 300000), kor], { catalog });
  const failed = runIntake([{ provider: "rakuten", ok: false, error: "http_503" }, kor], { catalog, previousSnapshot: base3.snapshot });
  check("Rakuten fetch failure keeps the previous seller row (carried over), not sold out/dropped", [key(failed, "rakuten|a:1").carriedOver, key(failed, "rakuten|a:1").action], [true, "REVIEW"]);
  const approved = runIntake([shopItem("a:1", "shopA", 305000), shopItem("b:2", "shopB", 310000), kor], { catalog, approved: [{ provider: "rakuten", externalId: "a:1", variantId: "v-sony", region: "JP" }] });
  check("approved shopA -> AUTO_REFRESH (price only); NEW shopB is REVIEW flagged duplicate_market_offer, never auto-approved", [key(approved, "rakuten|a:1").action, key(approved, "rakuten|b:2").action, key(approved, "rakuten|b:2").reasons.some((r) => r.startsWith("duplicate_market_offer"))], ["AUTO_REFRESH", "REVIEW", true]);
  // an itemCode and a productId that happen to be equal must stay separate listings
  const approvedItem = runIntake([jp], { catalog, approved: [{ provider: "rakuten", externalId: "p1", variantId: "v-sony", region: "JP" }] });
  check("approved item-level 'rakuten|p1' is NOT touched by product-level 'rakuten_product|p1'", key(approvedItem, "rakuten_product|p1").action === "AUTO_REFRESH", false);

  // --- identity edge cases on roll-up rows (still HOLD, but identification must stay correct) ---
  const sibling = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p3", productNo: "ILCE-7M5W", productName: "ソニー ILCE-7M5W ボディ" })]), GRANTED), kor], { catalog });
  check("suffix-extended code (ILCE-7M5W) is not linked to catalog ILCE-7M5", key(sibling, "rakuten_product|p3").variantId, null);
  const fw = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p6", productNo: "ＩＬＣＥ－７Ｍ５" })]), GRANTED), kor], { catalog });
  check("full-width productNo links to the catalog variant end-to-end", [key(fw, "rakuten_product|p6").modelSource, key(fw, "rakuten_product|p6").variantId], ["catalog_code", "v-sony"]);
  const suffixed = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p7", productNo: "ILCE-7M5/B", productName: "ソニー デジタル一眼カメラ ボディ" })]), GRANTED), kor], { catalog });
  check("colour-suffixed code is NOT auto-linked (stays a weak new-product candidate)", [key(suffixed, "rakuten_product|p7").variantId, key(suffixed, "rakuten_product|p7").modelSource], [null, "explicit_code"]);
  const used = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p4", productName: "【中古】ソニー ILCE-7M5 ボディ" })]), GRANTED)], { catalog });
  check("used roll-up row is dropped by the existing negative filter", used.outcomes[0].action, "AUTO_DROP");
  const noPrice = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p5", salesMinPrice: "" })]), GRANTED), kor], { catalog });
  check("emptied roll-up price stays HOLD (never review/drop)", key(noPrice, "rakuten_product|p5").action, "HOLD");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
