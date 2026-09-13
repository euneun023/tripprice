/**
 * Tests for the scheduled-refresh Job orchestration (runScheduledRefreshJob)
 * and its env-var config validation (parseScheduledRefreshJobEnv). No test
 * runner is configured in this repo (see web/app/admin/lib/priceGrade.test.ts
 * for the existing plain-assertion convention this follows) - run directly:
 *   npx tsx src/services/refreshJobService.test.ts
 * Exits non-zero on any failure.
 *
 * Fakes here are plain in-file objects (not a mocking library), matching
 * the convention already used in refreshService.test.ts and
 * RefreshLeaseRepository.test.ts. No seller API call, no real DB, no real
 * Cloud Run environment anywhere in this file.
 */
import {
  runScheduledRefreshJob,
  parseScheduledRefreshJobEnv,
  REFRESH_DUE_AGE_MS,
  REFRESH_LEASE_TTL_MS,
  type RefreshJobDeps,
} from "./refreshJobService";
import { SellerFetchError, type SellerFetchFn } from "./refreshService";
import { RakutenApiError } from "../adapters/rakuten";
import type { SourceListing } from "../domain/types";

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

function makeFakeDeps(opts: {
  dueListings?: SourceListing[];
  acquireResult?: boolean | Error;
  releaseResult?: "ok" | Error;
  /** id -> throw an Error from sourceListings.update() for that listing */
  updateFailsFor?: string;
}) {
  const dueListings = opts.dueListings ?? [];
  const calls = {
    listDueForRefresh: [] as Array<{ sourceId: string; limit: number; checkedBefore: string | undefined }>,
    tryAcquire: [] as Array<{ runId: string; now: string; lockedUntil: string }>,
    release: [] as Array<{ runId: string; now: string }>,
    update: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    append: [] as unknown[],
  };
  const repos: RefreshJobDeps["repos"] = {
    sourceListings: {
      listDueForRefresh: async (sourceId: string, limit: number, checkedBefore?: string) => {
        calls.listDueForRefresh.push({ sourceId, limit, checkedBefore });
        return dueListings;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        calls.update.push({ id, patch });
        if (opts.updateFailsFor === id) throw new Error(`simulated DB failure updating ${id}`);
        return makeListing({ id, ...patch });
      },
    } as any,
    priceHistory: {
      append: async (entry: unknown) => {
        calls.append.push(entry);
      },
    } as any,
    refreshLease: {
      tryAcquire: async (runId: string, now: string, lockedUntil: string) => {
        calls.tryAcquire.push({ runId, now, lockedUntil });
        if (opts.acquireResult instanceof Error) throw opts.acquireResult;
        return opts.acquireResult ?? true;
      },
      release: async (runId: string, now: string) => {
        calls.release.push({ runId, now });
        if (opts.releaseResult instanceof Error) throw opts.releaseResult;
      },
    } as any,
  };
  const deps: RefreshJobDeps = {
    repos,
    rakutenCreds: { applicationId: "x", accessKey: "y" },
    coupangCreds: { accessKey: "x", secretKey: "y" },
  };
  return { deps, calls };
}

function makeLogCapture() {
  const events: Record<string, unknown>[] = [];
  return { log: (e: Record<string, unknown>) => events.push(e), events };
}

const NOW = new Date("2026-09-06T00:00:00.000Z");
const successFetch: SellerFetchFn = async () => ({ price: 999, currency: "JPY", availability: true });
const notFoundFetch: SellerFetchFn = async () => null;
/** Resolves immediately - used everywhere pacing isn't what's under test, so
 * the suite never actually waits on Rakuten's real 1s batch pacing. */
const INSTANT_SLEEP = async (_ms: number) => {};

async function main() {
  // ============================================================
  // A. lease busy - refresh/release never called, normal (non-error) result
  // ============================================================
  {
    const { deps, calls } = makeFakeDeps({ acquireResult: false, dueListings: [makeListing()] });
    const { log, events } = makeLogCapture();
    const result = await runScheduledRefreshJob(
      deps,
      { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      log,
      successFetch,
      INSTANT_SLEEP,
    );
    check("A: outcome=skipped_lease_busy", result.outcome, "skipped_lease_busy");
    check("A: listDueForRefresh never called", calls.listDueForRefresh.length, 0);
    check("A: release never called", calls.release.length, 0);
    check("A: logged a skipped/lease_busy event", events.some((e) => e.event === "skipped" && e.reason === "lease_busy"), true);
    check("A: no fatal event logged", events.some((e) => e.event === "fatal"), false);
  }

  // ============================================================
  // B. all success - checkedBefore/lockedUntil exact, summary exact, release called
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" }), makeListing({ id: "L2" })];
    const { deps, calls } = makeFakeDeps({ dueListings: listings });
    const { log, events } = makeLogCapture();
    const result = await runScheduledRefreshJob(
      deps,
      { source: "rakuten", limit: 20, runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      log,
      successFetch,
      INSTANT_SLEEP,
    );
    check("B: checkedBefore = now - 5.5h exactly", calls.listDueForRefresh[0].checkedBefore, "2026-09-05T18:30:00.000Z");
    check("B: lockedUntil = now + 15m exactly", calls.tryAcquire[0].lockedUntil, "2026-09-06T00:15:00.000Z");
    check("B: acquire uses now as-is", calls.tryAcquire[0].now, "2026-09-06T00:00:00.000Z");
    check("B: outcome=completed", result.outcome, "completed");
    check("B: summary total=2", result.outcome === "completed" ? result.summary.total : null, 2);
    check("B: summary success=2", result.outcome === "completed" ? result.summary.success : null, 2);
    check("B: release called once with owner runId", calls.release, [{ runId: "exec-A", now: calls.release[0]?.now }]);
    check("B: completed event logged", events.some((e) => e.event === "completed"), true);
  }

  // ============================================================
  // C. success/not_found/hard_failure mixed - summary exact, normal completion
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" }), makeListing({ id: "L2" }), makeListing({ id: "L3" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    const mixedFetch: SellerFetchFn = async (listing) => {
      if (listing.id === "L1") return { price: 999, currency: "JPY", availability: true };
      if (listing.id === "L2") return null; // not_found
      throw new SellerFetchError("boom", new RakutenApiError("Rakuten API responded 500", 500, null)); // hard_failure
    };
    const { log, events } = makeLogCapture();
    const result = await runScheduledRefreshJob(
      deps,
      { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      log,
      mixedFetch,
      INSTANT_SLEEP,
    );
    check("C: outcome=completed", result.outcome, "completed");
    if (result.outcome === "completed") {
      check("C: total=3", result.summary.total, 3);
      check("C: success=1", result.summary.success, 1);
      check("C: notFound=1", result.summary.notFound, 1);
      check("C: hardFailure=1", result.summary.hardFailure, 1);
    }

    const sellerFailureEvents = events.filter((e) => e.event === "seller_failure");
    check("C: exactly one seller_failure event logged (one hard_failure)", sellerFailureEvents.length, 1);
    check("C: seller_failure has correct runId/source/listingId", {
      runId: sellerFailureEvents[0]?.runId,
      source: sellerFailureEvents[0]?.source,
      listingId: sellerFailureEvents[0]?.listingId,
    }, { runId: "exec-A", source: "rakuten", listingId: "L3" });
    check("C: seller_failure has correct failureKind/status/errorName", {
      failureKind: sellerFailureEvents[0]?.failureKind,
      status: sellerFailureEvents[0]?.status,
      errorName: sellerFailureEvents[0]?.errorName,
    }, { failureKind: "http", status: 500, errorName: "RakutenApiError" });
    check(
      "C: seller_failure log carries no secret/body/message field",
      Object.keys(sellerFailureEvents[0] ?? {}).every((k) =>
        ["event", "runId", "source", "listingId", "failureKind", "status", "errorName"].includes(k),
      ),
      true,
    );
    check("C: completed event's hardFailure still 1 (aggregate unaffected by the new per-failure log)", events.find((e) => e.event === "completed")?.hardFailure, 1);
  }

  // ============================================================
  // C-none. success/not_found produce NO seller_failure events
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" }), makeListing({ id: "L2" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    const fetchFn: SellerFetchFn = async (listing) => (listing.id === "L1" ? { price: 999, currency: "JPY", availability: true } : null);
    const { log, events } = makeLogCapture();
    await runScheduledRefreshJob(
      deps,
      { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      log,
      fetchFn,
      INSTANT_SLEEP,
    );
    check("C-none: no seller_failure events for success/not_found only", events.some((e) => e.event === "seller_failure"), false);
  }

  // ============================================================
  // D. refresh DB fatal - release still attempted, primary error thrown
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" })];
    const { deps, calls } = makeFakeDeps({ dueListings: listings, updateFailsFor: "L1" });
    const { log, events } = makeLogCapture();
    let threw = false;
    let message = "";
    try {
      await runScheduledRefreshJob(
        deps,
        { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        log,
        successFetch,
        INSTANT_SLEEP,
      );
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("D: throws the primary DB error", threw, true);
    check("D: error message preserved", message, "simulated DB failure updating L1");
    check("D: release was still attempted", calls.release.length, 1);
    check("D: fatal event logged", events.some((e) => e.event === "fatal"), true);
  }

  // ============================================================
  // E. refresh fatal + release fatal - primary error wins, release error only logged
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" })];
    const { deps } = makeFakeDeps({
      dueListings: listings,
      updateFailsFor: "L1",
      releaseResult: new Error("release also failed"),
    });
    const { log, events } = makeLogCapture();
    let message = "";
    try {
      await runScheduledRefreshJob(
        deps,
        { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        log,
        successFetch,
        INSTANT_SLEEP,
      );
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    check("E: thrown error is the PRIMARY error, not the release error", message, "simulated DB failure updating L1");
    const fatalEvent = events.find((e) => e.event === "fatal");
    check("E: fatal log includes both error and releaseError", !!fatalEvent && "error" in fatalEvent && "releaseError" in fatalEvent, true);
  }

  // ============================================================
  // F. success + release fatal - release error is thrown as fatal
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" })];
    const { deps } = makeFakeDeps({ dueListings: listings, releaseResult: new Error("release failed") });
    const { log, events } = makeLogCapture();
    let threw = false;
    let message = "";
    try {
      await runScheduledRefreshJob(
        deps,
        { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        log,
        successFetch,
        INSTANT_SLEEP,
      );
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("F: batch succeeded but release failure still throws", threw, true);
    check("F: thrown error is the release error", message, "release failed");
    check("F: fatal event logged with phase=release", events.some((e) => e.event === "fatal" && e.phase === "release"), true);
  }

  // ============================================================
  // G. invalid SOURCE - fails before any repos access
  // ============================================================
  {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "ebay", CLOUD_RUN_EXECUTION: "exec-A" } as any);
    } catch {
      threw = true;
    }
    check("G: invalid SOURCE throws in parseScheduledRefreshJobEnv (before any repo/lease call)", threw, true);
  }
  {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ CLOUD_RUN_EXECUTION: "exec-A" } as any); // SOURCE missing entirely
    } catch {
      threw = true;
    }
    check("G: missing SOURCE throws", threw, true);
  }

  // ============================================================
  // H. invalid LIMIT - fails before any repos access
  // ============================================================
  // Rakuten credentials included on every case below so each test actually
  // reaches (and specifically exercises) the LIMIT/CLOUD_RUN_EXECUTION
  // checks, rather than incidentally throwing on the credential check first.
  const RAKUTEN_CREDS_ENV = { applicationId: "app-id", accessKey: "access-key" };
  for (const bad of ["0", "-5", "abc", "3.5", "1e10", " 5", "5 "]) {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "rakuten", ...RAKUTEN_CREDS_ENV, LIMIT: bad, CLOUD_RUN_EXECUTION: "exec-A" } as any);
    } catch {
      threw = true;
    }
    check(`H: LIMIT=${JSON.stringify(bad)} throws`, threw, true);
  }
  {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "rakuten", ...RAKUTEN_CREDS_ENV, LIMIT: "501", CLOUD_RUN_EXECUTION: "exec-A" } as any);
    } catch {
      threw = true;
    }
    check("H: LIMIT above the sanity cap throws", threw, true);
  }
  {
    const { limit } = parseScheduledRefreshJobEnv({ SOURCE: "rakuten", ...RAKUTEN_CREDS_ENV, LIMIT: "35", CLOUD_RUN_EXECUTION: "exec-A" } as any);
    check("H: a valid LIMIT parses to a number", limit, 35);
  }
  {
    const { limit } = parseScheduledRefreshJobEnv({ SOURCE: "rakuten", ...RAKUTEN_CREDS_ENV, CLOUD_RUN_EXECUTION: "exec-A" } as any);
    check("H: omitted LIMIT -> undefined (refreshApprovedListings' own default applies)", limit, undefined);
  }
  {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "rakuten", ...RAKUTEN_CREDS_ENV, LIMIT: "10" } as any); // CLOUD_RUN_EXECUTION missing
    } catch {
      threw = true;
    }
    check("H: missing CLOUD_RUN_EXECUTION throws", threw, true);
  }

  // ============================================================
  // I. retry / partial resume: a fatal failure partway through still leaves
  // earlier listings' DB writes committed, and a same-runId retry with a
  // fresh `now` naturally only re-selects what's still actually due (proven
  // here by directly modeling what listDueForRefresh() would return the
  // second time, per its own already-tested checkedBefore semantics).
  // ============================================================
  {
    // Attempt 0: 10 listings due, the 11th's DB update fails.
    const attempt0Listings = [...Array(10)].map((_, i) => makeListing({ id: `L${i + 1}` })).concat(makeListing({ id: "L11" }));
    const { deps: deps0, calls: calls0 } = makeFakeDeps({ dueListings: attempt0Listings, updateFailsFor: "L11" });
    let threw0 = false;
    try {
      await runScheduledRefreshJob(
        deps0,
        { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        makeLogCapture().log,
        successFetch,
        INSTANT_SLEEP,
      );
    } catch {
      threw0 = true;
    }
    check("I: attempt 0 throws at listing 11", threw0, true);
    check("I: attempt 0 committed exactly 11 update() calls (10 successes + the failing one)", calls0.update.length, 11);
    check(
      "I: attempt 0's successful updates all set lastSuccessAt (real writes, not skipped)",
      calls0.update.slice(0, 10).every((c) => "lastSuccessAt" in c.patch),
      true,
    );

    // Retry: same CLOUD_RUN_EXECUTION, a few minutes later. L1-L10 are no
    // longer due (their last_checked_at was just set by attempt 0) - this
    // is modeled directly here per listDueForRefresh()'s already-tested
    // checkedBefore semantics (SourceListingRepository.test.ts), not
    // re-derived - only L11 (and, in reality, anything else genuinely still
    // stale) comes back due.
    const retryNow = new Date(NOW.getTime() + 5 * 60 * 1000); // 5 minutes later
    const { deps: deps1, calls: calls1 } = makeFakeDeps({ dueListings: [makeListing({ id: "L11" })] });
    const result1 = await runScheduledRefreshJob(
      deps1,
      { source: "rakuten", runId: "exec-A", now: retryNow, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      makeLogCapture().log,
      successFetch,
      INSTANT_SLEEP,
    );
    check("I: retry (same runId) reacquires the lease and completes", result1.outcome, "completed");
    check("I: retry only processes what's still due (L11)", result1.outcome === "completed" ? result1.summary.total : null, 1);
    check(
      "I: retry's checkedBefore is freshly derived from the retry's own `now`, not attempt 0's",
      calls1.listDueForRefresh[0].checkedBefore,
      new Date(retryNow.getTime() - REFRESH_DUE_AGE_MS).toISOString(),
    );
  }

  // ============================================================
  // Pacing: Rakuten scheduled batch waits between (never before/after)
  // listings, and stays consistent even when a listing hard_failures.
  // ============================================================
  {
    const listings = [makeListing({ id: "L1" }), makeListing({ id: "L2" }), makeListing({ id: "L3" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    const order: string[] = [];
    const tracedFetch: SellerFetchFn = async (listing) => {
      order.push(`fetch:${listing.id}`);
      if (listing.id === "L2") throw new SellerFetchError("boom", new RakutenApiError("Rakuten API responded 429", 429, null)); // hard_failure mid-batch
      return { price: 999, currency: "JPY", availability: true };
    };
    const tracedSleep = async (ms: number) => {
      order.push(`sleep:${ms}`);
    };

    const result = await runScheduledRefreshJob(
      deps,
      { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      makeLogCapture().log,
      tracedFetch,
      tracedSleep,
    );
    check("pacing: outcome=completed despite L2 hard_failure", result.outcome, "completed");
    check(
      "pacing: no delay before L1, one delay before each of L2/L3, none after L3 - consistent across a mid-batch hard_failure",
      order,
      ["fetch:L1", "sleep:1000", "fetch:L2", "sleep:1000", "fetch:L3"],
    );
  }

  // ============================================================
  // Pacing: Coupang batches never get Rakuten's pacing
  // ============================================================
  {
    const listings = [makeListing({ id: "L1", sourceId: "coupang" }), makeListing({ id: "L2", sourceId: "coupang" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    let sleepCalls = 0;
    const countingSleep = async (_ms: number) => {
      sleepCalls++;
    };
    const result = await runScheduledRefreshJob(
      deps,
      { source: "coupang", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
      makeLogCapture().log,
      successFetch,
      countingSleep,
    );
    check("pacing: Coupang batch never calls sleepFn", sleepCalls, 0);
    check("pacing: Coupang batch still completes normally", result.outcome, "completed");
  }

  // ============================================================
  // Credentials: SOURCE-specific requirement only - each source's job needs
  // only its own secrets, never the other source's.
  // ============================================================
  {
    const { source } = parseScheduledRefreshJobEnv({
      SOURCE: "rakuten",
      applicationId: "app-id",
      accessKey: "access-key",
      CLOUD_RUN_EXECUTION: "exec-A",
    } as any);
    check("credentials: SOURCE=rakuten + Rakuten creds only -> parses successfully", source, "rakuten");
  }
  {
    let threw = false;
    let message = "";
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "rakuten", CLOUD_RUN_EXECUTION: "exec-A" } as any); // no Rakuten creds at all
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("credentials: SOURCE=rakuten + missing Rakuten creds -> throws", threw, true);
    check("credentials: error names Rakuten, not Coupang", message.includes("applicationId"), true);
  }
  {
    // SOURCE=rakuten with Rakuten creds present but Coupang creds absent -
    // must succeed, by design: a Rakuten-only Job must not require Coupang
    // secrets to be configured at all.
    const { source } = parseScheduledRefreshJobEnv({
      SOURCE: "rakuten",
      applicationId: "app-id",
      accessKey: "access-key",
      CLOUD_RUN_EXECUTION: "exec-A",
      // COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY intentionally absent
    } as any);
    check("credentials: SOURCE=rakuten succeeds with Coupang creds entirely absent", source, "rakuten");
  }
  {
    const { source } = parseScheduledRefreshJobEnv({
      SOURCE: "coupang",
      COUPANG_PARTNERS_ACCESS_KEY: "ck",
      COUPANG_PARTNERS_SECRET_KEY: "cs",
      CLOUD_RUN_EXECUTION: "exec-A",
    } as any);
    check("credentials: SOURCE=coupang + Coupang creds only -> parses successfully", source, "coupang");
  }
  {
    let threw = false;
    try {
      parseScheduledRefreshJobEnv({ SOURCE: "coupang", CLOUD_RUN_EXECUTION: "exec-A" } as any); // no Coupang creds at all
    } catch {
      threw = true;
    }
    check("credentials: SOURCE=coupang + missing Coupang creds -> throws", threw, true);
  }
  {
    const { source } = parseScheduledRefreshJobEnv({
      SOURCE: "coupang",
      COUPANG_PARTNERS_ACCESS_KEY: "ck",
      COUPANG_PARTNERS_SECRET_KEY: "cs",
      CLOUD_RUN_EXECUTION: "exec-A",
      // applicationId / accessKey (Rakuten) intentionally absent
    } as any);
    check("credentials: SOURCE=coupang succeeds with Rakuten creds entirely absent", source, "coupang");
  }

  // ============================================================
  // Credentials (real code path): fetchCurrentByExternalId's actual
  // sourceId branching, not the injected-fake seam - proves the OTHER
  // source's credentials are never dereferenced, using a mocked
  // globalThis.fetch (never a real network call), same technique as
  // refreshService.test.ts's "G" adapter-boundary tests.
  // ============================================================
  {
    const listings = [makeListing({ id: "L1", sourceId: "rakuten", externalId: "rakuten-item-1", searchKeywordUsed: "kw" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    (deps as any).coupangCreds = { accessKey: undefined, secretKey: undefined }; // deliberately garbage/missing
    const fakeFetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ Items: [{ itemCode: "rakuten-item-1", itemPrice: 500, availability: 1 }] }),
      }) as unknown as Response) as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    let result: Awaited<ReturnType<typeof runScheduledRefreshJob>>;
    try {
      result = await runScheduledRefreshJob(
        deps,
        { source: "rakuten", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        makeLogCapture().log,
        undefined, // real fetchCurrentByExternalId - not the injected-fake seam
        INSTANT_SLEEP,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    check("credentials (real path): Rakuten job succeeds with garbage Coupang creds", result.outcome, "completed");
    check(
      "credentials (real path): the listing actually succeeded (real adapter branch ran, not skipped)",
      result.outcome === "completed" ? result.summary.success : null,
      1,
    );
  }
  {
    const listings = [makeListing({ id: "L1", sourceId: "coupang", externalId: "9999", searchKeywordUsed: "kw" })];
    const { deps } = makeFakeDeps({ dueListings: listings });
    (deps as any).rakutenCreds = { applicationId: undefined, accessKey: undefined }; // deliberately garbage/missing
    const fakeFetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ rCode: "0", rMessage: "", data: { landingUrl: "x", productData: [{ productId: 9999, productPrice: 1000, keyword: "kw", rank: 1, isRocket: false, isFreeShipping: false, productImage: "", productName: "n", productUrl: "u" }] } }),
        headers: { forEach: () => {} },
      }) as unknown as Response) as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    let result: Awaited<ReturnType<typeof runScheduledRefreshJob>>;
    try {
      result = await runScheduledRefreshJob(
        deps,
        { source: "coupang", runId: "exec-A", now: NOW, dueAgeMs: REFRESH_DUE_AGE_MS, leaseTtlMs: REFRESH_LEASE_TTL_MS },
        makeLogCapture().log,
        undefined,
        INSTANT_SLEEP,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    check("credentials (real path): Coupang job succeeds with garbage Rakuten creds", result.outcome, "completed");
    check(
      "credentials (real path): the listing actually succeeded",
      result.outcome === "completed" ? result.summary.success : null,
      1,
    );
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
