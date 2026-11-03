/**
 * ONE live verification run that turns adapters/rakutenProduct.ts from
 * "documented, unverified" into "confirmed or refuted". Read that file's
 * header first - it lists exactly what is unverified and why.
 *
 * Run:
 *   npx tsx src/scripts/verify-rakuten-product.ts
 *   (needs applicationId / accessKey in .env - the same two keys
 *    verify-rakuten.ts already uses. No new credential, no signup.)
 *
 * What it answers, in order of importance to the project:
 *   Q1. Is the endpoint/auth right at all? (host+path guessed from doc
 *       extracts, never called from this repo)
 *   Q2. How often is `productNo` (型番) actually populated? This is the
 *       KR<->JP join key - docs/data-sources-research-2026-11.md §3. If
 *       coverage here is poor, the whole "scale to thousands" plan needs a
 *       different identifier source, so this number is the single most
 *       decision-relevant output of the script.
 *   Q3. Did the reported 2026-03-25 field emptying really happen
 *       (itemCount / minPrice / ProductDetails blank)? And critically, did
 *       `salesItemCount` and `salesMinPrice` SURVIVE it - those two are what
 *       "N곳 중 최저가" is built on.
 *   Q4. Does JAN search (productCode) work, i.e. can a JP product be looked
 *       up by barcode?
 *   Q5. Does genre sweeping page the way the docs claim (pageCount up to
 *       100), i.e. is bulk discovery real?
 *
 * SAFETY: read-only. Makes at most MAX_CALLS requests, paced at >= 1.1s
 * apart (Rakuten apps are registered at 1 QPS and the docs warn that rapid
 * repeat calls to the same URL can get an app temporarily blocked). Touches
 * no database, writes no file, and prints no credential - request URLs are
 * redacted before logging.
 */
import "dotenv/config";
import {
  searchRakutenProduct,
  extractMatchKey,
  summarizeJpOffers,
  RakutenProductApiError,
  RAKUTEN_PRODUCT_SEARCH_ENDPOINT,
  type RakutenProduct,
} from "../adapters/rakutenProduct";

const applicationId = process.env.applicationId;
const accessKey = process.env.accessKey;

if (!applicationId || !accessKey) {
  console.error("Missing applicationId or accessKey in .env (same keys verify-rakuten.ts uses).");
  process.exit(1);
}

/** Hard ceiling on live calls for this script. Deliberately tiny. */
const MAX_CALLS = 6;
const PACING_MS = 1100;

let callsMade = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Never print the key material that sits in the query string. */
function redact(url: string): string {
  return url
    .replace(/applicationId=[^&]+/, "applicationId=***")
    .replace(/accessKey=[^&]+/, "accessKey=***");
}

async function call(label: string, params: Parameters<typeof searchRakutenProduct>[0]) {
  if (callsMade >= MAX_CALLS) {
    console.log(`\n[${label}] SKIPPED - MAX_CALLS=${MAX_CALLS} reached (safety cap)`);
    return null;
  }
  if (callsMade > 0) await sleep(PACING_MS);
  callsMade++;
  try {
    const result = await searchRakutenProduct(params);
    console.log(`\n[${label}] OK`);
    console.log(`  url     : ${redact(result.requestUrl)}`);
    console.log(`  envelope: count=${result.count} page=${result.page} pageCount=${result.pageCount} hits=${result.hits}`);
    console.log(`  products: ${result.products.length}`);
    return result;
  } catch (err) {
    if (err instanceof RakutenProductApiError) {
      console.log(`\n[${label}] FAILED - status=${err.status}`);
      console.log(`  message : ${err.message}`);
      console.log(`  body    : ${JSON.stringify(err.body)?.slice(0, 400) ?? "null"}`);
    } else {
      console.log(`\n[${label}] FAILED - unexpected ${err instanceof Error ? err.name : typeof err}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Per-field population rate over the rows actually returned. */
function fieldCoverage(products: RakutenProduct[]) {
  const fields: (keyof RakutenProduct)[] = [
    "productId",
    "productName",
    "productNo",
    "makerName",
    "productCode",
    "genreId",
    "salesMinPrice",
    "salesMaxPrice",
    "minPrice",
    "maxPrice",
    "averagePrice",
    "itemCount",
    "salesItemCount",
    "productUrlPC",
    "mediumImageUrl",
  ];
  const total = products.length;
  return fields.map((f) => {
    const populated = products.filter((p) => p[f] !== null).length;
    return { field: f, populated, total, pct: total === 0 ? 0 : Math.round((populated / total) * 1000) / 10 };
  });
}

function printCoverage(label: string, products: RakutenProduct[]) {
  console.log(`\n--- field population: ${label} (n=${products.length}) ---`);
  for (const row of fieldCoverage(products)) {
    const flag =
      row.field === "productNo" ? "  <= Q2 KR match key" :
      row.field === "salesItemCount" || row.field === "salesMinPrice" ? "  <= Q3 must survive" :
      row.field === "itemCount" || row.field === "minPrice" ? "  <= Q3 reported emptied" : "";
    console.log(`  ${String(row.field).padEnd(18)} ${String(row.populated).padStart(3)}/${row.total}  ${String(row.pct).padStart(5)}%${flag}`);
  }
}

async function main() {
  console.log("=== Rakuten 商品価格ナビ製品検索API live verification ===");
  console.log(`endpoint: ${RAKUTEN_PRODUCT_SEARCH_ENDPOINT}`);
  console.log(`safety  : max ${MAX_CALLS} calls, >=${PACING_MS}ms apart, read-only\n`);

  // Q1 + Q2 + Q3: a keyword search in a category this project already has
  // measured matching data for (camera - 87% exact per the 429-pair baseline).
  const byKeyword = await call("Q1/Q2/Q3 keyword search", {
    applicationId: applicationId!,
    accessKey: accessKey!,
    keyword: "ソニー ミラーレス一眼",
    hits: 30,
  });

  if (!byKeyword) {
    console.error(
      "\nFATAL: the first call failed. If status=404, the endpoint host/path in " +
        "adapters/rakutenProduct.ts is wrong (it was never verifiable from this repo) - " +
        "fix RAKUTEN_PRODUCT_SEARCH_ENDPOINT against the official doc page and re-run. " +
        "If status=400/401/403, the credential or a parameter name is the problem.",
    );
    process.exit(1);
  }

  printCoverage("keyword search", byKeyword.products);

  const withKey = byKeyword.products.filter((p) => extractMatchKey(p) !== null);
  console.log(
    `\nQ2 ANSWER: ${withKey.length}/${byKeyword.products.length} products yield a usable brand+型番 match key.`,
  );
  console.log(
    "  (compare: scripts/lib/identifierMatch.ts records only 70/429 = 16.3% model-code\n" +
      "   coverage from hand-typed seed files. If the number above is far higher, this API\n" +
      "   is the mechanical fix for that gap and the catalog seeder is worth building.)",
  );

  const comparable = byKeyword.products.filter((p) => summarizeJpOffers(p).comparable);
  console.log(
    `\nQ3 ANSWER: ${comparable.length}/${byKeyword.products.length} products have BOTH salesMinPrice and salesItemCount>0,` +
      `\n  i.e. can honestly back a "구매가능 N건 중 최저가" claim today.`,
  );

  console.log("\n  sample rows (first 5):");
  for (const p of byKeyword.products.slice(0, 5)) {
    const s = summarizeJpOffers(p);
    console.log(
      `   - ${(p.productName ?? "(no name)").slice(0, 46).padEnd(46)} | 型番=${(p.productNo ?? "-").padEnd(16)} | maker=${(p.makerName ?? "-").padEnd(10)} | JAN=${p.productCode ?? "-"} | min=${s.minPrice ?? "-"} | listings=${s.purchasableListingCount ?? "unknown"}`,
    );
  }

  // Q4: JAN lookup. Uses a JAN discovered in the call above, so nothing is
  // hard-coded and the check stays valid as the catalog changes.
  const janSample = byKeyword.products.find((p) => p.productCode !== null)?.productCode ?? null;
  if (janSample) {
    const byJan = await call(`Q4 JAN lookup (productCode=${janSample})`, {
      applicationId: applicationId!,
      accessKey: accessKey!,
      productCode: janSample,
    });
    if (byJan) {
      console.log(
        `\nQ4 ANSWER: JAN search returned ${byJan.products.length} product(s). ` +
          (byJan.products.length > 0
            ? "Barcode -> JP product lookup WORKS."
            : "Returned nothing - JAN search may not behave as documented."),
      );
    }
  } else {
    console.log(
      "\nQ4 SKIPPED: no productCode (JAN) came back in the keyword response, so there is " +
        "nothing to look up. That itself is a finding - record it: JAN may not be exposed " +
        "on search results even though it is accepted as an input parameter.",
    );
  }

  // Q5: is genre sweeping real? Only run if a genreId was actually returned.
  const genreSample = byKeyword.products.find((p) => p.genreId !== null)?.genreId ?? null;
  if (genreSample) {
    const byGenre = await call(`Q5 genre sweep (genreId=${genreSample}, page 1)`, {
      applicationId: applicationId!,
      accessKey: accessKey!,
      genreId: genreSample,
      hits: 30,
      page: 1,
    });
    if (byGenre) {
      const reachable = Math.min(byGenre.count ?? 0, 30 * (byGenre.pageCount ?? 0));
      console.log(
        `\nQ5 ANSWER: genre ${genreSample} reports count=${byGenre.count}, pageCount=${byGenre.pageCount}` +
          `\n  => about ${reachable} products reachable from this ONE genre key.` +
          `\n  Bulk discovery scales by sweeping MORE genres, never by paging past 100.`,
      );
    }
  } else {
    console.log("\nQ5 SKIPPED: no genreId in the response, so a genre sweep cannot be probed from it.");
  }

  console.log(`\n=== done: ${callsMade} live call(s) made ===`);
  console.log(
    "Next: paste the Q2/Q3 numbers into docs/data-sources-research-2026-11.md §1(2) and\n" +
      "upgrade that row's evidence grade from B to A (or correct it, if this run refuted it).",
  );
}

main().catch((err) => {
  console.error(`\nUnhandled failure: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
