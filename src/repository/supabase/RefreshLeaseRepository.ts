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
 * string, whatever produced it.
 */
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,200}$/;

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(`refresh_lock: runId has an unexpected format, refusing to use it in a query: ${JSON.stringify(runId)}`);
  }
}

export class SupabaseRefreshLeaseRepository implements RefreshLeaseRepository {
  constructor(private db: SupabaseClient) {}

  async tryAcquire(runId: string, now: string, lockedUntil: string): Promise<boolean> {
    assertSafeRunId(runId);
    const { data, error } = await this.db
      .from("refresh_lock")
      .update({ run_id: runId, locked_at: now, locked_until: lockedUntil })
      .eq("id", SINGLETON_ID)
      .or(`locked_until.is.null,locked_until.lt.${now},run_id.eq.${runId}`)
      .select();
    if (error) throw error;
    // 0 rows matched the WHERE clause (another run's lease is still live) -
    // an ordinary, expected outcome, not a database error.
    return (data ?? []).length > 0;
  }

  async release(runId: string, now: string): Promise<void> {
    assertSafeRunId(runId);
    const { error } = await this.db
      .from("refresh_lock")
      .update({ locked_until: now })
      .eq("id", SINGLETON_ID)
      .eq("run_id", runId);
    if (error) throw error;
  }
}
