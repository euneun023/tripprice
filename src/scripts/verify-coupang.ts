/**
 * First real-world verification of Coupang Partners (affiliate) Open API -
 * NOT the WING seller API. Tests the same product used for the Rakuten PoC
 * (Sony WF-1000XM5) so the two sources are directly comparable.
 *
 * No mock data. Prints the raw response so field presence (especially
 * productPrice) is confirmed from evidence, not assumption.
 */
import "dotenv/config";
import { searchCoupangProduct } from "../sources/coupang";
import { pickItemByTerms } from "../match";

const accessKey = process.env.COUPANG_PARTNERS_ACCESS_KEY;
const secretKey = process.env.COUPANG_PARTNERS_SECRET_KEY;
if (!accessKey || !secretKey) {
  console.error(
    "Missing COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY in .env",
  );
  process.exit(1);
}

const keyword = "소니 WF-1000XM5";

async function main() {
  console.log("=== Step 1: Coupang Partners product search - live call ===");
  console.log(`keyword: "${keyword}"`);

  const result = await searchCoupangProduct({ accessKey: accessKey!, secretKey: secretKey! }, keyword, 10);

  console.log(`request url: ${result.requestUrl}`);
  console.log(`HTTP status: ${result.status}`);
  console.log(`rate-limit related response headers:`, result.rateLimitHeaders);
  console.log(`items returned: ${result.items.length}`);

  console.log("\n--- raw response (truncated) ---");
  console.log(JSON.stringify(result.rawResponse, null, 2).slice(0, 3000));

  console.log("\n--- full candidate list ---");
  result.items.forEach((it, idx) => {
    console.log(
      `  [${idx}] rank=${it.rank} id=${it.productId} rocket=${it.isRocket} ¥${it.productPrice} - ${it.productName}`,
    );
  });

  const { matched, excluded } = pickItemByTerms(
    result.items,
    {
      requiredTerms: ["WF-1000XM5"],
      excludeTerms: ["케이스", "커버", "이어팁", "이어피스", "젤리팁", "보호필름", "스트랩", "충전"],
    },
    (i) => i.productName,
  );

  console.log(`\n>> NAME-TERM MATCH: ${matched ? "FOUND" : "NOT FOUND"}`);
  if (matched) {
    console.log({
      productId: matched.productId,
      productName: matched.productName,
      productPrice: matched.productPrice,
      productUrl: matched.productUrl,
      productImage: matched.productImage,
      isRocket: matched.isRocket,
      isFreeShipping: matched.isFreeShipping,
    });
  }
  console.log(`>> excluded by excludeTerms: ${excluded.length}`);
  excluded.forEach((it: any) =>
    console.log(`   - id=${it.productId} ¥${it.productPrice} - ${it.productName}`),
  );
}

main().catch((err) => {
  console.error("\nLive verification FAILED:");
  console.error(err);
  process.exit(1);
});
