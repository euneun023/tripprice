import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefreshLeaseRepository } from "../types";

const SINGLETON_ID = "singleton";

/**
 * runId (Cloud Run's CLOUD_RUN_EXECUTION at call sites, once the Job
 * entrypoint exists) is interpolated into a raw PostgREST .or() filter
 * string below - GCP's public docs don't publish an explicit character-class
 * guarantee for execution names, so this is validated defensively rather
 * than trusted, matching the general GCP/Kubernetes resource-name
 * convention (letters, digits, '-', '_') with generous length slack. This
 * is not a stand-in for accepting arbitrary caller-supplied strings - it
 * exists specifically so a comma/paren/quote can never reach the filter
 * string, whatever produced it. Applied identically in both acquire and
 * release - neither path trusts an unvalidated runId in a query.
 */
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,200}$/;

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(`refresh_lock: runId has an unexpected format, refusing to use it in a query: ${JSON.stringify(runId)}`);
  }
}

/**
 * Parses `value` as a timestamp and returns its canonical Date.toISOString()
 * form - never the caller's original string verbatim. This is what actually
 * reaches the .or() filter string below, not raw input: toISOString()'s
 * output is a fixed format (digits, '-', ':', '.', 'T', 'Z' only), so this
 * also structurally rules out a comma/paren ever reaching that filter,
 * independent of whatever the caller originally passed. Not a
 * blacklist/replace - an invalid timestamp fails to parse and throws before
 * any query is built.
 */
function canonicalIso(label: string, value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`refresh_lock: ${label} is not a valid timestamp: ${JSON.stringify(value)}`);
  }
  return d.toISOString();
}

export class SupabaseRefreshLeaseRepository implements RefreshLeaseRepository {
  constructor(private db: SupabaseClient) {}

  async tryAcquire(runId: string, now: string, lockedUntil: string): Promise<boolean> {
    assertSafeRunId(runId);
    const nowIso = canonicalIso("now", now);
    const lockedUntilIso = canonicalIso("lockedUntil", lockedUntil);
    if (new Date(lockedUntilIso).getTime() <= new Date(nowIso).getTime()) {
      throw new Error(
        `refresh_lock: lockedUntil (${lockedUntilIso}) must be after now (${nowIso}) - a lease that starts already expired is never valid`,
      );
    }

    const { data, error } = await this.db
      .from("refresh_lock")
      .update({ run_id: runId, locked_at: nowIso, locked_until: lockedUntilIso })
      .eq("id", SINGLETON_ID)
      .or(`locked_until.is.null,locked_until.lt.${nowIso},run_id.eq.${runId}`)
      .select();
    if (error) throw error;
    if ((data ?? []).length > 0) return true;

    // The conditional UPDATE matched 0 rows. That's ordinary, expected
    // contention (another run's lease is still live) ONLY if the singleton
    // row actually exists - nothing in this schema guarantees it always
    // does (no DELETE-blocking trigger; see 0008_refresh_lock.sql's own
    // comment). Acquisition itself was already decided atomically above -
    // this read-only SELECT exists purely to tell those two cases apart, so
    // a genuinely missing/misconfigured table surfaces as a loud error
    // instead of silently looking like permanent lock contention (which
    // would make a future scheduled Job skip every run forever).
    const { data: existsData, error: existsError } = await this.db.from("refresh_lock").select("id").eq("id", SINGLETON_ID);
    if (existsError) throw existsError;
    if ((existsData ?? []).length === 0) {
      throw new Error(
        "refresh_lock: singleton row does not exist - is migration 0008_refresh_lock.sql applied against this database?",
      );
    }
    return false;
  }

  async release(runId: string, now: string): Promise<void> {
    assertSafeRunId(runId);
    const nowIso = canonicalIso("now", now);
    const { error } = await this.db
      .from("refresh_lock")
      .update({ locked_until: nowIso })
      .eq("id", SINGLETON_ID)
      .eq("run_id", runId);
    if (error) throw error;
  }
}
