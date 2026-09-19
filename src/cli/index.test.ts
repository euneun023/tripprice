/**
 * Proves search-rakuten/search-coupang never call createRepos() (so they
 * never need SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) and never call the real
 * seller APIs, while a DB-dependent command (compare) still does call
 * createRepos(). No test runner configured in this repo - run directly:
 *   npx tsx src/cli/index.test.ts
 * Exits non-zero on any failure.
 */
import { main } from "./index";
import type { RakutenItem } from "../adapters/rakuten";
import type { CoupangProduct } from "../adapters/coupang";
import type { Repositories } from "../repository/types";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  OK: ${message}`);
}

async function testSearchCoupangNeverInitsRepos() {
  console.log("=== search-coupang: never calls createRepos, never needs Supabase ===");
  process.argv = ["node", "src/cli/index.ts", "search-coupang", "--keyword=test"];
  let searchCoupangCalled = false;
  await main({
    createRepos: (): Repositories => {
      throw new Error("createRepos should never be called for search-coupang");
    },
    searchCoupang: async (): Promise<CoupangProduct[]> => {
      searchCoupangCalled = true;
      return [];
    },
  });
  assert(searchCoupangCalled, "the injected searchCoupang was actually invoked");
}

async function testSearchRakutenNeverInitsRepos() {
  console.log("=== search-rakuten: never calls createRepos, never needs Supabase ===");
  process.argv = ["node", "src/cli/index.ts", "search-rakuten", "--keyword=test"];
  let searchRakutenCalled = false;
  await main({
    createRepos: (): Repositories => {
      throw new Error("createRepos should never be called for search-rakuten");
    },
    searchRakuten: async (): Promise<RakutenItem[]> => {
      searchRakutenCalled = true;
      return [];
    },
  });
  assert(searchRakutenCalled, "the injected searchRakuten was actually invoked");
}

async function testDbDependentCommandStillInitsRepos() {
  console.log("=== compare (DB-dependent): still calls createRepos ===");
  process.argv = ["node", "src/cli/index.ts", "compare", "--variant=fake-variant-id"];
  let createReposCalled = false;
  const fakeRepos = {
    sourceListings: { listByVariant: async () => [] },
  } as unknown as Repositories;
  await main({
    createRepos: (): Repositories => {
      createReposCalled = true;
      return fakeRepos;
    },
  });
  assert(createReposCalled, "createRepos WAS called for a DB-dependent command");
}

async function run() {
  await testSearchCoupangNeverInitsRepos();
  await testSearchRakutenNeverInitsRepos();
  await testDbDependentCommandStillInitsRepos();
  console.log("\nAll CLI DB-independence tests passed.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
