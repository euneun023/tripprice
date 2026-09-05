/**
 * Behavior tests for the refresh_lock duplicate-run guard's atomic
 * acquire/release. No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx src/repository/supabase/RefreshLeaseRepository.test.ts
 * Exits non-zero on any failure.
 *
 * The fake DB below is a minimal in-file stand-in for the supabase-js
 * query-builder chain (not a mocking library) - it holds at most one
 * in-memory row (the refresh_lock singleton, or `null` to simulate the row
 * being missing entirely - the schema's CHECK constraint only guarantees AT
 * MOST one row, never that one always exists) and actually evaluates the
 * .eq()/.or() filters SupabaseRefreshLeaseRepository sends, the same way
 * the earlier SourceListingRepository.test.ts fake does, so these tests
 * prove real WHERE-clause behavior rather than just "the right method was
 * called". `failOnCallNumber` fails exactly the Nth query issued against
 * this fake (1-indexed) - lets a test make tryAcquire()'s first query (the
 * conditional UPDATE) succeed normally while its second query (the
 * diagnostic existence SELECT, only issued on a 0-row UPDATE) fails, or
 * vice versa.
 */
import { SupabaseRefreshLeaseRepository } from "./RefreshLeaseRepository";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

interface LockRow {
  id: string;
  run_id: string | null;
  locked_at: string | null;
  locked_until: string | null;
}

function makeFakeDb(initialRow: LockRow | null, opts: { failOnCallNumber?: number } = {}) {
  let row: LockRow | null = initialRow ? { ...initialRow } : null;
  let callCount = 0;

  const db = {
    from: (_table: string) => {
      let patch: Record<string, unknown> | null = null;
      let eqFilters: Array<[string, unknown]> = [];
      let orExpr: string | null = null;

      const matches = (): boolean => {
        if (row === null) return false;
        const eqOk = eqFilters.every(([col, val]) => (row as any)[col] === val);
        if (!eqOk) return false;
        if (orExpr === null) return true;
        // Only understands the exact shape SupabaseRefreshLeaseRepository
        // emits: "locked_until.is.null,locked_until.lt.<iso>,run_id.eq.<id>"
        const parts = orExpr.split(",");
        return parts.some((p) => {
          const m1 = p.match(/^locked_until\.is\.null$/);
          if (m1) return row!.locked_until === null;
          const m2 = p.match(/^locked_until\.lt\.(.+)$/);
          if (m2) return row!.locked_until !== null && row!.locked_until < m2[1];
          const m3 = p.match(/^run_id\.eq\.(.+)$/);
          if (m3) return row!.run_id === m3[1];
          throw new Error(`fake .or() doesn't understand clause: ${p}`);
        });
      };

      const execute = (): { data: LockRow[] | null; error: { message: string } | null } => {
        callCount++;
        if (opts.failOnCallNumber === callCount) {
          return { data: null, error: { message: "simulated database error" } };
        }
        if (!matches()) return { data: [], error: null };
        if (patch) row = { ...(row as LockRow), ...patch };
        return { data: [{ ...(row as LockRow) }], error: null };
      };

      const builder: any = {
        update: (p: Record<string, unknown>) => {
          patch = p;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          eqFilters.push([col, val]);
          return builder;
        },
        or: (expr: string) => {
          orExpr = expr;
          return builder;
        },
        select: (..._cols: string[]) => builder,
        then: (onFulfilled: any, onRejected: any) => Promise.resolve(execute()).then(onFulfilled, onRejected),
      };
      return builder;
    },
  } as any;

  return { db, getRow: () => (row ? { ...row } : null) };
}

async function main() {
  // ============================================================
  // acquire: unlocked -> true
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    const acquired = await repo.tryAcquire("exec-A", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    check("unlocked -> acquired=true", acquired, true);
    check("unlocked -> run_id set", getRow()!.run_id, "exec-A");
    check("unlocked -> locked_until set", getRow()!.locked_until, "2026-09-06T00:15:00.000Z");
  }

  // ============================================================
  // acquire: expired -> true
  // ============================================================
  {
    const { db } = makeFakeDb({
      id: "singleton",
      run_id: "exec-OLD",
      locked_at: "2026-09-05T00:00:00.000Z",
      locked_until: "2026-09-05T00:15:00.000Z", // well in the past relative to `now` below
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    const acquired = await repo.tryAcquire("exec-B", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    check("expired lease -> acquired=true", acquired, true);
  }

  // ============================================================
  // acquire: same runId + unexpired -> true (retry/renew)
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z", // still in the future
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    const acquired = await repo.tryAcquire("exec-A", "2026-09-06T00:05:00.000Z", "2026-09-06T00:20:00.000Z");
    check("same runId, unexpired -> acquired=true (renew)", acquired, true);
    check("renew extends locked_until", getRow()!.locked_until, "2026-09-06T00:20:00.000Z");
  }

  // ============================================================
  // acquire: different runId, singleton exists and is actively held -> false
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z",
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    const acquired = await repo.tryAcquire("exec-B", "2026-09-06T00:05:00.000Z", "2026-09-06T00:20:00.000Z");
    check("different runId, active lease -> acquired=false (ordinary contention)", acquired, false);
    check("row untouched by failed acquisition", getRow()!.run_id, "exec-A");
  }

  // ============================================================
  // errors: DB error on the conditional UPDATE itself -> throws (not false)
  // ============================================================
  {
    const { db } = makeFakeDb(
      { id: "singleton", run_id: null, locked_at: null, locked_until: null },
      { failOnCallNumber: 1 },
    );
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    } catch {
      threw = true;
    }
    check("DB error on acquire's UPDATE -> throws (not false)", threw, true);
  }

  // ============================================================
  // missing-singleton invariant: conditional UPDATE matches 0 rows because
  // the table is EMPTY (not because someone else holds a valid lease) ->
  // the diagnostic SELECT also finds nothing -> throws a clear invariant
  // error, never silently returns false forever.
  // ============================================================
  {
    const { db } = makeFakeDb(null); // no row at all - as if 0008 was never applied, or the row was deleted
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    let message = "";
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("missing singleton row -> throws", threw, true);
    check("missing singleton row -> error mentions the invariant, not ordinary contention", message.includes("singleton row does not exist"), true);
  }

  // ============================================================
  // missing-singleton diagnosis: the diagnostic SELECT itself fails -> that
  // DB error propagates too (never silently treated as "row missing" or
  // "false")
  // ============================================================
  {
    // Call 1 (the conditional UPDATE) succeeds normally but matches 0 rows
    // (a different, still-active runId holds it) - call 2 (the diagnostic
    // existence SELECT that 0-row result triggers) is the one that fails.
    const { db } = makeFakeDb(
      { id: "singleton", run_id: "exec-OTHER", locked_at: "2026-09-06T00:00:00.000Z", locked_until: "2026-09-06T00:15:00.000Z" },
      { failOnCallNumber: 2 },
    );
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:05:00.000Z", "2026-09-06T00:20:00.000Z");
    } catch {
      threw = true;
    }
    check("diagnostic SELECT DB error -> throws", threw, true);
  }

  // ============================================================
  // timestamp validation: valid ISO -> normal behavior, unaffected
  // ============================================================
  {
    const { db } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    const acquired = await repo.tryAcquire("exec-A", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    check("valid ISO timestamps -> acquire proceeds normally", acquired, true);
  }

  // ============================================================
  // timestamp validation: invalid `now` -> throws before any query
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec-A", "not-a-timestamp", "2026-09-06T00:15:00.000Z");
    } catch {
      threw = true;
    }
    check("invalid now -> throws", threw, true);
    check("invalid now -> no query reached the DB (row untouched)", getRow()!.run_id, null);
  }

  // ============================================================
  // timestamp validation: invalid `lockedUntil` -> throws before any query
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:00:00.000Z", "also-not-a-timestamp");
    } catch {
      threw = true;
    }
    check("invalid lockedUntil -> throws", threw, true);
    check("invalid lockedUntil -> no query reached the DB (row untouched)", getRow()!.run_id, null);
  }

  // ============================================================
  // timestamp validation: lockedUntil <= now -> throws (a lease that starts
  // already expired is never valid)
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:15:00.000Z", "2026-09-06T00:15:00.000Z"); // equal, not after
    } catch {
      threw = true;
    }
    check("lockedUntil == now -> throws", threw, true);
    check("lockedUntil == now -> no query reached the DB", getRow()!.run_id, null);

    let threw2 = false;
    try {
      await repo.tryAcquire("exec-A", "2026-09-06T00:15:00.000Z", "2026-09-06T00:10:00.000Z"); // before now
    } catch {
      threw2 = true;
    }
    check("lockedUntil before now -> throws", threw2, true);
  }

  // ============================================================
  // release: owner release succeeds
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z",
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    await repo.release("exec-A", "2026-09-06T00:10:00.000Z");
    check("owner release -> locked_until set to release time", getRow()!.locked_until, "2026-09-06T00:10:00.000Z");
    check("owner release -> run_id left as last owner (not cleared)", getRow()!.run_id, "exec-A");
  }

  // ============================================================
  // release: non-owner release is a no-op
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-B",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z",
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    await repo.release("exec-A", "2026-09-06T00:10:00.000Z"); // exec-A never held it
    check("non-owner release -> lease untouched", getRow()!.locked_until, "2026-09-06T00:15:00.000Z");
    check("non-owner release -> run_id untouched", getRow()!.run_id, "exec-B");
  }

  // ============================================================
  // release: DB error -> throw
  // ============================================================
  {
    const { db } = makeFakeDb(
      { id: "singleton", run_id: "exec-A", locked_at: null, locked_until: null },
      { failOnCallNumber: 1 },
    );
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.release("exec-A", "2026-09-06T00:10:00.000Z");
    } catch {
      threw = true;
    }
    check("DB error on release -> throws", threw, true);
  }

  // ============================================================
  // race: expired A -> B acquires -> A's late release must NOT clear B's lease
  // ============================================================
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-05T23:00:00.000Z",
      locked_until: "2026-09-05T23:15:00.000Z", // already expired by the time B looks
    });
    const repo = new SupabaseRefreshLeaseRepository(db);

    const bAcquired = await repo.tryAcquire("exec-B", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    check("race: B acquires A's expired lease", bAcquired, true);

    // A finally gets around to releasing what it thinks is still its lease.
    await repo.release("exec-A", "2026-09-06T00:01:00.000Z");

    check("race: A's late release did not touch B's lease (run_id still B)", getRow()!.run_id, "exec-B");
    check("race: A's late release did not touch B's locked_until", getRow()!.locked_until, "2026-09-06T00:15:00.000Z");
  }

  // ============================================================
  // retry: same execution's task attempt 1 renews after attempt 0 died
  // without releasing, and a different concurrent execution is still blocked
  // ============================================================
  {
    const { db: dbForA, getRow: rowForA } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z", // attempt 0's lease, not yet expired
    });
    const repoA = new SupabaseRefreshLeaseRepository(dbForA);
    const attempt1Acquired = await repoA.tryAcquire("exec-A", "2026-09-06T00:02:00.000Z", "2026-09-06T00:17:00.000Z");
    check("retry: same execution's attempt 1 reacquires its own lease", attempt1Acquired, true);
    check("retry: lease renewed to the new locked_until", rowForA()!.locked_until, "2026-09-06T00:17:00.000Z");

    const { db: dbForC } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z",
    });
    const repoC = new SupabaseRefreshLeaseRepository(dbForC);
    const otherExecutionAcquired = await repoC.tryAcquire("exec-C", "2026-09-06T00:02:00.000Z", "2026-09-06T00:17:00.000Z");
    check("retry: a different concurrent execution is blocked at the same instant", otherExecutionAcquired, false);
  }

  // ============================================================
  // runId format guard: never interpolates an unexpected value into the
  // filter string unchecked - applies to BOTH acquire and release
  // ============================================================
  {
    const { db } = makeFakeDb({ id: "singleton", run_id: null, locked_at: null, locked_until: null });
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.tryAcquire("exec,evil)or(1=1", "2026-09-06T00:00:00.000Z", "2026-09-06T00:15:00.000Z");
    } catch {
      threw = true;
    }
    check("unexpected runId format is rejected before querying (acquire)", threw, true);
  }
  {
    const { db, getRow } = makeFakeDb({
      id: "singleton",
      run_id: "exec-A",
      locked_at: "2026-09-06T00:00:00.000Z",
      locked_until: "2026-09-06T00:15:00.000Z",
    });
    const repo = new SupabaseRefreshLeaseRepository(db);
    let threw = false;
    try {
      await repo.release("exec,evil)or(1=1", "2026-09-06T00:10:00.000Z");
    } catch {
      threw = true;
    }
    check("unexpected runId format is rejected before querying (release)", threw, true);
    check("rejected release runId -> lease untouched", getRow()!.run_id, "exec-A");
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
