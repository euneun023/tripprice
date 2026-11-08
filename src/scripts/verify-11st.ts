/**
 * First real-world verification of the 11st Open API ProductSearch
 * endpoint. No prior integration in this repo and no confirmed response
 * schema (see src/adapters/elevenst.ts header) - this script exists only
 * to make ONE live call, print the raw response, and report whether the
 * six fields a listing needs (name, product code, seller, price, discount
 * price, product URL) are actually present, from evidence, not assumption.
 *
 * Deliberately does nothing else: no DB writes, no listing creation, no
 * retries. ELEVENST_API_KEY must come from the environment - never
 * hardcode it here, and never log process.env.ELEVENST_API_KEY itself
 * (only the redacted request URL the adapter returns).
 */
import "dotenv/config";
import { searchElevenstProduct, ElevenstApiError } from "../adapters/elevenst";

const apiKey = process.env.ELEVENST_API_KEY;
if (!apiKey) {
  console.error(
    "Missing ELEVENST_API_KEY.\n" +
      "Set it as a local environment variable before running this script, e.g.:\n" +
      "  echo 'ELEVENST_API_KEY=...' >> .env   (repo-root .env is already gitignored)\n" +
      "or for a single run:\n" +
      "  ELEVENST_API_KEY=... npx tsx src/scripts/verify-11st.ts\n" +
      "Never paste the key into chat or commit it - .env is the local-only store this repo already uses for Rakuten/Coupang keys.",
  );
  process.exit(1);
}

const keyword = "Sony FE 24mm F1.4 GM";

async function main() {
  console.log("=== 11st Open API ProductSearch - single live call ===");
  console.log(`keyword: "${keyword}"`);

  const result = await searchElevenstProduct({ apiKey: apiKey! }, keyword, 1);

  // Never print `apiKey`/process.env.ELEVENST_API_KEY itself anywhere below -
  // only the already-redacted fields the adapter returns.
  console.log(`request url (key redacted): ${result.requestUrlRedacted}`);
  console.log(`HTTP status: ${result.status}`);
  console.log(`11st TotalCount (search total, not this page): ${result.totalCount ?? "(none found)"}`);
  console.log(`11st result code (best-effort, unconfirmed envelope - see adapter header): ${result.resultCode ?? "(none found)"}`);
  console.log(`11st result message: ${result.resultMessage ?? "(none found)"}`);
  console.log(`products returned on this page: ${result.products.length}`);

  console.log("\n--- raw response, key redacted (truncated to 3000 chars) ---");
  console.log(result.rawResponseTextRedacted.slice(0, 3000));

  if (result.products.length === 0) {
    console.log("\n>> No <Product> nodes found in the response - nothing to check field presence on.");
    return;
  }

  console.log("\n--- first product, parsed fields ---");
  console.log(JSON.stringify(result.products[0], null, 2));

  const required: Array<keyof typeof result.products[0]> = [
    "productName",
    "productCode",
    "seller",
    "productPrice",
    "salePrice",
    "detailPageUrl",
  ];
  const missing = required.filter((k) => !result.products[0][k]);
  console.log(
    missing.length === 0
      ? "\n>> All 6 required fields present (상품명/상품코드/판매자/가격/할인가격/상품URL)."
      : `\n>> Missing field(s): ${missing.join(", ")}`,
  );
}

main().catch((err) => {
  if (err instanceof ElevenstApiError) {
    console.error(`\n11st ProductSearch call FAILED: HTTP ${err.status}`);
    console.error(err.message);
    console.error("body (already redacted):", typeof err.body === "string" ? err.body.slice(0, 2000) : err.body);
  } else {
    console.error("\nLive verification FAILED:");
    console.error(err);
  }
  process.exit(1);
});
