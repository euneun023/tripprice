/**
 * Runs the SAME engine (searchRakutenItem + pickItemByTerms) used for the
 * Garmin verification against the remaining 4 diving products. Category-
 * agnostic on purpose - this file has no diving-specific branching, all
 * per-product detail lives in src/products.ts.
 *
 * Live calls only. Prints raw candidates so existence-vs-match-failure
 * classification can be made from real evidence, not assumption.
 */
import "dotenv/config";
import { searchRakutenItem } from "../sources/rakuten";
import { pickItemByTerms, normalize } from "../match";
import { divingBatch1 } from "../products";

const applicationId = process.env.applicationId;
const accessKey = process.env.accessKey;
if (!applicationId || !accessKey) {
  console.error("Missing applicationId/accessKey in .env");
  process.exit(1);
}

// Garmin already verified in verify-rakuten.ts; test the other 4 here.
const targets = divingBatch1.filter((t) => t.product.id !== "garmin-descent-mk3s-010-02857-02");

async function main() {
  for (const target of targets) {
    console.log("\n" + "=".repeat(70));
    console.log(`PRODUCT: ${target.product.officialName}`);
    console.log(`modelSku (known): ${target.product.modelSku ?? "(none confirmed)"}`);
    console.log(`search keyword  : "${target.searchKeyword}"`);
    console.log(`match terms     : [${target.matchTerms.join(", ")}]`);

    const result = await searchRakutenItem({
      applicationId: applicationId!,
      accessKey: accessKey!,
      keyword: target.searchKeyword,
      hits: 15,
    });

    const raw = result.rawResponse as any;
    console.log(`total match count (Rakuten-wide): ${raw?.count ?? "?"}`);
    console.log(`items returned this call        : ${result.items.length}`);

    const { matched } = pickItemByTerms(result.items, { requiredTerms: target.matchTerms }, (i) => i.itemName);

    if (matched) {
      const skuInName = target.product.modelSku
        ? normalize(matched.itemName).includes(normalize(target.product.modelSku))
        : "(no confirmed SKU to check)";
      console.log("\n>> AUTO-MATCH: SUCCESS");
      console.log({
        itemName: matched.itemName,
        itemPrice: matched.itemPrice,
        shopName: matched.shopName,
        shopCode: matched.shopCode,
        itemUrl: matched.itemUrl,
        availability: matched.availability,
        candidatesConsidered: result.items.length,
        modelSkuFoundInName: skuInName,
      });
    } else {
      console.log("\n>> AUTO-MATCH: NO MATCH by match terms");
      console.log(`candidate item names (${result.items.length}):`);
      result.items.forEach((it, idx) => {
        console.log(`  [${idx}] (${it.shopCode}) ¥${it.itemPrice} - ${it.itemName}`);
      });
    }
  }
}

main().catch((err) => {
  console.error("Batch verification FAILED:");
  console.error(err);
  process.exit(1);
});
