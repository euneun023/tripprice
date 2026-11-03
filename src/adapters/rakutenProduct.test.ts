/**
 * Unit checks for the Rakuten Product Search adapter's PURE parts - URL
 * contract, null-safe parsing, and the two decision helpers. No test runner
 * is configured in this repo (same plain-assertion convention as
 * adapters/rakuten.test.ts) - run directly:
 *   npx tsx src/adapters/rakutenProduct.test.ts
 * Exits non-zero on any failure. NEVER hits the real Rakuten API - there is
 * no fetch() call anywhere in this file.
 *
 * What these checks can and cannot prove: they pin down OUR behaviour given
 * a response shape. They cannot validate the field names themselves against
 * Rakuten (see the adapter header's evidence grade) - that needs one live
 * call via scripts/verify-rakuten-product.ts.
 */
import {
  buildProductSearchUrl,
  parseProductSearchResponse,
  extractMatchKey,
  summarizeJpOffers,
  RakutenProductApiError,
  RAKUTEN_PRODUCT_MAX_HITS,
  RAKUTEN_PRODUCT_MAX_PAGE,
  RAKUTEN_PRODUCT_MAX_REACHABLE_PER_KEY,
  type RakutenProduct,
} from "./rakutenProduct";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`,
  );
  if (!pass) failures++;
}

function checkThrows(name: string, fn: () => unknown, expectedFragment: string) {
  let message: string | null = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof RakutenProductApiError)) {
      console.log(`FAIL ${name} - threw ${err instanceof Error ? err.name : typeof err}, expected RakutenProductApiError`);
      failures++;
      return;
    }
  }
  if (message === null) {
    console.log(`FAIL ${name} - did not throw`);
    failures++;
    return;
  }
  const pass = message.includes(expectedFragment);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - message ${JSON.stringify(message)} lacked ${JSON.stringify(expectedFragment)}`}`);
  if (!pass) failures++;
}

const creds = { applicationId: "APP", accessKey: "SECRET" };

function main() {
  // ---- URL contract: exactly one search key ----
  checkThrows("no search key -> rejected before any request", () => buildProductSearchUrl({ ...creds }), "required, got none");
  checkThrows(
    "two search keys -> rejected (JAN not combinable)",
    () => buildProductSearchUrl({ ...creds, keyword: "Sony", productCode: "4548736150362" }),
    "exactly one search key allowed",
  );
  checkThrows(
    "empty-string keyword counts as absent, not as a key",
    () => buildProductSearchUrl({ ...creds, keyword: "   " }),
    "required, got none",
  );

  // genreId=0 would be falsy but is a legitimate value shape - make sure the
  // presence test keys off undefined/null/blank, not truthiness.
  const genreZero = new URL(buildProductSearchUrl({ ...creds, genreId: 0 }));
  check("genreId=0 is treated as present", genreZero.searchParams.get("genreId"), "0");

  const url = new URL(buildProductSearchUrl({ ...creds, keyword: "ILCE-7M5", hits: 30, page: 2 }));
  check("endpoint host", url.host, "openapi.rakuten.co.jp");
  check("endpoint path is ichibaproduct, not ichibams", url.pathname, "/ichibaproduct/api/Product/Search/20250801");
  check("applicationId sent", url.searchParams.get("applicationId"), "APP");
  check("accessKey sent", url.searchParams.get("accessKey"), "SECRET");
  check("formatVersion=2 (flattened arrays)", url.searchParams.get("formatVersion"), "2");
  check("hits passthrough", url.searchParams.get("hits"), "30");
  check("page passthrough", url.searchParams.get("page"), "2");
  check("keyword passthrough", url.searchParams.get("keyword"), "ILCE-7M5");
  check("no stray search keys added", url.searchParams.get("productCode"), null);

  const defaults = new URL(buildProductSearchUrl({ ...creds, keyword: "x" }));
  check("default hits = documented max 30", defaults.searchParams.get("hits"), String(RAKUTEN_PRODUCT_MAX_HITS));
  check("default page = 1", defaults.searchParams.get("page"), "1");

  // ---- URL contract: documented bounds, enforced locally ----
  checkThrows("hits=31 rejected", () => buildProductSearchUrl({ ...creds, keyword: "x", hits: 31 }), "out of documented range 1..30");
  checkThrows("hits=0 rejected", () => buildProductSearchUrl({ ...creds, keyword: "x", hits: 0 }), "out of documented range 1..30");
  checkThrows("non-integer hits rejected", () => buildProductSearchUrl({ ...creds, keyword: "x", hits: 2.5 }), "out of documented range 1..30");
  checkThrows("page=101 rejected", () => buildProductSearchUrl({ ...creds, keyword: "x", page: 101 }), "out of documented range 1..100");
  check("paging ceiling constant", RAKUTEN_PRODUCT_MAX_REACHABLE_PER_KEY, RAKUTEN_PRODUCT_MAX_HITS * RAKUTEN_PRODUCT_MAX_PAGE);

  const withExtras = new URL(buildProductSearchUrl({ ...creds, genreId: 564500, sort: "standard", elements: ["productId", "productNo"] }));
  check("sort passthrough (not validated locally)", withExtras.searchParams.get("sort"), "standard");
  check("elements joined with comma", withExtras.searchParams.get("elements"), "productId,productNo");

  // ---- Parsing: formatVersion=2 flat shape ----
  const v2 = parseProductSearchResponse({
    count: 1234,
    page: 1,
    pageCount: 100,
    hits: 2,
    Products: [
      {
        productId: "abc123",
        productName: "SONY ILCE-7M5 ボディ",
        productNo: "ILCE-7M5",
        makerName: "ソニー",
        productCode: "4548736150362",
        genreId: "564500",
        salesMinPrice: 398000,
        salesMaxPrice: 455000,
        averagePrice: 420000,
        salesItemCount: 37,
        itemCount: "",
        minPrice: "",
        productUrlPC: "https://product.rakuten.co.jp/product/abc123/",
        mediumImageUrl: "https://image.example/med.jpg",
      },
    ],
  });
  check("v2 parsed one product", v2.products.length, 1);
  check("productNo extracted", v2.products[0].productNo, "ILCE-7M5");
  check("makerName extracted", v2.products[0].makerName, "ソニー");
  check("JAN extracted", v2.products[0].productCode, "4548736150362");
  check("salesMinPrice numeric", v2.products[0].salesMinPrice, 398000);
  check("salesItemCount numeric", v2.products[0].salesItemCount, 37);
  check('emptied itemCount ("") -> null, never 0', v2.products[0].itemCount, null);
  check('emptied minPrice ("") -> null, never 0', v2.products[0].minPrice, null);
  check("absent maxPrice -> null", v2.products[0].maxPrice, null);
  check("pagination envelope parsed", [v2.count, v2.page, v2.pageCount, v2.hits], [1234, 1, 100, 2]);

  // ---- Parsing: legacy nested shape still understood ----
  const v1 = parseProductSearchResponse({
    Products: [{ Product: { productId: "nested1", productNo: "WH-1000XM6", makerName: "ソニー", salesMinPrice: 49800 } }],
  });
  check("nested Product shape parsed", v1.products[0].productId, "nested1");
  check("nested productNo parsed", v1.products[0].productNo, "WH-1000XM6");

  // ---- Parsing: hostile/empty bodies never throw ----
  check("null body -> zero products", parseProductSearchResponse(null).products.length, 0);
  check("missing Products key -> zero products", parseProductSearchResponse({ count: 0 }).products.length, 0);
  check("Products not an array -> zero products", parseProductSearchResponse({ Products: "nope" }).products.length, 0);
  const junk = parseProductSearchResponse({ Products: [null, { productNo: 42, salesMinPrice: "not-a-number" }] });
  check("null row tolerated", junk.products.length, 2);
  check("numeric productNo stringified", junk.products[1].productNo, "42");
  check("unparseable price -> null, never NaN", junk.products[1].salesMinPrice, null);

  // A real 0 must survive: "zero purchasable listings" is information.
  const zeroStock = parseProductSearchResponse({ Products: [{ salesItemCount: 0, salesMinPrice: 0 }] });
  check("salesItemCount 0 preserved (not null)", zeroStock.products[0].salesItemCount, 0);
  check("salesMinPrice 0 preserved (not null)", zeroStock.products[0].salesMinPrice, 0);

  // ---- extractMatchKey: strict, never falls back to the product name ----
  const full: RakutenProduct = {
    productId: "p1",
    productName: "SONY ILCE-7M5",
    productNo: "ILCE-7M5",
    makerName: "ソニー",
    productCode: "4548736150362",
    genreId: "1",
    salesMinPrice: 1,
    salesMaxPrice: null,
    minPrice: null,
    maxPrice: null,
    averagePrice: null,
    itemCount: null,
    salesItemCount: 3,
    productUrlPC: null,
    mediumImageUrl: null,
  };
  check("match key from productNo + makerName", extractMatchKey(full), {
    brand: "ソニー",
    modelNo: "ILCE-7M5",
    jan: "4548736150362",
  });
  check("no productNo -> no match key (name is NOT a fallback)", extractMatchKey({ ...full, productNo: null }), null);
  check("no makerName -> no match key", extractMatchKey({ ...full, makerName: null }), null);
  check("missing JAN still yields a key, with jan=null", extractMatchKey({ ...full, productCode: null })?.jan, null);

  // ---- summarizeJpOffers: unknown must never masquerade as a count ----
  check("known price + count -> comparable", summarizeJpOffers(full), {
    minPrice: 1,
    purchasableListingCount: 3,
    comparable: true,
  });
  check("null count -> not comparable, count stays null (not 0/1)", summarizeJpOffers({ ...full, salesItemCount: null }), {
    minPrice: 1,
    purchasableListingCount: null,
    comparable: false,
  });
  check("null price -> not comparable", summarizeJpOffers({ ...full, salesMinPrice: null }), {
    minPrice: null,
    purchasableListingCount: 3,
    comparable: false,
  });
  check("zero purchasable listings -> not comparable", summarizeJpOffers({ ...full, salesItemCount: 0 }), {
    minPrice: 1,
    purchasableListingCount: 0,
    comparable: false,
  });

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

main();
