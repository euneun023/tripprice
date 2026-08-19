/**
 * Same engine as verify-rakuten-batch.ts, applied to 5 non-diving products
 * to test category generality. For each product this prints:
 *  - the full raw candidate list (always, not just on failure)
 *  - an exact SKU/model-number match attempt (where a confirmed code exists)
 *  - a name-based required+exclude term match attempt (accessory/variant filter)
 * so capacity/formulation/accessory confusion can be judged from real
 * evidence, the same way the Suunto D5 false positive was caught earlier.
 */
import "dotenv/config";
import { searchRakutenItem } from "../sources/rakuten";
import { pickItemBySku, pickItemByTerms } from "../match";
import { mainstreamBatch1 } from "../mainstreamBatch1";

const applicationId = process.env.applicationId;
const accessKey = process.env.accessKey;
if (!applicationId || !accessKey) {
  console.error("Missing applicationId/accessKey in .env");
  process.exit(1);
}

async function main() {
  for (const target of mainstreamBatch1) {
    console.log("\n" + "=".repeat(70));
    console.log(`PRODUCT: ${target.product.officialName} [${target.product.category}]`);
    console.log(`exact SKU (if known): ${target.exactSku ?? "(none confirmed)"}`);
    console.log(`search keyword       : "${target.searchKeyword}"`);
    console.log(`required terms       : [${target.requiredTerms.join(", ")}]`);
    console.log(`exclude terms        : [${target.excludeTerms.join(", ")}]`);

    const result = await searchRakutenItem({
      applicationId: applicationId!,
      accessKey: accessKey!,
      keyword: target.searchKeyword,
      hits: 20,
    });

    const raw = result.rawResponse as any;
    console.log(`total match count (Rakuten-wide): ${raw?.count ?? "?"}`);
    console.log(`items returned this call        : ${result.items.length}`);

    console.log(`\nfull candidate list:`);
    result.items.forEach((it, idx) => {
      console.log(`  [${idx}] (${it.shopCode}) ¥${it.itemPrice} - ${it.itemName}`);
    });

    if (target.exactSku) {
      const skuMatch = pickItemBySku(result.items, target.exactSku, (i) => i.itemName);
      console.log(
        `\n>> EXACT SKU MATCH ("${target.exactSku}"): ${skuMatch ? "FOUND" : "NOT FOUND"}`,
      );
      if (skuMatch) {
        console.log({
          itemName: skuMatch.itemName,
          itemPrice: skuMatch.itemPrice,
          shopCode: skuMatch.shopCode,
          itemUrl: skuMatch.itemUrl,
          availability: skuMatch.availability,
        });
      }
    }

    const { matched, excluded } = pickItemByTerms(
      result.items,
      { requiredTerms: target.requiredTerms, excludeTerms: target.excludeTerms },
      (i) => i.itemName,
    );

    console.log(`\n>> NAME-TERM MATCH: ${matched ? "FOUND" : "NOT FOUND"}`);
    if (matched) {
      console.log({
        itemName: matched.itemName,
        itemPrice: matched.itemPrice,
        shopCode: matched.shopCode,
        itemUrl: matched.itemUrl,
        availability: matched.availability,
      });
    }
    console.log(
      `>> excluded by excludeTerms (accessory/set/other-variant candidates caught): ${excluded.length}`,
    );
    excluded.forEach((it) => console.log(`   - (${it.shopCode}) ¥${it.itemPrice} - ${it.itemName}`));
  }
}

main().catch((err) => {
  console.error("Mainstream verification FAILED:");
  console.error(err);
  process.exit(1);
});
