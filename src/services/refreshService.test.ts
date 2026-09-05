/**
 * Forwarding test for refreshApprovedListings()'s optional checkedBefore -
 * proves it passes the value straight through to
 * sourceListings.listDueForRefresh() unchanged, and that omitting it forwards
 * undefined (the admin "refresh-all" call shape, unaffected by this change).
 * No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx src/services/refreshService.test.ts
 * Exits non-zero on any failure.
 */
import { refreshApprovedListings, type RefreshDeps } from "./refreshService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function makeDeps(): { deps: RefreshDeps; calls: Array<{ sourceId: string; limit: number; checkedBefore: string | undefined }> } {
  const calls: Array<{ sourceId: string; limit: number; checkedBefore: string | undefined }> = [];
  const deps = {
    repos: {
      sourceListings: {
        listDueForRefresh: async (sourceId: string, limit: number, checkedBefore?: string) => {
          calls.push({ sourceId, limit, checkedBefore });
          return []; // empty due list - refreshApprovedListings' loop never runs, no adapter/priceHistory needed
        },
      },
      priceHistory: { append: async () => {} },
    },
    rakutenCreds: { applicationId: "x", accessKey: "y" },
    coupangCreds: { accessKey: "x", secretKey: "y" },
  } as unknown as RefreshDeps;
  return { deps, calls };
}

async function main() {
  // --- admin call shape: no checkedBefore ---
  {
    const { deps, calls } = makeDeps();
    await refreshApprovedListings(deps, { sourceId: "rakuten", limit: 50 });
    check("admin-shaped call forwards checkedBefore=undefined", calls[0].checkedBefore, undefined);
    check("admin-shaped call forwards limit", calls[0].limit, 50);
  }

  // --- scheduled Job call shape: checkedBefore provided ---
  {
    const cutoff = "2026-09-05T00:00:00.000Z";
    const { deps, calls } = makeDeps();
    await refreshApprovedListings(deps, { sourceId: "coupang", limit: 20, checkedBefore: cutoff });
    check("scheduled-shaped call forwards checkedBefore unchanged", calls[0].checkedBefore, cutoff);
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
