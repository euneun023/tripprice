/**
 * Static text checks for 0008_refresh_lock.sql - this migration must touch
 * ONLY the new refresh_lock table, seed exactly its one singleton row, and
 * contain no destructive statement against anything else. No test runner is
 * configured in this repo (see web/app/admin/lib/priceGrade.test.ts for the
 * existing plain-assertion convention this follows) - run directly:
 *   npx tsx "supabase/migrations/0008_refresh_lock.static.test.ts"
 * Exits non-zero on any failure.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Root package.json is "type": "module" (unlike web/, which is CJS and can
// use __dirname directly) - this is the ESM equivalent.
const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const source = readFileSync(join(__dirname, "0008_refresh_lock.sql"), "utf-8");
// Strip line comments so keyword checks below can't be fooled by a
// statement name only appearing inside prose (e.g. this file's own header
// comment mentions "UPDATE"/"DELETE" in English prose).
const codeOnly = source
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const codeLower = codeOnly.toLowerCase();

check("creates exactly one table: refresh_lock", (codeLower.match(/create table/g) ?? []).length, 1);
check("the created table is refresh_lock", /create table\s+refresh_lock/i.test(codeOnly), true);

const otherKnownTables = [
  "canonical_products",
  "product_variants",
  "source_listings",
  "price_history",
  "fx_rates",
  "affiliate_programs",
  "sources",
  "review_actions",
];
for (const table of otherKnownTables) {
  check(`does not reference existing table "${table}"`, codeLower.includes(table), false);
}

check("no alter table statement", codeLower.includes("alter table"), false);
check("no drop statement", codeLower.includes("drop "), false);
check("no delete statement", codeLower.includes("delete "), false);
check("no update statement (this migration only inserts the seed row)", codeLower.includes("update "), false);
check("no truncate statement", codeLower.includes("truncate"), false);
check("no migration-history manipulation (supabase_migrations)", codeLower.includes("supabase_migrations"), false);

check("seeds exactly one row", (codeLower.match(/insert into refresh_lock/g) ?? []).length, 1);
check("seed uses id='singleton'", /values\s*\(\s*'singleton'/i.test(codeOnly), true);

check("id column has a singleton CHECK constraint", /check\s*\(\s*id\s*=\s*'singleton'\s*\)/i.test(codeOnly), true);

check("no explicit grant statement (relies on 0003's default-privileges grant)", codeLower.includes("grant "), false);
check("no RLS enable statement (matches the rest of this schema - see the file's own header comment)", codeLower.includes("row level security"), false);
check("no policy created", codeLower.includes("create policy"), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
