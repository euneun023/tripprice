/**
 * Turns Rakuten 商品価格ナビ product rows into CandidateSeed records - the
 * exact shape evaluate-candidates.ts already consumes
 * (src/scripts/sample-data/candidate-seed.example.json). This is the step
 * that replaces hand-typing seed files, which is what currently caps the
 * catalog at ~100 products.
 *
 * WHY THE SHAPE MATTERS: nothing downstream changes. The output drops into
 * the existing semi-automatic flow (search candidates -> human approves ->
 * source_listing), so this script widens the TOP of the funnel without
 * touching the approval discipline docs/phase1-design.md §4 deliberately
 * put in place. It does not create mappings, write to any database, or
 * decide that two products are the same thing.
 *
 * WHAT IT DELIBERATELY WILL NOT DO:
 *   - It never emits a seed without a manufacturer model number. A product
 *     with no `productNo` is dropped with a reason, never seeded on its
 *     product NAME alone - name-based identity is exactly what the design
 *     doc rules out as an automatic decision.
 *   - It never invents a productType. Rakuten genre ids do not map cleanly
 *     onto this project's productTypes (which gate category-specific review
 *     rules), so the caller states it explicitly per sweep.
 *   - It reuses isSkuLikeModelSku() from evaluate-candidates.ts rather than
 *     re-deriving "does this look like a SKU", so a seed this script emits
 *     behaves in the downstream search exactly as a hand-written one would.
 *
 * STATUS: the pure functions below are unit-tested
 * (seed-catalog-from-rakuten.test.ts). The live sweep depends on
 * adapters/rakutenProduct.ts, whose field names are UNVERIFIED until
 * `npm run verify:rakuten-product` has been run once - in particular
 * whether `productNo` is populated at all. Run that first; if productNo
 * coverage turns out to be near zero, this script's premise is wrong and
 * the catalog needs a different identifier source (see
 * docs/data-sources-research-2026-11.md §2.2: 코리안넷 / Icecat).
 *
 * Run:
 *   npx tsx src/scripts/seed-catalog-from-rakuten.ts --genre 564500 --product-type camera
 *     (dry run: prints the plan, makes no call)
 *   npx tsx src/scripts/seed-catalog-from-rakuten.ts --genre 564500 --product-type camera --pages 3 --live
 *   ... --live --out /tmp/camera.seed.json
 */
import "dotenv/config";
import { writeFileSync, existsSync } from "node:fs";
import {
  searchRakutenProduct,
  extractMatchKey,
  RakutenProductApiError,
  RAKUTEN_PRODUCT_MAX_HITS,
  RAKUTEN_PRODUCT_MAX_PAGE,
  type RakutenProduct,
} from "../adapters/rakutenProduct";
import { isSkuLikeModelSku, type CandidateSeed } from "./evaluate-candidates";

// ---------------------------------------------------------------------------
// Pure transforms (unit-tested; no network, no filesystem)
// ---------------------------------------------------------------------------

export type RejectReason =
  | "no_model_no"
  | "no_maker_name"
  | "model_not_sku_like"
  | "duplicate_product_id"
  | "duplicate_model_key"
  | "no_product_name";

export interface RejectedRow {
  reason: RejectReason;
  productId: string | null;
  productName: string | null;
  modelNo: string | null;
}

export interface SeedBatch {
  seeds: CandidateSeed[];
  rejected: RejectedRow[];
  stats: {
    inputRows: number;
    seeded: number;
    rejectedByReason: Record<RejectReason, number>;
    /** share of input rows that produced a seed, 0-100 with one decimal */
    seedYieldPct: number;
  };
}

/**
 * Dedupe key for "same product, listed twice". Case-insensitive and
 * whitespace-collapsed, but hyphens and suffixes are PRESERVED: per
 * scripts/lib/identifierMatch.ts, a one-character suffix difference
 * ("DC-S5M2" vs "DC-S5M2W") is a genuinely different SKU/kit, and
 * collapsing them would merge two real products into one seed.
 */
export function normalizeModelKey(brand: string, modelNo: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(brand)}|${norm(modelNo)}`;
}

/**
 * Which of two rows for the same product is the better seed source. Prefers
 * the row that carries more KNOWN data, because the reported 2026-03-25
 * field emptying means two rows for one product can differ only in how much
 * is null. Never prefers a row on price value (cheaper/pricier is not a
 * data-quality signal).
 */
export function preferRow(a: RakutenProduct, b: RakutenProduct): RakutenProduct {
  const score = (p: RakutenProduct) =>
    (p.salesItemCount !== null ? 2 : 0) +
    (p.salesMinPrice !== null ? 1 : 0) +
    (p.productCode !== null ? 1 : 0) +
    (p.mediumImageUrl !== null ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * Builds seeds from raw product rows. Order of checks is deliberate: identity
 * problems (no name/model/maker) are reported before duplication, so a row is
 * never reported as a "duplicate" of something that was itself unusable.
 */
export function buildSeedBatch(rows: RakutenProduct[], productType: string): SeedBatch {
  const rejected: RejectedRow[] = [];
  const seenProductIds = new Set<string>();
  /** model key -> the winning row so far */
  const byModelKey = new Map<string, RakutenProduct>();

  const reject = (reason: RejectReason, p: RakutenProduct, modelNo: string | null = p.productNo) =>
    rejected.push({ reason, productId: p.productId, productName: p.productName, modelNo });

  for (const row of rows) {
    if (row.productId !== null) {
      if (seenProductIds.has(row.productId)) {
        reject("duplicate_product_id", row);
        continue;
      }
      seenProductIds.add(row.productId);
    }

    if (!row.productName) {
      reject("no_product_name", row);
      continue;
    }

    const key = extractMatchKey(row);
    if (key === null) {
      // extractMatchKey needs BOTH; report which one is actually missing so a
      // low yield can be diagnosed from the report alone.
      reject(row.productNo ? "no_maker_name" : "no_model_no", row);
      continue;
    }

    if (!isSkuLikeModelSku(key.modelNo)) {
      // Not an error - e.g. a focal-length string. It just cannot carry the
      // KR-side identity match, so it is not seeded.
      reject("model_not_sku_like", row, key.modelNo);
      continue;
    }

    const modelKey = normalizeModelKey(key.brand, key.modelNo);
    const existing = byModelKey.get(modelKey);
    if (existing) {
      const winner = preferRow(existing, row);
      byModelKey.set(modelKey, winner);
      reject("duplicate_model_key", winner === row ? existing : row, key.modelNo);
      continue;
    }
    byModelKey.set(modelKey, row);
  }

  const seeds: CandidateSeed[] = [...byModelKey.values()].map((p) => ({
    productName: p.productName!,
    brand: p.makerName!,
    productType,
    modelSkuHint: p.productNo,
  }));

  const rejectedByReason: Record<RejectReason, number> = {
    no_model_no: 0,
    no_maker_name: 0,
    model_not_sku_like: 0,
    duplicate_product_id: 0,
    duplicate_model_key: 0,
    no_product_name: 0,
  };
  for (const r of rejected) rejectedByReason[r.reason]++;

  return {
    seeds,
    rejected,
    stats: {
      inputRows: rows.length,
      seeded: seeds.length,
      rejectedByReason,
      seedYieldPct: rows.length === 0 ? 0 : Math.round((seeds.length / rows.length) * 1000) / 10,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface SweepArgs {
  genreId: string;
  productType: string;
  pages: number;
  live: boolean;
  out: string | null;
  force: boolean;
}

/** Pure arg parsing so the CLI contract is testable without spawning a process. */
export function parseArgs(argv: string[]): { args: SweepArgs } | { error: string } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

  const genreId = get("--genre");
  if (!genreId) return { error: "--genre <genreId> is required" };

  const productType = get("--product-type");
  if (!productType) {
    return {
      error:
        "--product-type <type> is required - Rakuten genres do not map onto this project's " +
        "productTypes (which gate category-specific review rules), so it must be stated explicitly",
    };
  }

  const pagesRaw = get("--pages");
  const pages = pagesRaw === null ? 1 : Number(pagesRaw);
  if (!Number.isInteger(pages) || pages < 1 || pages > RAKUTEN_PRODUCT_MAX_PAGE) {
    return { error: `--pages must be an integer 1..${RAKUTEN_PRODUCT_MAX_PAGE} (got ${pagesRaw})` };
  }

  return {
    args: {
      genreId,
      productType,
      pages,
      live: argv.includes("--live"),
      out: get("--out"),
      force: argv.includes("--force"),
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Rakuten apps are registered at 1 QPS; the docs warn about rapid repeats. */
const PACING_MS = 1100;

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`Argument error: ${parsed.error}`);
    process.exit(1);
  }
  const { genreId, productType, pages, live, out, force } = parsed.args;

  console.log("=== Rakuten genre sweep -> CandidateSeed ===");
  console.log(`  genreId     : ${genreId}`);
  console.log(`  productType : ${productType}`);
  console.log(`  pages       : ${pages} x ${RAKUTEN_PRODUCT_MAX_HITS} hits = up to ${pages * RAKUTEN_PRODUCT_MAX_HITS} rows`);
  console.log(`  pacing      : ${PACING_MS}ms between calls`);
  console.log(`  output      : ${out ?? "stdout"}`);

  if (!live) {
    console.log(
      "\nDRY RUN - no API call was made. Add --live to sweep for real.\n" +
        "Run `npm run verify:rakuten-product` first if you have not: this sweep is\n" +
        "built on field names that no live call has confirmed yet.",
    );
    return;
  }

  if (out && existsSync(out) && !force) {
    console.error(`\nRefusing to overwrite existing file: ${out} (pass --force to allow)`);
    process.exit(1);
  }

  const applicationId = process.env.applicationId;
  const accessKey = process.env.accessKey;
  if (!applicationId || !accessKey) {
    console.error("\nMissing applicationId or accessKey in .env - cannot run live.");
    process.exit(1);
  }

  const rows: RakutenProduct[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await sleep(PACING_MS);
    try {
      const result = await searchRakutenProduct({
        applicationId,
        accessKey,
        genreId,
        hits: RAKUTEN_PRODUCT_MAX_HITS,
        page,
      });
      rows.push(...result.products);
      console.log(`  page ${page}: +${result.products.length} rows (pageCount=${result.pageCount}, count=${result.count})`);
      if (result.pageCount !== null && page >= result.pageCount) {
        console.log("  reached the last page reported by the API - stopping early.");
        break;
      }
    } catch (err) {
      const detail =
        err instanceof RakutenProductApiError
          ? `status=${err.status} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`  page ${page}: FAILED - ${detail}`);
      console.error("  stopping the sweep; partial rows collected so far are still reported below.");
      break;
    }
  }

  const batch = buildSeedBatch(rows, productType);

  console.log("\n--- result ---");
  console.log(`  input rows : ${batch.stats.inputRows}`);
  console.log(`  seeds      : ${batch.stats.seeded} (${batch.stats.seedYieldPct}% yield)`);
  console.log("  rejected   :");
  for (const [reason, n] of Object.entries(batch.stats.rejectedByReason)) {
    if (n > 0) console.log(`    ${reason.padEnd(22)} ${n}`);
  }
  console.log(
    "\n  NOTE: 'seeds' are search INPUTS, not approved products. Each still goes through\n" +
      "  candidate search + human approval before it becomes a comparable listing.",
  );

  const json = JSON.stringify(batch.seeds, null, 2);
  if (out) {
    writeFileSync(out, json + "\n", "utf-8");
    console.log(`\n  written: ${out}`);
  } else {
    console.log(`\n${json}`);
  }
}

// Only run the CLI when executed directly - importing this module from the
// test file must not kick off a sweep.
if (process.argv[1] && /seed-catalog-from-rakuten\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`\nUnhandled failure: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
