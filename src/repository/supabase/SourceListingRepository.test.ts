/**
 * Query-construction + behavior tests for listDueForRefresh()'s optional
 * checkedBefore cutoff. No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx src/repository/supabase/SourceListingRepository.test.ts
 * Exits non-zero on any failure.
 *
 * The fake DB below is a minimal in-file stand-in for the supabase-js
 * query-builder chain (not a mocking library) - just enough to (a) record
 * which filter calls listDueForRefresh() makes, so scenario A can prove the
 * call shape is byte-for-byte unchanged when checkedBefore is omitted, and
 * (b) apply the exact WHERE semantics (eq/or) the real query would, so
 * scenario B can prove NULL/old/recent rows land on the right side of the
 * filter.
 */
import { SupabaseSourceListingRepository } from "./SourceListingRepository";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

type Call = { method: string; args: unknown[] };

function makeFakeDb(rows: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  let filtered = rows;
  const builder = {
    select: () => {
      calls.push({ method: "select", args: [] });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    or: (expr: string) => {
      calls.push({ method: "or", args: [expr] });
      // Only understands the exact shape SourceListingRepository emits -
      // "last_checked_at.is.null,last_checked_at.lt.<iso>" - not a general
      // PostgREST filter parser.
      const m = expr.match(/^last_checked_at\.is\.null,last_checked_at\.lt\.(.+)$/);
      if (!m) throw new Error(`fake .or() doesn't understand: ${expr}`);
      const cutoff = m[1];
      filtered = filtered.filter((r) => r.last_checked_at === null || (r.last_checked_at as string) < cutoff);
      return builder;
    },
    order: (...args: unknown[]) => {
      calls.push({ method: "order", args });
      return builder;
    },
    limit: (n: number) => {
      calls.push({ method: "limit", args: [n] });
      return Promise.resolve({ data: filtered.slice(0, n), error: null });
    },
  };
  const db = { from: (table: string) => { calls.push({ method: "from", args: [table] }); return builder; } } as any;
  return { db, calls };
}

async function main() {
  // --- A: checkedBefore omitted - call shape must be identical to before this change ---
  {
    const { db, calls } = makeFakeDb([{ id: "x", source_id: "rakuten", is_active: true, last_checked_at: "2020-01-01T00:00:00.000Z" }]);
    const repo = new SupabaseSourceListingRepository(db);
    const result = await repo.listDueForRefresh("rakuten", 50);
    check(
      "A: call sequence unchanged (no .or())",
      calls.map((c) => c.method),
      ["from", "select", "eq", "eq", "order", "limit"],
    );
    check("A: eq(source_id, ...)", calls[2], { method: "eq", args: ["source_id", "rakuten"] });
    check("A: eq(is_active, true)", calls[3], { method: "eq", args: ["is_active", true] });
    check("A: order(last_checked_at asc nulls first)", calls[4], {
      method: "order",
      args: ["last_checked_at", { ascending: true, nullsFirst: true }],
    });
    check("A: limit(50)", calls[5], { method: "limit", args: [50] });
    check("A: recently-checked listing still included (admin semantics preserved)", result.length, 1);
  }

  // --- B: checkedBefore provided - NULL/old/recent listings ---
  {
    const cutoff = "2026-09-05T00:00:00.000Z";
    const rows = [
      { id: "never-checked", source_id: "coupang", is_active: true, last_checked_at: null },
      { id: "old", source_id: "coupang", is_active: true, last_checked_at: "2026-09-01T00:00:00.000Z" },
      { id: "recent", source_id: "coupang", is_active: true, last_checked_at: "2026-09-05T12:00:00.000Z" },
    ];
    const { db, calls } = makeFakeDb(rows);
    const repo = new SupabaseSourceListingRepository(db);
    const result = await repo.listDueForRefresh("coupang", 20, cutoff);

    check("B: .or() called exactly once", calls.filter((c) => c.method === "or").length, 1);
    const orCall = calls.find((c) => c.method === "or");
    check("B: .or() filter is NULL-inclusive", orCall?.args[0], `last_checked_at.is.null,last_checked_at.lt.${cutoff}`);

    const resultIds = result.map((r) => r.id).sort();
    check("B: never-checked (NULL) listing included", resultIds.includes("never-checked"), true);
    check("B: old listing included", resultIds.includes("old"), true);
    check("B: recent listing excluded", resultIds.includes("recent"), false);
    check("B: exactly 2 due listings", resultIds, ["never-checked", "old"]);
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
