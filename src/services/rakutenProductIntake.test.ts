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
import { mapCoupangProduct, buildProviderBatch, UNKNOWN } from "../domain/providerListing";
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
{
  const jp = buildRakutenProductBatch(parse([prod()]), GRANTED);
  const kor = buildProviderBatch("coupang", [{ productId: 9001, productName: "소니 ILCE-7M5 바디", productPrice: 3000000, productUrl: "https://example.invalid/c1" }], (x) => mapCoupangProduct(x, GRANTED));
  const res = runIntake([jp, kor], { catalog });
  const jpOut = res.outcomes.find((o) => o.key === "rakuten_product|p1")!;
  check("productNo hits the catalog code (Japanese maker name resolved)", [jpOut.modelSource, jpOut.variantId], ["catalog_code", "v-sony"]);
  check("JP product row + KR listing form ONE comparable review batch", [res.stats.comparableGroups, res.reviewBatches.length, res.reviewBatches[0]?.regions], [1, 1, ["JP", "KR"]]);
  check("first mapping is never auto-approved: every listing is REVIEW, none AUTO_REFRESH", [res.stats.actions.REVIEW, res.stats.actions.AUTO_REFRESH], [2, 0]);

  const fw = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p6", productNo: "ＩＬＣＥ－７Ｍ５" })]), GRANTED), kor], { catalog });
  check("full-width productNo links to the catalog variant end-to-end", [fw.outcomes.find((o) => o.key === "rakuten_product|p6")!.modelSource, fw.outcomes.find((o) => o.key === "rakuten_product|p6")!.variantId], ["catalog_code", "v-sony"]);
  const suffixed = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p7", productNo: "ILCE-7M5/B", productName: "ソニー デジタル一眼カメラ ボディ" })]), GRANTED), kor], { catalog });
  check("colour-suffixed code is NOT auto-linked (stays a weak new-product candidate)", [suffixed.outcomes.find((o) => o.key === "rakuten_product|p7")!.variantId, suffixed.outcomes.find((o) => o.key === "rakuten_product|p7")!.modelSource], [null, "explicit_code"]);

  const noRights = runIntake([buildRakutenProductBatch(parse([prod()])), kor], { catalog });
  check("usage rights unverified -> JP row HOLD (rights_unverified), no review batch", [noRights.outcomes.find((o) => o.key === "rakuten_product|p1")!.action, noRights.outcomes.find((o) => o.key === "rakuten_product|p1")!.reasons[0], noRights.reviewBatches.length], ["HOLD", "rights_unverified", 0]);

  const denied = runIntake([jp, kor], { catalog, providerRights: { rakuten_product: "denied" } });
  check("providerRights=denied overrides -> AUTO_DROP rights_denied", denied.outcomes.find((o) => o.key === "rakuten_product|p1")!.reasons[0], "rights_denied");

  const failed = runIntake([{ provider: "rakuten_product", ok: false, error: "http_503" }, kor], { catalog, previousSnapshot: res.snapshot });
  check("Rakuten failure keeps previous JP row (carried over), not sold out/dropped", [failed.outcomes.find((o) => o.key === "rakuten_product|p1")!.carriedOver, failed.outcomes.find((o) => o.key === "rakuten_product|p1")!.action], [true, "REVIEW"]);

  // an itemCode and a productId that happen to be equal must stay separate listings
  const approvedItem = runIntake([jp], { catalog, approved: [{ provider: "rakuten", externalId: "p1", variantId: "v-sony", region: "JP" }] });
  check("approved item-level 'rakuten|p1' is NOT touched by product-level 'rakuten_product|p1'", approvedItem.outcomes.find((o) => o.key === "rakuten_product|p1")!.action === "AUTO_REFRESH", false);

  const sibling = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p3", productNo: "ILCE-7M5W", productName: "ソニー ILCE-7M5W ボディ" })]), GRANTED), kor], { catalog });
  check("suffix-extended code (ILCE-7M5W) is not linked to catalog ILCE-7M5", sibling.outcomes.find((o) => o.key === "rakuten_product|p3")!.variantId, null);

  const used = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p4", productName: "【中古】ソニー ILCE-7M5 ボディ" })]), GRANTED)], { catalog });
  check("used product row dropped by the existing negative filter", used.outcomes[0].action, "AUTO_DROP");

  const noPrice = runIntake([buildRakutenProductBatch(parse([prod({ productId: "p5", salesMinPrice: "" })]), GRANTED), kor], { catalog });
  check("emptied price -> HOLD no_price (not review, not drop)", [noPrice.outcomes.find((o) => o.key === "rakuten_product|p5")!.action, noPrice.outcomes.find((o) => o.key === "rakuten_product|p5")!.reasons[0]], ["HOLD", "no_price"]);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
