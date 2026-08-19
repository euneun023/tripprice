/**
 * First real-world verification: fetch Garmin Descent Mk3s from Rakuten's
 * official Item Search API and confirm we can carry it through
 * canonical product -> price_source -> offer -> KRW conversion.
 *
 * No mock data. If the live call fails, this script fails loudly.
 *
 * Note: the itemCode exact-lookup param ("shopCode:itemUrl") was rejected by
 * the current (20260701) API version as "itemCode is not valid" - confirmed
 * by live testing, not assumed. Keyword search + SKU matching works instead,
 * so that's the approach used here. This matching step (src/match.ts) is
 * generic, not diving-specific, so it carries over to other categories.
 */
import "dotenv/config";
import { searchRakutenItem } from "../sources/rakuten";
import { pickItemBySku } from "../match";
import { getFxRate } from "../exchangeRate";
import type { CanonicalProduct, PriceSource, Offer } from "../types";

const applicationId = process.env.applicationId;
const accessKey = process.env.accessKey;
if (!applicationId || !accessKey) {
  console.error(
    "Missing applicationId or accessKey in .env (expected keys: applicationId=..., accessKey=...)",
  );
  process.exit(1);
}

// --- canonical product (category is data, not code branching) ---
const product: CanonicalProduct = {
  id: "garmin-descent-mk3s-010-02857-02",
  category: "diving",
  brand: "Garmin",
  officialName: "Garmin Descent Mk3s (Steel/Fog Gray, 43mm)",
  modelSku: "010-02857-02",
};

const searchKeyword = product.officialName.replace(/\(.*\)/, "").trim(); // "Garmin Descent Mk3s"

async function main() {
  console.log("=== Step 1: Rakuten Item Search API live call ===");
  console.log(`product: ${product.officialName} (${product.modelSku})`);
  console.log(`keyword: "${searchKeyword}"`);

  const result = await searchRakutenItem({
    applicationId: applicationId!,
    accessKey: accessKey!,
    keyword: searchKeyword,
    hits: 10,
  });

  console.log(`request url: ${result.requestUrl}`);
  console.log(`items returned: ${result.items.length}`);

  const item = pickItemBySku(result.items, product.modelSku!, (i) => i.itemName);

  if (!item) {
    console.error(
      `\nNo item among the ${result.items.length} results matched SKU "${product.modelSku}". Stopping - not fabricating an offer.`,
    );
    console.error(
      "Candidate item names:",
      result.items.map((i) => i.itemName),
    );
    process.exit(1);
  }

  console.log("\n=== Step 2: matched item / field mapping check ===");
  console.log({
    itemName: item.itemName,
    itemPrice: item.itemPrice,
    itemUrl: item.itemUrl,
    shopName: item.shopName,
    shopCode: item.shopCode,
    availability: item.availability,
    affiliateRate: (item as any).affiliateRate,
  });

  // price_source resolved from the live match, not assumed ahead of time
  const priceSource: PriceSource = {
    id: `rakuten-${item.shopCode}`,
    productId: product.id,
    region: "JP",
    sourceName: `Rakuten - ${item.shopName} (${item.shopCode})`,
    sourceUrl: item.itemUrl,
    updateMethod: "api",
    automationStatus: "auto",
    monetizationStatus: "region_or_approval_required", // affiliateId issued, but KR-traffic commission eligibility not yet confirmed
  };

  console.log("\n=== Step 3: KRW conversion ===");
  const fx = await getFxRate("JPY", "KRW");
  console.log(`fx rate JPY->KRW: ${fx.rate} (fetched ${fx.fetchedAt})`);

  const now = new Date().toISOString();
  const offer: Offer = {
    id: `${priceSource.id}-${Date.now()}`,
    priceSourceId: priceSource.id,
    price: item.itemPrice,
    currency: "JPY", // Item Search API does not return a currency field; JP marketplace is JPY-only
    krwPrice: Math.round(item.itemPrice * fx.rate),
    fxRateUsed: fx.rate,
    inStock: item.availability === 1,
    checkedAt: now,
    lastSuccessAt: now,
    staleAfterHours: 24,
    confidence: "verified",
    raw: item,
  };

  console.log("\n=== Step 4: canonical product + price_source + offer linked ===");
  console.log(
    JSON.stringify(
      { product, priceSource, offer: { ...offer, raw: undefined } },
      null,
      2,
    ),
  );

  console.log(
    `\n=== DONE: live Rakuten price ¥${item.itemPrice.toLocaleString()} -> KRW ${offer.krwPrice!.toLocaleString()}원 ===`,
  );
}

main().catch((err) => {
  console.error("\nLive verification FAILED:");
  console.error(err);
  process.exit(1);
});
