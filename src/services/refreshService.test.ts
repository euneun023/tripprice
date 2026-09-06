/**
 * Tests for refreshOneListing()/refreshApprovedListings()'s failure
 * isolation, plus the pre-existing checkedBefore forwarding tests. No test
 * runner is configured in this repo (see web/app/admin/lib/priceGrade.test.ts
 * for the existing plain-assertion convention this follows) - run directly:
 *   npx tsx src/services/refreshService.test.ts
 * Exits non-zero on any failure.
 *
 * Two layers are tested separately:
 *  - refreshOneListing()/refreshApprovedListings()'s own catch/isolation
 *    logic, via the fetchFn injection seam (adapters are hard-imported by
 *    refreshService.ts, not part of RefreshDeps, so this seam exists purely
 *    for testing without hitting a real seller API).
 *  - fetchCurrentByExternalId()'s real normalization boundary (does a real
 *    RakutenApiError/CoupangApiError - HTTP or transport-level - actually
 *    become a SellerFetchError, and does anything else NOT become one),
 *    exercised end-to-end against the real searchRakutenItem()/
 *    searchCoupangProduct() adapters by temporarily replacing
 *    globalThis.fetch (never a real network call).
 */
import {
  refreshApprovedListings,
  refreshOneListing,
  fetchCurrentByExternalId,
  SellerFetchError,
  type RefreshDeps,
  type SellerFetchFn,
} from "./refreshService";
import { RakutenApiError } from "../adapters/rakuten";
import { CoupangApiError } from "../adapters/coupang";
import type { SourceListing } from "../domain/types";

/** Temporarily replaces globalThis.fetch for the duration of fn(), always
 * restoring the original afterward (even on throw) - not a mocking library,
 * just scoping a single global swap to one test. */
async function withFakeFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function makeListing(overrides: Partial<SourceListing> = {}): SourceListing {
  return {
    id: "listing-1",
    productVariantId: "variant-1",
    sourceId: "rakuten",
    externalId: "ext-1",
    externalIdType: "rakuten_item_code",
    sourceUrl: null,
    searchKeywordUsed: "keyword",
    approvedAt: "2026-08-01T00:00:00.000Z",
    approvedBy: "tester",
    confidence: "verified",
    lastCheckedAt: "2026-08-19T00:00:00.000Z",
    lastSuccessAt: "2026-08-19T00:00:00.000Z",
    staleAfterHours: 24,
    reviewRequired: false,
    reviewReason: null,
    lastKnownPrice: 1000,
    lastKnownCurrency: "JPY",
    lastKnownAvailability: true,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

type UpdateCall = { id: string; patch: Record<string, unknown> };

function makeDeps(dueListings: SourceListing[] = []) {
  const updateCalls: UpdateCall[] = [];
  const appendCalls: unknown[] = [];
  const listDueForRefreshCalls: Array<{ sourceId: string; limit: number; checkedBefore: string | undefined }> = [];
  const deps = {
    repos: {
      sourceListings: {
        listDueForRefresh: async (sourceId: string, limit: number, checkedBefore?: string) => {
          listDueForRefreshCalls.push({ sourceId, limit, checkedBefore });
          return dueListings;
        },
        update: async (id: string, patch: Record<string, unknown>) => {
          updateCalls.push({ id, patch });
          return makeListing({ id, ...patch });
        },
      },
      priceHistory: {
        append: async (entry: unknown) => {
          appendCalls.push(entry);
        },
      },
    },
    rakutenCreds: { applicationId: "x", accessKey: "y" },
    coupangCreds: { accessKey: "x", secretKey: "y" },
    now: () => new Date("2026-09-05T00:00:00.000Z"),
  } as unknown as RefreshDeps;
  return { deps, updateCalls, appendCalls, listDueForRefreshCalls };
}

async function main() {
  // ============================================================
  // checkedBefore forwarding (from the previous commit, unchanged)
  // ============================================================
  {
    const { deps, listDueForRefreshCalls } = makeDeps();
    await refreshApprovedListings(deps, { sourceId: "rakuten", limit: 50 });
    check("admin-shaped call forwards checkedBefore=undefined", listDueForRefreshCalls[0].checkedBefore, undefined);
    check("admin-shaped call forwards limit", listDueForRefreshCalls[0].limit, 50);
  }
  {
    const cutoff = "2026-09-05T00:00:00.000Z";
    const { deps, listDueForRefreshCalls } = makeDeps();
    await refreshApprovedListings(deps, { sourceId: "coupang", limit: 20, checkedBefore: cutoff });
    check("scheduled-shaped call forwards checkedBefore unchanged", listDueForRefreshCalls[0].checkedBefore, cutoff);
  }

  // ============================================================
  // A. success
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000, reviewRequired: false, reviewReason: null });
    const { deps, updateCalls, appendCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true });

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("A: outcome=success", result.outcome, "success");
    check("A: found=true", result.found, true);
    check("A: newPrice", result.newPrice, 1200);
    check("A: update() called once", updateCalls.length, 1);
    check("A: last_checked_at updated", updateCalls[0].patch.lastCheckedAt, "2026-09-05T00:00:00.000Z");
    check("A: last_success_at updated", updateCalls[0].patch.lastSuccessAt, "2026-09-05T00:00:00.000Z");
    check("A: price updated", updateCalls[0].patch.lastKnownPrice, 1200);
    check("A: price_history appended (price changed)", appendCalls.length, 1);
    check("A: no failure metadata on a success result", result.failureKind, undefined);
  }

  // ============================================================
  // B. NOT_FOUND (soft failure)
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000 });
    const { deps, updateCalls, appendCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => null;

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("B: outcome=not_found", result.outcome, "not_found");
    check("B: found=false", result.found, false);
    check("B: reviewReason=NOT_FOUND", result.reviewReason, "NOT_FOUND");
    check("B: update() called once", updateCalls.length, 1);
    check("B: last_checked_at updated", updateCalls[0].patch.lastCheckedAt, "2026-09-05T00:00:00.000Z");
    check("B: last_success_at NOT included in patch (left untouched)", "lastSuccessAt" in updateCalls[0].patch, false);
    check("B: lastKnownPrice NOT included in patch (existing price kept)", "lastKnownPrice" in updateCalls[0].patch, false);
    check("B: price_history NOT appended", appendCalls.length, 0);
    check("B: no failure metadata on a not_found result", result.failureKind, undefined);
  }

  // ============================================================
  // C. expected seller hard failure (network/timeout/429/5xx/auth)
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000, reviewRequired: true, reviewReason: "PRICE_JUMP" });
    const { deps, updateCalls, appendCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new SellerFetchError("Rakuten fetch failed", new RakutenApiError("Rakuten fetch transport failure: ECONNRESET", 0, null));
    };

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("C: outcome=hard_failure", result.outcome, "hard_failure");
    check("C: found=false", result.found, false);
    check("C: existing reviewRequired preserved in result", result.reviewRequired, true);
    check("C: existing reviewReason preserved in result", result.reviewReason, "PRICE_JUMP");
    check("C: update() called exactly once", updateCalls.length, 1);
    check("C: patch touches ONLY last_checked_at", updateCalls[0].patch, { lastCheckedAt: "2026-09-05T00:00:00.000Z" });
    check("C: price_history NOT appended", appendCalls.length, 0);
    check("C: failureKind=transport (status 0 cause)", result.failureKind, "transport");
    check("C: status=0", result.status, 0);
    check("C: errorName=RakutenApiError", result.errorName, "RakutenApiError");
  }

  // ============================================================
  // C2. hard_failure metadata classification - safe, minimal fields only
  // (failureKind/status/errorName), never the seller's response body.
  // ============================================================
  for (const status of [403, 429, 500]) {
    const listing = makeListing();
    const { deps } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new SellerFetchError(
        "Rakuten fetch failed",
        new RakutenApiError(`Rakuten API responded ${status}`, status, { secret: "should never appear in RefreshOneResult" }),
      );
    };
    const result = await refreshOneListing(listing, deps, fetchFn);
    check(`C2: Rakuten HTTP ${status} -> outcome=hard_failure`, result.outcome, "hard_failure");
    check(`C2: Rakuten HTTP ${status} -> failureKind=http`, result.failureKind, "http");
    check(`C2: Rakuten HTTP ${status} -> status=${status}`, result.status, status);
    check(`C2: Rakuten HTTP ${status} -> errorName=RakutenApiError`, result.errorName, "RakutenApiError");
    check(`C2: Rakuten HTTP ${status} -> no "body"/"secret" key anywhere on the result`, "body" in result || "secret" in result, false);
  }
  {
    const listing = makeListing();
    const { deps } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new SellerFetchError("Rakuten fetch failed", new RakutenApiError("Rakuten fetch transport failure: timeout", 0, null));
    };
    const result = await refreshOneListing(listing, deps, fetchFn);
    check("C2: Rakuten transport -> failureKind=transport", result.failureKind, "transport");
    check("C2: Rakuten transport -> status=0", result.status, 0);
  }
  {
    const listing = makeListing({ sourceId: "coupang" });
    const { deps } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new SellerFetchError("Coupang fetch failed", new CoupangApiError("Coupang API responded 403", 403, { secret: "never" }));
    };
    const result = await refreshOneListing(listing, deps, fetchFn);
    check("C2: Coupang HTTP 403 -> failureKind=http", result.failureKind, "http");
    check("C2: Coupang HTTP 403 -> status=403", result.status, 403);
    check("C2: Coupang HTTP 403 -> errorName=CoupangApiError", result.errorName, "CoupangApiError");
  }
  {
    const listing = makeListing({ sourceId: "coupang" });
    const { deps } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new SellerFetchError("Coupang fetch failed", new CoupangApiError("Coupang fetch transport failure: timeout", 0, null));
    };
    const result = await refreshOneListing(listing, deps, fetchFn);
    check("C2: Coupang transport -> failureKind=transport", result.failureKind, "transport");
    check("C2: Coupang transport -> status=0", result.status, 0);
  }
  {
    // Unexpected/programmer error must still throw (not become a
    // hard_failure result at all) - failureKind/status/errorName are
    // therefore never populated because no RefreshOneResult is ever
    // produced for this case.
    const listing = makeListing();
    const { deps } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'items')");
    };
    let threw = false;
    try {
      await refreshOneListing(listing, deps, fetchFn);
    } catch {
      threw = true;
    }
    check("C2: unexpected TypeError still throws (not classified as hard_failure)", threw, true);
  }

  // ============================================================
  // C (batch-level): one listing's hard failure doesn't stop the rest
  // ============================================================
  {
    const listingA = makeListing({ id: "A", externalId: "ext-A" });
    const listingB = makeListing({ id: "B", externalId: "ext-B" });
    const listingC = makeListing({ id: "C", externalId: "ext-C" });
    const { deps, updateCalls } = makeDeps([listingA, listingB, listingC]);
    const fetchFn: SellerFetchFn = async (listing) => {
      if (listing.id === "B") throw new SellerFetchError("Rakuten fetch failed", new RakutenApiError("Rakuten fetch transport failure: ETIMEDOUT", 0, null));
      return { price: 999, currency: "JPY", availability: true };
    };

    const results = await refreshApprovedListings(deps, { sourceId: "rakuten" }, fetchFn);

    check("batch: all 3 listings produced a result (B's hard failure didn't stop A/C)", results.length, 3);
    check("batch: outcomes in order", results.map((r) => r.outcome), ["success", "hard_failure", "success"]);
    check("batch: update() called once per listing (3 total)", updateCalls.length, 3);
  }

  // ============================================================
  // D. DB update failure propagates (not swallowed)
  // ============================================================
  {
    const listing = makeListing();
    const { deps } = makeDeps();
    (deps.repos.sourceListings as any).update = async () => {
      throw new Error("supabase: connection refused");
    };
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true });

    let threw = false;
    let message = "";
    try {
      await refreshOneListing(listing, deps, fetchFn);
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("D: DB update failure propagates (not caught)", threw, true);
    check("D: original error message preserved", message, "supabase: connection refused");
  }

  // ============================================================
  // D (batch-level): a DB failure aborts the batch for the remaining listings
  // ============================================================
  {
    const listingA = makeListing({ id: "A" });
    const listingB = makeListing({ id: "B" });
    const { deps } = makeDeps([listingA, listingB]);
    (deps.repos.sourceListings as any).update = async () => {
      throw new Error("supabase: connection refused");
    };
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true });

    let threw = false;
    try {
      await refreshApprovedListings(deps, { sourceId: "rakuten" }, fetchFn);
    } catch {
      threw = true;
    }
    check("batch: DB failure on listing A propagates out of refreshApprovedListings (batch aborted)", threw, true);
  }

  // ============================================================
  // E. price_history append failure propagates (not swallowed)
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000 });
    const { deps } = makeDeps();
    (deps.repos.priceHistory as any).append = async () => {
      throw new Error("supabase: insert failed");
    };
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true }); // price change -> append attempted

    let threw = false;
    let message = "";
    try {
      await refreshOneListing(listing, deps, fetchFn);
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("E: price_history append failure propagates (not caught)", threw, true);
    check("E: original error message preserved", message, "supabase: insert failed");
  }

  // ============================================================
  // F. unknown/programmer error is NOT misclassified as a seller hard failure
  // ============================================================
  {
    const listing = makeListing();
    const { deps, updateCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'items')");
    };

    let threw = false;
    let isSellerFetchError = true;
    try {
      await refreshOneListing(listing, deps, fetchFn);
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check("F: unknown error propagates instead of becoming a hard_failure result", threw, true);
    check("F: unknown error is NOT wrapped as SellerFetchError", isSellerFetchError, false);
    check("F: no DB update happened for the misclassified path", updateCalls.length, 0);
  }

  // ============================================================
  // G. real adapter boundary: Rakuten non-2xx -> SellerFetchError
  // ============================================================
  {
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1" });
    const deps = makeDeps().deps;
    const fakeFetch = (async () =>
      ({ ok: false, status: 500, json: async () => null }) as unknown as Response) as typeof fetch;

    let threw = false;
    let isSellerFetchError = false;
    try {
      await withFakeFetch(fakeFetch, () => fetchCurrentByExternalId(listing, deps));
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check("G: Rakuten non-2xx -> throws", threw, true);
    check("G: Rakuten non-2xx -> SellerFetchError", isSellerFetchError, true);
  }

  // ============================================================
  // G. real adapter boundary: Coupang non-2xx -> SellerFetchError
  // ============================================================
  {
    const listing = makeListing({ sourceId: "coupang", externalId: "ext-1" });
    const deps = makeDeps().deps;
    const fakeFetch = (async () =>
      ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ rCode: "ERROR", rMessage: "forbidden" }),
        headers: { forEach: () => {} },
      }) as unknown as Response) as typeof fetch;

    let threw = false;
    let isSellerFetchError = false;
    try {
      await withFakeFetch(fakeFetch, () => fetchCurrentByExternalId(listing, deps));
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check("G: Coupang non-2xx -> throws", threw, true);
    check("G: Coupang non-2xx -> SellerFetchError", isSellerFetchError, true);
  }

  // ============================================================
  // G. real adapter boundary: transport/network failure -> SellerFetchError
  // (fetch() itself rejects - DNS/connection/timeout - not an HTTP response)
  // ============================================================
  for (const sourceId of ["rakuten", "coupang"] as const) {
    const listing = makeListing({ sourceId, externalId: "ext-1" });
    const deps = makeDeps().deps;
    const fakeFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    let threw = false;
    let isSellerFetchError = false;
    try {
      await withFakeFetch(fakeFetch, () => fetchCurrentByExternalId(listing, deps));
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check(`G: ${sourceId} transport failure -> throws`, threw, true);
    check(`G: ${sourceId} transport failure -> SellerFetchError (not a bare TypeError)`, isSellerFetchError, true);
  }

  // ============================================================
  // H. real adapter boundary: a genuine programmer/config error inside the
  // adapter call (bad Coupang secretKey -> crypto.createHmac throws, before
  // fetch() ever runs) must NOT be misclassified as a seller hard failure.
  // No fetch mock needed - this throws before any network call.
  // ============================================================
  {
    const listing = makeListing({ sourceId: "coupang", externalId: "ext-1" });
    const { deps } = makeDeps();
    (deps as any).coupangCreds = { accessKey: "x", secretKey: undefined };

    let threw = false;
    let isSellerFetchError = true;
    try {
      await fetchCurrentByExternalId(listing, deps);
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check("H: bad-credentials programmer error throws", threw, true);
    check("H: bad-credentials programmer error is NOT wrapped as SellerFetchError", isSellerFetchError, false);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
