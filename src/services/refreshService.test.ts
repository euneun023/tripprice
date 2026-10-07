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
    shippingStatus: "unknown",
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
  // B2. not-found + already OUT_OF_STOCK -> stays OUT_OF_STOCK (2026-10-06
  // policy: a not-found seller search must never downgrade an existing
  // human OUT_OF_STOCK classification to NOT_FOUND)
  // ============================================================
  {
    const listing = makeListing({ reviewRequired: true, reviewReason: "OUT_OF_STOCK" });
    const { deps, updateCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => null;

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("B2: outcome=not_found", result.outcome, "not_found");
    check("B2: found=false", result.found, false);
    check("B2: reviewReason stays OUT_OF_STOCK (not downgraded to NOT_FOUND)", result.reviewReason, "OUT_OF_STOCK");
    check("B2: reviewRequired stays true", result.reviewRequired, true);
    check("B2: update() patch keeps reviewReason=OUT_OF_STOCK", updateCalls[0].patch.reviewReason, "OUT_OF_STOCK");
    check("B2: update() patch keeps reviewRequired=true", updateCalls[0].patch.reviewRequired, true);
    check("B2: last_checked_at still updated (an attempt was made)", updateCalls[0].patch.lastCheckedAt, "2026-09-05T00:00:00.000Z");
    check("B2: last_success_at NOT included in patch (not a success)", "lastSuccessAt" in updateCalls[0].patch, false);
  }

  // ============================================================
  // B3. not-found + an existing reviewReason OTHER than OUT_OF_STOCK ->
  // unchanged pre-existing behavior: still overwritten to NOT_FOUND. Covers
  // PRICE_JUMP, AMBIGUOUS_MATCH, STALE and "no reason yet" (null) - the
  // B2 carve-out is OUT_OF_STOCK-only, not "preserve whatever was there".
  // ============================================================
  for (const priorReason of ["PRICE_JUMP", "AMBIGUOUS_MATCH", "STALE", null] as const) {
    const listing = makeListing({ reviewRequired: true, reviewReason: priorReason });
    const { deps, updateCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => null;

    const result = await refreshOneListing(listing, deps, fetchFn);

    check(`B3: not-found overwrites prior reviewReason=${priorReason} with NOT_FOUND`, result.reviewReason, "NOT_FOUND");
    check(`B3: patch reviewReason=${priorReason} -> NOT_FOUND`, updateCalls[0].patch.reviewReason, "NOT_FOUND");
  }

  // ============================================================
  // I. found=true, availability=false -> OUT_OF_STOCK (unchanged policy)
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000, lastKnownAvailability: true, reviewRequired: false, reviewReason: null });
    const { deps, updateCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => ({ price: 1000, currency: "JPY", availability: false });

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("I: outcome=success (seller search found the item)", result.outcome, "success");
    check("I: found=true", result.found, true);
    check("I: reviewReason=OUT_OF_STOCK", result.reviewReason, "OUT_OF_STOCK");
    check("I: reviewRequired=true", result.reviewRequired, true);
    check("I: patch reviewReason=OUT_OF_STOCK", updateCalls[0].patch.reviewReason, "OUT_OF_STOCK");
    check("I: last_success_at updated (this WAS a successful fetch)", updateCalls[0].patch.lastSuccessAt, "2026-09-05T00:00:00.000Z");
  }

  // ============================================================
  // I2. previously OUT_OF_STOCK, found=true, availability=true -> normal
  // recovery still works (OUT_OF_STOCK is never permanently locked once a
  // live fetch actually finds the item back in stock)
  // ============================================================
  {
    const listing = makeListing({ lastKnownPrice: 1000, lastKnownAvailability: false, reviewRequired: true, reviewReason: "OUT_OF_STOCK" });
    const { deps, updateCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => ({ price: 1000, currency: "JPY", availability: true });

    const result = await refreshOneListing(listing, deps, fetchFn);

    check("I2: outcome=success", result.outcome, "success");
    check("I2: reviewReason recovers to null", result.reviewReason, null);
    check("I2: reviewRequired recovers to false", result.reviewRequired, false);
    check("I2: patch clears reviewReason", updateCalls[0].patch.reviewReason, null);
    check("I2: patch clears reviewRequired", updateCalls[0].patch.reviewRequired, false);
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
  // G2. Rakuten 400 -> exactly one fallback retry via the shared
  // buildRakutenFallbackKeyword() helper (src/adapters/rakuten.ts) - same
  // policy as evaluate-candidates.ts's candidate search path.
  // ============================================================
  function fakeRakutenSequence(responses: Array<{ status: number; items?: unknown[] }>) {
    const keywordsSeen: string[] = [];
    let call = 0;
    const fake = (async (input: string) => {
      keywordsSeen.push(new URL(input).searchParams.get("keyword") ?? "");
      const resp = responses[Math.min(call, responses.length - 1)];
      call++;
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => (resp.items ? { Items: resp.items } : null),
      } as unknown as Response;
    }) as typeof fetch;
    return { fake, keywordsSeen, callCount: () => call };
  }

  const rakutenItem = (itemCode: string) => ({
    itemName: "n",
    itemPrice: 1000,
    itemUrl: "u",
    itemCode,
    shopName: "s",
    shopCode: "s",
    availability: 1,
  });

  for (const keyword of ["Sony α7 V", "Sony α7R V", "Nikon NIKKOR Z 24-70mm f/2.8 S II"]) {
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: keyword });
    const deps = makeDeps().deps;
    const { fake, keywordsSeen, callCount } = fakeRakutenSequence([
      { status: 400 },
      { status: 200, items: [rakutenItem("ext-1")] },
    ]);

    const found = await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));

    check(`G2: "${keyword}" -> raw call uses unmodified keyword`, keywordsSeen[0], keyword);
    check(`G2: "${keyword}" -> exactly 2 calls (raw + 1 fallback)`, callCount(), 2);
    check(`G2: "${keyword}" -> fallback keyword differs from raw`, keywordsSeen[1] !== keyword, true);
    check(`G2: "${keyword}" -> fallback keyword has no standalone 1-letter token`, /(^| )[A-Za-z]( |$)/.test(keywordsSeen[1]), false);
    check(`G2: "${keyword}" -> item found after fallback`, found, { price: 1000, currency: "JPY", availability: true, shippingStatus: "unknown" });
  }

  {
    // fallback keyword also 400s -> no third retry, existing hardFailure path
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α7 V" });
    const deps = makeDeps().deps;
    const { fake, callCount } = fakeRakutenSequence([{ status: 400 }, { status: 400 }]);

    let threw = false;
    let isSellerFetchError = false;
    try {
      await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));
    } catch (e) {
      threw = true;
      isSellerFetchError = e instanceof SellerFetchError;
    }
    check("G2: fallback also 400s -> throws SellerFetchError (existing hardFailure)", threw && isSellerFetchError, true);
    check("G2: fallback also 400s -> exactly 2 calls total (no 3rd retry)", callCount(), 2);
  }

  {
    // 400 with a keyword that has no mergeable standalone token -> no retry at all
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α1 II" });
    const deps = makeDeps().deps;
    const { fake, callCount } = fakeRakutenSequence([{ status: 400 }, { status: 200, items: [rakutenItem("ext-1")] }]);

    let threw = false;
    try {
      await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));
    } catch {
      threw = true;
    }
    check("G2: 400 with no mergeable token -> throws (no retry attempted)", threw, true);
    check("G2: 400 with no mergeable token -> exactly 1 call", callCount(), 1);
  }

  for (const status of [403, 500]) {
    // non-400 error -> never retried, even with a mergeable keyword
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α7 V" });
    const deps = makeDeps().deps;
    const { fake, callCount } = fakeRakutenSequence([{ status }, { status: 200, items: [rakutenItem("ext-1")] }]);

    let threw = false;
    try {
      await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));
    } catch {
      threw = true;
    }
    check(`G2: non-400 (${status}) -> throws (no fallback retry)`, threw, true);
    check(`G2: non-400 (${status}) -> exactly 1 call`, callCount(), 1);
  }

  {
    // raw call succeeds -> no fallback attempted at all, even with a
    // keyword shaped like one that would otherwise need merging
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α7 V" });
    const deps = makeDeps().deps;
    const { fake, keywordsSeen, callCount } = fakeRakutenSequence([{ status: 200, items: [rakutenItem("ext-1")] }]);

    const found = await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));

    check("G2: raw success -> exactly 1 call", callCount(), 1);
    check("G2: raw success -> keyword sent unmodified", keywordsSeen[0], "Sony α7 V");
    check("G2: raw success -> item found", found, { price: 1000, currency: "JPY", availability: true, shippingStatus: "unknown" });
  }

  // ============================================================
  // H. shipping status wiring (real Rakuten postageFlag -> fetchCurrentByExternalId
  // -> refreshOneListing -> source_listings.update()/price_history.append()).
  // ============================================================
  {
    // real end-to-end: a live-shaped Rakuten response with postageFlag=1
    // (separate) reaches fetchCurrentByExternalId()'s own derivation.
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α7 V" });
    const deps = makeDeps().deps;
    const { fake } = fakeRakutenSequence([{ status: 200, items: [{ ...rakutenItem("ext-1"), postageFlag: 1 }] }]);
    const found = await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));
    check("H: real Rakuten postageFlag=1 -> fetchCurrentByExternalId derives separate", found?.shippingStatus, "separate");
  }
  {
    const listing = makeListing({ sourceId: "rakuten", externalId: "ext-1", searchKeywordUsed: "Sony α7 V" });
    const deps = makeDeps().deps;
    const { fake } = fakeRakutenSequence([{ status: 200, items: [{ ...rakutenItem("ext-1"), postageFlag: 0 }] }]);
    const found = await withFakeFetch(fake, () => fetchCurrentByExternalId(listing, deps));
    check("H: real Rakuten postageFlag=0 -> fetchCurrentByExternalId derives included (seller-postage only, see doc comment)", found?.shippingStatus, "included");
  }
  {
    // refreshOneListing() itself must thread a derived shippingStatus into
    // BOTH the source_listings.update() patch and the price_history.append()
    // entry - this is the "not left as unknown forever" wiring the read-only
    // audit found missing.
    const listing = makeListing({ lastKnownPrice: 1000, shippingStatus: "unknown" });
    const { deps, updateCalls, appendCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true, shippingStatus: "separate" });

    await refreshOneListing(listing, deps, fetchFn);

    check("H: update() patch carries the freshly-derived shippingStatus", updateCalls[0].patch.shippingStatus, "separate");
    check("H: price_history entry carries the same shippingStatus snapshot", (appendCalls[0] as { shippingStatus?: string }).shippingStatus, "separate");
  }
  {
    // a fetchFn that doesn't know about shipping at all (shippingStatus
    // undefined - e.g. a not-yet-updated caller) must NEVER cause the
    // update() patch to write "unknown" over an already-known value - the
    // key must be omitted entirely, exactly like the existing
    // lastKnownPrice-omission convention for a NOT_FOUND result (see test B).
    const listing = makeListing({ lastKnownPrice: 1000, shippingStatus: "included" });
    const { deps, updateCalls, appendCalls } = makeDeps();
    const fetchFn: SellerFetchFn = async () => ({ price: 1200, currency: "JPY", availability: true }); // no shippingStatus

    await refreshOneListing(listing, deps, fetchFn);

    check("H: shippingStatus NOT included in update() patch when the fetch didn't derive one (never regressed to 'unknown')", "shippingStatus" in updateCalls[0].patch, false);
    check("H: price_history still appended (repository defaults its own copy to 'unknown', but that's a new row, not an overwrite)", appendCalls.length, 1);
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
