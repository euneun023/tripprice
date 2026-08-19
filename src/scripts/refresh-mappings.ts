/**
 * Run #2 - the actual test. Loads the mappings approved by bootstrap-mappings.ts
 * (run #1, a separate process execution) and re-identifies each one by
 * stable id, NOT by redoing fuzzy name matching. Live calls only.
 */
import "dotenv/config";
import { loadMappings, saveMappings } from "../store";
import { refreshRakutenMapping, refreshCoupangMapping } from "../refresh";
import type { ApprovedSourceMapping } from "../types";

const applicationId = process.env.applicationId!;
const accessKey = process.env.accessKey!;
const coupangAccessKey = process.env.COUPANG_PARTNERS_ACCESS_KEY!;
const coupangSecretKey = process.env.COUPANG_PARTNERS_SECRET_KEY!;

async function main() {
  const mappings = await loadMappings();
  if (mappings.length === 0) {
    console.error("No mappings found - run `npm run bootstrap:mappings` first (a separate run).");
    process.exit(1);
  }

  console.log(`Loaded ${mappings.length} previously-approved mappings.\n`);

  const updated: ApprovedSourceMapping[] = [];

  for (const mapping of mappings) {
    console.log("=".repeat(70));
    console.log(`${mapping.source.toUpperCase()} | ${mapping.productId} | externalId=${mapping.externalId}`);
    console.log(`  stored keyword: "${mapping.searchKeywordUsed}"`);
    console.log(`  previous: price=${mapping.lastKnownPrice} inStock=${mapping.lastKnownInStock} checkedAt=${mapping.lastCheckedAt}`);

    const outcome =
      mapping.source === "rakuten"
        ? await refreshRakutenMapping(mapping, { applicationId, accessKey })
        : await refreshCoupangMapping(mapping, { accessKey: coupangAccessKey, secretKey: coupangSecretKey });

    console.log(`  re-identified by exact id: ${outcome.found ? "YES" : "NO"}`);
    if (outcome.found) {
      console.log(`  new: price=${outcome.mapping.lastKnownPrice} inStock=${outcome.mapping.lastKnownInStock}`);
      console.log(`  priceChanged=${outcome.priceChanged} priceDeltaPct=${outcome.priceDeltaPct?.toFixed(3) ?? "n/a"} urlChanged=${outcome.urlChanged} stockChanged=${outcome.stockChanged}`);
    }
    console.log(`  reviewRequired=${outcome.mapping.reviewRequired} reviewReason=${outcome.mapping.reviewReason ?? "-"}`);
    console.log(`  confidence=${outcome.mapping.confidence} (unchanged by refresh - refresh never upgrades/downgrades confidence, only reviewRequired)`);

    updated.push(outcome.mapping);
  }

  await saveMappings(updated);
  console.log("\nSaved refreshed mappings.");

  console.log("\n=== SYNTHETIC NEGATIVE-PATH CHECK (not live data - proves NOT_FOUND path fires) ===");
  const fakeMapping: ApprovedSourceMapping = {
    ...updated[0],
    id: "synthetic-test",
    externalId: "mic21:THIS-ID-DOES-NOT-EXIST-999999",
  };
  const fakeOutcome = await refreshRakutenMapping(fakeMapping, { applicationId, accessKey });
  console.log(`  externalId deliberately wrong -> found=${fakeOutcome.found}, reviewRequired=${fakeOutcome.mapping.reviewRequired}, reason=${fakeOutcome.mapping.reviewReason}`);

  const priceJumpMapping: ApprovedSourceMapping = {
    ...updated[0],
    id: "synthetic-price-jump-test",
    lastKnownPrice: 10000, // real price is ~187000; forces a >40% delta
  };
  const priceJumpOutcome = await refreshRakutenMapping(priceJumpMapping, { applicationId, accessKey });
  console.log(
    `  lastKnownPrice deliberately set far off -> deltaPct=${priceJumpOutcome.priceDeltaPct?.toFixed(2)}, reviewRequired=${priceJumpOutcome.mapping.reviewRequired}, reason=${priceJumpOutcome.mapping.reviewReason}`,
  );
}

main().catch((err) => {
  console.error("Refresh FAILED:", err);
  process.exit(1);
});
