/**
 * Pure orchestration for one scheduled-refresh Cloud Run Job execution:
 *   validate config -> acquire lease -> compute cutoff -> refresh due
 *   listings -> aggregate outcome -> structured log -> release lease
 *
 * Deliberately separate from any environment/process concern (see
 * parseScheduledRefreshJobEnv() below for the only place that reads
 * process.env, and src/cli/index.ts's "scheduled-refresh" case for the thin
 * entrypoint that wires the two together) - runScheduledRefreshJob() takes
 * everything as arguments, the same "callable from anywhere" shape
 * refreshService.ts's own header comment already establishes for
 * refreshApprovedListings(). This is what makes it testable end-to-end with
 * fake repos/creds and no real seller API or Cloud Run environment.
 */
import { refreshApprovedListings, type RefreshOneResult, type SellerFetchFn } from "./refreshService";
import type { Repositories } from "../repository/types";
import type { RakutenCreds } from "./mappingService";
import type { CoupangCredentials } from "../adapters/coupang";

export type RefreshJobSource = "rakuten" | "coupang";

/**
 * "Refresh due" window used for checkedBefore - independent of the
 * "Scheduler runs every ~6h" cadence, which is a GCP Cloud Scheduler cron
 * expression this application never reads, so it isn't declared as a
 * constant here (nothing in code would consume it). 5.5h (not 6h) leaves
 * margin under that planned 6h cadence so a run that starts slightly late,
 * or takes a few minutes to work through its listings, doesn't push a
 * listing's next eligibility out to the following cycle - see the earlier
 * 6h-boundary/jitter design discussion this constant resolves.
 */
export const REFRESH_DUE_AGE_MS = 5.5 * 60 * 60 * 1000;

/**
 * Lease TTL - independent of the Cloud Run Job's own planned --task-timeout
 * (10m, a GCP resource setting this application never reads either). 15m
 * gives a 5-minute margin past that planned timeout: if the platform kills
 * a hung task at 10m, this lease still self-expires 5 minutes later rather
 * than blocking every future run for however long 15m - 10m leaves as slack,
 * without ever being an unbounded/"forever" lock.
 */
export const REFRESH_LEASE_TTL_MS = 15 * 60 * 1000;

export interface RefreshJobDeps {
  repos: Pick<Repositories, "sourceListings" | "priceHistory" | "refreshLease">;
  rakutenCreds: RakutenCreds;
  coupangCreds: CoupangCredentials;
}

export interface RunScheduledRefreshJobConfig {
  source: RefreshJobSource;
  /** Forwarded as-is to refreshApprovedListings()'s opts.limit - omitted
   * means that function's own default (20) applies. Validated (positive
   * integer, capped) by parseScheduledRefreshJobEnv() before it ever
   * reaches here - this function does not re-validate it. */
  limit?: number;
  /** Cloud Run's CLOUD_RUN_EXECUTION at the real entrypoint - the lease's
   * runId. Injectable here specifically so tests never depend on a real
   * Cloud Run environment. */
  runId: string;
  /** Single reference instant for this run - nowIso/checkedBefore/
   * lockedUntil are all derived from this one Date, never from separate
   * `new Date()` calls, so they can't drift apart by the few seconds this
   * function takes to reach each calculation. */
  now: Date;
  /** "refresh due" window - see SourceListingRepository.listDueForRefresh()'s
   * checkedBefore. Deliberately independent of stale_after_hours/
   * last_success_at (which this job never touches). */
  dueAgeMs: number;
  /** How long this run's lease is held before it's considered abandoned and
   * eligible for another execution to take over. */
  leaseTtlMs: number;
}

export interface RefreshJobSummary {
  total: number;
  success: number;
  notFound: number;
  hardFailure: number;
  durationMs: number;
}

export type RunScheduledRefreshJobResult =
  | { outcome: "completed"; summary: RefreshJobSummary }
  | { outcome: "skipped_lease_busy" };

function summarize(results: RefreshOneResult[], durationMs: number): RefreshJobSummary {
  // `total` is results.length, i.e. exactly the listings refreshApprovedListings()
  // actually processed (= what listDueForRefresh() selected) - there is no
  // separate "selected" count to reconcile against; a listing is only
  // absent from `results` if the whole batch threw before finishing it,
  // which already aborts this function via the caller's try/catch below,
  // never silently under-counts here.
  return {
    total: results.length,
    success: results.filter((r) => r.outcome === "success").length,
    notFound: results.filter((r) => r.outcome === "not_found").length,
    hardFailure: results.filter((r) => r.outcome === "hard_failure").length,
    durationMs,
  };
}

function describeError(err: unknown): { name: string; message: string } {
  // Never the seller error's raw response body / any credential - just
  // enough to diagnose from Cloud Logging without echoing sensitive payloads.
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "UnknownError", message: String(err) };
}

export async function runScheduledRefreshJob(
  deps: RefreshJobDeps,
  config: RunScheduledRefreshJobConfig,
  log: (event: Record<string, unknown>) => void = (event) => console.log(JSON.stringify(event)),
  /** Test seam only - forwarded to refreshApprovedListings(), which
   * defaults it to the real seller adapters when omitted. Never set by the
   * real entrypoint. */
  fetchFn?: SellerFetchFn,
): Promise<RunScheduledRefreshJobResult> {
  const nowIso = config.now.toISOString();
  const checkedBeforeIso = new Date(config.now.getTime() - config.dueAgeMs).toISOString();
  const lockedUntilIso = new Date(config.now.getTime() + config.leaseTtlMs).toISOString();

  log({ event: "started", runId: config.runId, source: config.source, limit: config.limit ?? null, checkedBefore: checkedBeforeIso });

  const acquired = await deps.repos.refreshLease.tryAcquire(config.runId, nowIso, lockedUntilIso);
  if (!acquired) {
    // Another execution's lease is still live - expected, ordinary outcome,
    // not a failure. No refresh call, no release (this run never acquired
    // anything to release).
    log({ event: "skipped", runId: config.runId, source: config.source, reason: "lease_busy" });
    return { outcome: "skipped_lease_busy" };
  }

  const startedAt = Date.now();
  let primaryError: unknown = null;
  let summary: RefreshJobSummary | null = null;

  try {
    const results = await refreshApprovedListings(
      { repos: deps.repos, rakutenCreds: deps.rakutenCreds, coupangCreds: deps.coupangCreds },
      { sourceId: config.source, limit: config.limit, checkedBefore: checkedBeforeIso },
      fetchFn,
    );
    summary = summarize(results, Date.now() - startedAt);
  } catch (err) {
    // A DB/repository/internal failure from refreshApprovedListings() - a
    // seller hard_failure never reaches here, it's already isolated inside
    // refreshOneListing() and shows up as a normal RefreshOneResult instead.
    primaryError = err;
  }

  // Release is attempted whether the batch succeeded or not - a lease this
  // run acquired must not be left held until its TTL expires just because
  // the batch itself failed. Uses a fresh timestamp (not `now` above) since
  // real time has passed while the batch ran; using the job's start time
  // here would understate when the lease was actually released, though
  // either is safe as an "already in the past" locked_until value.
  let releaseError: unknown = null;
  try {
    await deps.repos.refreshLease.release(config.runId, new Date().toISOString());
  } catch (err) {
    releaseError = err;
  }

  if (primaryError) {
    // The batch failure is the one that matters - a release failure on top
    // of it is logged for visibility but must never replace or hide the
    // original cause in what gets thrown.
    if (releaseError) {
      log({
        event: "fatal",
        runId: config.runId,
        source: config.source,
        error: describeError(primaryError),
        releaseError: describeError(releaseError),
      });
    } else {
      log({ event: "fatal", runId: config.runId, source: config.source, error: describeError(primaryError) });
    }
    throw primaryError;
  }

  if (releaseError) {
    // The batch itself succeeded, but this run still holds (or thinks it
    // holds) the lease - that must surface as a fatal Job failure so Cloud
    // Run's own task retry kicks in. A retry sharing the same
    // CLOUD_RUN_EXECUTION can still reacquire this same lease (tryAcquire's
    // run_id=runId branch), so it is not permanently blocked by this.
    log({ event: "fatal", runId: config.runId, source: config.source, phase: "release", error: describeError(releaseError) });
    throw releaseError;
  }

  log({ event: "completed", runId: config.runId, source: config.source, ...summary! });
  return { outcome: "completed", summary: summary! };
}

/**
 * The only place that reads process.env for this Job - kept separate from
 * runScheduledRefreshJob() so config validation is testable without a real
 * Cloud Run environment, and so an invalid SOURCE/LIMIT fails before any
 * lease/repository/seller call ever happens (the real entrypoint calls this
 * first, and only calls runScheduledRefreshJob() if it returns normally).
 */
export function parseScheduledRefreshJobEnv(env: NodeJS.ProcessEnv): {
  source: RefreshJobSource;
  limit: number | undefined;
  runId: string;
} {
  const source = env.SOURCE;
  if (source !== "rakuten" && source !== "coupang") {
    throw new Error(`SOURCE must be "rakuten" or "coupang", got: ${JSON.stringify(source)}`);
  }

  let limit: number | undefined;
  const limitRaw = env.LIMIT;
  if (limitRaw !== undefined && limitRaw !== "") {
    // Deliberately strict: digits only, no leading zero games, no "+"/"-",
    // no whitespace, no scientific notation - Number()/parseInt() would
    // silently accept several of those.
    const MAX_LIMIT = 500; // generous relative to the current ~20/source scale - guards against a fat-fingered env var producing an unbounded query, not a real capacity plan
    if (!/^[1-9][0-9]*$/.test(limitRaw)) {
      throw new Error(`LIMIT must be a positive integer, got: ${JSON.stringify(limitRaw)}`);
    }
    limit = Number(limitRaw);
    if (limit > MAX_LIMIT) {
      throw new Error(`LIMIT must be <= ${MAX_LIMIT}, got: ${limit}`);
    }
  }

  const runId = env.CLOUD_RUN_EXECUTION;
  if (!runId) {
    throw new Error("CLOUD_RUN_EXECUTION is required (Cloud Run Jobs set this automatically at runtime)");
  }

  return { source, limit, runId };
}
