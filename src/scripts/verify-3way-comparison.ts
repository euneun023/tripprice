/**
 * Phase 1 closing verification #2: 3-way compareVariant() on a real DB,
 * using a manual/test source (no external API calls) so this is purely
 * about proving the comparison math, not source integration.
 *
 * Self-cleaning: creates its own throwaway source/product/variant/listings,
 * asserts against them, then deletes everything it created. Nothing from
 * this script should remain in the DB afterward.
 */
import "dotenv/config";
import { getSupabaseClient } from "../db/supabaseClient";
import { createSupabaseRepositories } from "../repository/supabase/index";
import { approveListing } from "../services/mappingService";
import { compareVariant } from "../services/comparisonService";

const TEST_SOURCE_ID = "manual-test";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  OK: ${message}`);
}

async function main() {
  const db = getSupabaseClient();
  const repos = createSupabaseRepositories();

  console.log("=== setup: throwaway manual-test source + product + variant ===");
  const { error: sourceErr } = await db.from("sources").upsert({
    id: TEST_SOURCE_ID,
    name: "Manual/Test Source (Phase 1 verification fixture only - deleted at end of this script)",
    region: "KR",
    update_method: "manual",
    automation_status: "manual",
    default_stale_after_hours: 24,
  });
  if (sourceErr) throw sourceErr;

  const product = await repos.canonicalProducts.createProduct({
    // "camera" is as good a fit as any single-body electronics product for a
    // fixture that carries no real specs - category/officialName/productType
    // are kept mutually consistent (a "camera" fixture in the "electronics"
    // category) rather than mismatched placeholders. createProduct()'s write
    // contract requires a real ProductType regardless of how synthetic the
    // fixture is - this script is a normal writer, not an exception, and
    // stays correct once a future migration adds `SET NOT NULL` to the DB.
    category: "electronics",
    brand: "TestFixture",
    officialName: "Phase1 3-Way Comparison Camera Test Fixture",
    productType: "camera",
  });
  const variant = await repos.canonicalProducts.createVariant({
    canonicalProductId: product.id,
    variantAttributes: {},
    modelSku: null,
    displayName: null,
  });
  console.log(`  product=${product.id} variant=${variant.id}`);

  console.log("\n=== approving 3 legs (KRW / JPY / USD, no real API calls) ===");
  const legA = await approveListing(repos, {
    productVariantId: variant.id,
    sourceId: TEST_SOURCE_ID,
    externalId: "manual-test:leg-a-kr",
    externalIdType: "manual_test_id",
    sourceUrl: null,
    searchKeywordUsed: "(test fixture, no real search)",
    approvedBy: "phase1-3way-test",
    confidence: "estimated",
    initialPrice: 150000,
    initialCurrency: "KRW",
    initialAvailability: true,
  });
  const legB = await approveListing(repos, {
    productVariantId: variant.id,
    sourceId: TEST_SOURCE_ID,
    externalId: "manual-test:leg-b-jp",
    externalIdType: "manual_test_id",
    sourceUrl: null,
    searchKeywordUsed: "(test fixture, no real search)",
    approvedBy: "phase1-3way-test",
    confidence: "estimated",
    initialPrice: 12000,
    initialCurrency: "JPY",
    initialAvailability: true,
  });
  const legC = await approveListing(repos, {
    productVariantId: variant.id,
    sourceId: TEST_SOURCE_ID,
    externalId: "manual-test:leg-c-intl",
    externalIdType: "manual_test_id",
    sourceUrl: null,
    searchKeywordUsed: "(test fixture, no real search)",
    approvedBy: "phase1-3way-test",
    confidence: "estimated",
    initialPrice: 100,
    initialCurrency: "USD",
    initialAvailability: true,
  });
  console.log(`  legA(KRW)=${legA.id} legB(JPY)=${legB.id} legC(USD)=${legC.id}`);

  let allPassed = true;
  try {
    console.log("\n=== compareVariant(): all 3 available ===");
    const result1 = await compareVariant(repos, variant.id);
    console.log(JSON.stringify(result1, null, 2));

    assert(result1.legCount === 3, "legCount === 3");
    assert(result1.mode === "n-way", 'mode === "n-way"');

    const sorted = [...result1.legs].sort((a, b) => a.krwPrice - b.krwPrice);
    const expectedWinner = sorted[0];
    const expectedHighest = sorted[sorted.length - 1];
    const actualWinner = result1.legs.find((l) => l.isWinner)!;
    assert(actualWinner.sourceListingId === expectedWinner.sourceListingId, "winner is the leg with the lowest krwPrice");
    assert(
      result1.legs.filter((l) => l.isWinner).length === 1,
      "exactly one leg is marked winner",
    );
    for (const leg of result1.legs) {
      assert(leg.krwPrice > 0 && Number.isFinite(leg.krwPrice), `leg ${leg.sourceId}/${leg.currency} has a finite positive krwPrice (${leg.krwPrice})`);
      assert(
        leg.diffFromWinnerKrw === leg.krwPrice - expectedWinner.krwPrice,
        `leg ${leg.sourceId} diffFromWinnerKrw is correct (${leg.diffFromWinnerKrw})`,
      );
      assert(
        leg.savingsVsHighestKrw === expectedHighest.krwPrice - leg.krwPrice,
        `leg ${leg.sourceId} savingsVsHighestKrw is correct (${leg.savingsVsHighestKrw})`,
      );
    }
    assert(actualWinner.diffFromWinnerKrw === 0, "winner's diffFromWinnerKrw === 0");
    assert(
      result1.legs.find((l) => l.sourceListingId === expectedHighest.sourceListingId)!.savingsVsHighestKrw === 0,
      "highest-priced leg's savingsVsHighestKrw === 0",
    );

    console.log("\n=== marking leg C (USD) unavailable, re-comparing ===");
    await repos.sourceListings.update(legC.id, { lastKnownAvailability: false });
    const result2 = await compareVariant(repos, variant.id);
    console.log(JSON.stringify(result2, null, 2));

    assert(result2.legCount === 2, "legCount === 2 after leg C goes unavailable");
    assert(result2.mode === "n-way", '2 legs still reports mode === "n-way"');
    assert(
      !result2.legs.some((l) => l.sourceListingId === legC.id),
      "unavailable leg C is excluded from the comparison entirely",
    );
    assert(
      result2.legs.some((l) => l.sourceListingId === legA.id) &&
        result2.legs.some((l) => l.sourceListingId === legB.id),
      "legs A and B remain and are compared against each other",
    );
    assert(result2.legs.filter((l) => l.isWinner).length === 1, "still exactly one winner among the remaining 2");
  } catch (err) {
    allPassed = false;
    console.error("\nVERIFICATION FAILED:", err);
  }

  console.log("\n=== cleanup: removing everything this script created ===");
  await db.from("source_listings").delete().in("id", [legA.id, legB.id, legC.id]); // price_history cascades
  await db.from("product_variants").delete().eq("id", variant.id);
  await db.from("canonical_products").delete().eq("id", product.id);
  await db.from("sources").delete().eq("id", TEST_SOURCE_ID);
  console.log("  done - test fixture fully removed.");

  if (!allPassed) process.exit(1);
  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((err) => {
  console.error("Script FAILED:", err);
  process.exit(1);
});
