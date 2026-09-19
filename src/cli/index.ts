#!/usr/bin/env node
/**
 * Minimal CLI entrypoint for Phase 1. Exists to prove the full
 * approve -> refresh -> review flow end-to-end against a real Supabase DB
 * without building any UI. Every command is a thin wrapper around the
 * services in src/services/* - the CLI itself holds no business logic.
 */
import "dotenv/config";
import { createSupabaseRepositories } from "../repository/supabase/index";
import { searchRakutenCandidates, searchCoupangCandidates, approveListing } from "../services/mappingService";
import { refreshApprovedListings, sweepStaleListings } from "../services/refreshService";
import {
  runScheduledRefreshJob,
  parseScheduledRefreshJobEnv,
  REFRESH_DUE_AGE_MS,
  REFRESH_LEASE_TTL_MS,
} from "../services/refreshJobService";
import { compareVariant } from "../services/comparisonService";
import { isProductType, PRODUCT_TYPES } from "../domain/searchAliases";
import type { SearchRakutenFn, SearchCoupangFn } from "../scripts/evaluate-candidates";

/** Injectable so tests can prove search-rakuten/search-coupang never touch
 * Supabase (createRepos) and never hit the real seller APIs (searchRakuten/
 * searchCoupang), without needing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or
 * real Rakuten/Coupang credentials. Defaults are the real implementations -
 * every existing call site (npm run cli, Cloud Run Jobs) is unaffected. */
export interface CliDeps {
  createRepos?: typeof createSupabaseRepositories;
  searchRakuten?: SearchRakutenFn;
  searchCoupang?: SearchCoupangFn;
}

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const rakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
const coupangCreds = {
  accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
  secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
};

export async function main(deps: CliDeps = {}) {
  const command = process.argv[2];
  // Lazy and per-command on purpose: search-rakuten/search-coupang need
  // neither Supabase env nor a repos instance at all, so createRepos() must
  // never be reached on their path (see CliDeps's doc comment).
  const createRepos = deps.createRepos ?? createSupabaseRepositories;
  const doSearchRakuten = deps.searchRakuten ?? searchRakutenCandidates;
  const doSearchCoupang = deps.searchCoupang ?? searchCoupangCandidates;

  switch (command) {
    case "search-rakuten": {
      const keyword = arg("keyword") ?? process.argv[3];
      const items = await doSearchRakuten(keyword!, rakutenCreds);
      items.forEach((it, i) =>
        console.log(`[${i}] itemCode=${it.itemCode} ¥${it.itemPrice} avail=${it.availability} - ${it.itemName}`),
      );
      break;
    }

    case "search-coupang": {
      const keyword = arg("keyword") ?? process.argv[3];
      const items = await doSearchCoupang(keyword!, coupangCreds);
      items.forEach((it, i) =>
        console.log(`[${i}] productId=${it.productId} ₩${it.productPrice} - ${it.productName}`),
      );
      break;
    }

    case "seed-product": {
      const category = arg("category")!;
      const brand = arg("brand")!;
      const name = arg("name")!;
      const productType = arg("productType")!;
      const modelSku = arg("sku") ?? null;
      const variantAttrs = arg("variant");

      if (!isProductType(productType)) {
        throw new Error(`--productType must be one of: ${PRODUCT_TYPES.join(", ")} - got "${productType}"`);
      }

      const repos = createRepos();
      const product = await repos.canonicalProducts.createProduct({ category, brand, officialName: name, productType });
      const variant = await repos.canonicalProducts.createVariant({
        canonicalProductId: product.id,
        variantAttributes: variantAttrs ? JSON.parse(variantAttrs) : {},
        modelSku,
        displayName: null,
      });
      console.log(`canonical_product.id=${product.id}`);
      console.log(`product_variant.id=${variant.id}`);
      break;
    }

    case "approve": {
      const repos = createRepos();
      const listing = await approveListing(repos, {
        productVariantId: arg("variant")!,
        sourceId: arg("source") as "rakuten" | "coupang",
        externalId: arg("externalId")!,
        externalIdType: arg("source") === "rakuten" ? "rakuten_item_code" : "coupang_product_id",
        sourceUrl: arg("sourceUrl") ?? null,
        searchKeywordUsed: arg("keyword")!,
        approvedBy: arg("approvedBy") ?? "cli-operator",
        confidence: (arg("confidence") as "verified" | "estimated") ?? "estimated",
        initialPrice: Number(arg("price")),
        initialCurrency: arg("currency")!,
        initialAvailability: arg("availability") !== "false",
      });
      console.log(`source_listing.id=${listing.id} externalId=${listing.externalId}`);
      break;
    }

    case "refresh": {
      const repos = createRepos();
      const sourceId = arg("source") as "rakuten" | "coupang";
      const results = await refreshApprovedListings(
        { repos, rakutenCreds, coupangCreds },
        { sourceId, limit: Number(arg("limit") ?? "20") },
      );
      results.forEach((r) =>
        console.log(
          `listing=${r.listingId} found=${r.found} price=${r.newPrice} priceChanged=${r.priceChanged} availabilityChanged=${r.availabilityChanged} historyAppended=${r.historyAppended} reviewRequired=${r.reviewRequired} reason=${r.reviewReason ?? "-"}`,
        ),
      );
      break;
    }

    // Cloud Run Job entrypoint (see deploy/gcp/refresh-job.sh) - config
    // comes entirely from env vars (SOURCE/LIMIT/CLOUD_RUN_EXECUTION), never
    // from --flag= args like every other command here, since that's what
    // Cloud Run Jobs actually set. parseScheduledRefreshJobEnv() validates
    // and throws BEFORE runScheduledRefreshJob() is ever called, so an
    // invalid SOURCE/LIMIT never reaches the lease or a seller call.
    case "scheduled-refresh": {
      const repos = createRepos();
      const { source, limit, runId } = parseScheduledRefreshJobEnv(process.env);
      const result = await runScheduledRefreshJob(
        { repos, rakutenCreds, coupangCreds },
        { source, limit, runId, now: new Date(), dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      );
      // Both outcomes here are a normal, successful CLI run - lease_busy is
      // an expected skip, not a failure (see runScheduledRefreshJob's own
      // structured "skipped" log line). A fatal DB/lease error instead
      // throws out of runScheduledRefreshJob() and is caught by this file's
      // existing top-level main().catch() below, same as every other
      // command's failures - process.exit(1) there already gives Cloud Run
      // Jobs the non-zero exit code a real failure needs.
      if (result.outcome === "completed") {
        console.log(`scheduled-refresh completed: ${JSON.stringify(result.summary)}`);
      }
      break;
    }

    case "stale-sweep": {
      const repos = createRepos();
      const flagged = await sweepStaleListings(repos);
      console.log(`flagged ${flagged.length} listing(s) as STALE:`, flagged);
      break;
    }

    case "review-queue": {
      const repos = createRepos();
      const queue = await repos.sourceListings.listReviewQueue();
      queue.forEach((l) =>
        console.log(`${l.id} | source=${l.sourceId} | reason=${l.reviewReason} | lastKnownPrice=${l.lastKnownPrice} | updatedAt=${l.updatedAt}`),
      );
      console.log(`\n${queue.length} listing(s) need review.`);
      break;
    }

    case "compare": {
      const repos = createRepos();
      const result = await compareVariant(repos, arg("variant")!);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(
        "Usage: tsx src/cli/index.ts <search-rakuten|search-coupang|seed-product|approve|refresh|scheduled-refresh|stale-sweep|review-queue|compare> --flag=value (scheduled-refresh takes SOURCE/LIMIT/CLOUD_RUN_EXECUTION as env vars instead)",
      );
      process.exit(1);
  }
}

// Only run when executed directly (tsx src/cli/index.ts ... / npm run cli /
// the Cloud Run Job command), never when imported by a test - mirrors
// src/scripts/evaluate-candidates.ts's own guard. Normalized to "/" first so
// this also matches a Windows-style backslash invocation path.
const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("cli/index.ts")) {
  main().catch((err) => {
    console.error("CLI command FAILED:", err);
    process.exit(1);
  });
}
