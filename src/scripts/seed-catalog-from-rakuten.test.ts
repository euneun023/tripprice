/**
 * Unit checks for the PURE transforms in seed-catalog-from-rakuten.ts. No
 * test runner is configured in this repo (same plain-assertion convention as
 * adapters/rakuten.test.ts) - run:
 *   npx tsx src/scripts/seed-catalog-from-rakuten.test.ts
 * Exits non-zero on any failure. Makes NO API call and writes NO file; the
 * CLI's main() is guarded so importing the module cannot start a sweep.
 */
import {
  normalizeModelKey,
  preferRow,
  buildSeedBatch,
  parseArgs,
  type RejectReason,
} from "./seed-catalog-from-rakuten";
import type { RakutenProduct } from "../adapters/rakutenProduct";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`,
  );
  if (!pass) failures++;
}

function product(over: Partial<RakutenProduct> = {}): RakutenProduct {
  return {
    productId: "p-default",
    productName: "SONY ILCE-7M5 ボディ",
    productNo: "ILCE-7M5",
    makerName: "ソニー",
    productCode: "4548736150362",
    genreId: "564500",
    salesMinPrice: 398000,
    salesMaxPrice: null,
    minPrice: null,
    maxPrice: null,
    averagePrice: null,
    itemCount: null,
    salesItemCount: 12,
    productUrlPC: null,
    mediumImageUrl: null,
    ...over,
  };
}

const reasons = (batch: ReturnType<typeof buildSeedBatch>): RejectReason[] =>
  batch.rejected.map((r) => r.reason);

function main() {
  // ---- normalizeModelKey ----
  check("case/space insensitive", normalizeModelKey(" Sony ", "ilce-7m5"), "sony|ilce-7m5");
  check("inner whitespace collapsed", normalizeModelKey("Bang  Olufsen", "H  95"), "bang olufsen|h 95");
  // The suffix discipline from scripts/lib/identifierMatch.ts: a trailing
  // letter means a different kit, so these must NOT collapse together.
  check(
    "suffix variants stay distinct",
    normalizeModelKey("Panasonic", "DC-S5M2") === normalizeModelKey("Panasonic", "DC-S5M2W"),
    false,
  );
  check(
    "hyphens are preserved, not stripped",
    normalizeModelKey("Sony", "ILCE-7M5") === normalizeModelKey("Sony", "ILCE7M5"),
    false,
  );

  // ---- preferRow: more KNOWN data wins, price value is irrelevant ----
  const rich = product({ productId: "rich", salesItemCount: 5, salesMinPrice: 100, productCode: "1", mediumImageUrl: "i" });
  const sparse = product({ productId: "sparse", salesItemCount: null, salesMinPrice: null, productCode: null, mediumImageUrl: null });
  check("richer row wins (a-position)", preferRow(rich, sparse).productId, "rich");
  check("richer row wins (b-position)", preferRow(sparse, rich).productId, "rich");
  const cheap = product({ productId: "cheap", salesMinPrice: 1 });
  const pricey = product({ productId: "pricey", salesMinPrice: 999999 });
  check("equal data -> keeps the first, price value is not a tiebreaker", preferRow(cheap, pricey).productId, "cheap");

  // ---- buildSeedBatch: the happy path ----
  const ok = buildSeedBatch([product()], "camera");
  check("one seed emitted", ok.seeds.length, 1);
  check("seed matches the CandidateSeed shape evaluate-candidates.ts consumes", ok.seeds[0], {
    productName: "SONY ILCE-7M5 ボディ",
    brand: "ソニー",
    productType: "camera",
    modelSkuHint: "ILCE-7M5",
  });
  check("productType comes from the caller, never inferred", ok.seeds[0].productType, "camera");
  check("yield computed", ok.stats.seedYieldPct, 100);

  // ---- buildSeedBatch: identity requirements ----
  const noModel = buildSeedBatch([product({ productNo: null })], "camera");
  check("no productNo -> no seed", noModel.seeds.length, 0);
  check("no productNo -> reported as no_model_no", reasons(noModel), ["no_model_no"]);

  const noMaker = buildSeedBatch([product({ makerName: null })], "camera");
  check("no makerName -> reported as no_maker_name (not no_model_no)", reasons(noMaker), ["no_maker_name"]);

  const noName = buildSeedBatch([product({ productName: null })], "camera");
  check("no productName -> no seed", reasons(noName), ["no_product_name"]);

  // A focal-length-ish code is exactly what isSkuLikeModelSku() excludes.
  const notSku = buildSeedBatch([product({ productNo: "24-70mm" })], "camera_lens");
  check("non-SKU-like model -> rejected, not seeded", reasons(notSku), ["model_not_sku_like"]);
  const tooLong = buildSeedBatch([product({ productNo: "A".repeat(20) })], "camera");
  check("overlong model code -> rejected", reasons(tooLong), ["model_not_sku_like"]);

  // ---- buildSeedBatch: dedupe ----
  const sameId = buildSeedBatch([product({ productId: "dup" }), product({ productId: "dup" })], "camera");
  check("same productId twice -> one seed", sameId.seeds.length, 1);
  check("same productId twice -> duplicate_product_id", reasons(sameId), ["duplicate_product_id"]);

  const sameModel = buildSeedBatch(
    [
      product({ productId: "a", productNo: "ILCE-7M5", salesItemCount: null, salesMinPrice: null, productCode: null, mediumImageUrl: null }),
      product({ productId: "b", productNo: "ilce-7m5", salesItemCount: 9, salesMinPrice: 1, productCode: "x", mediumImageUrl: "i" }),
    ],
    "camera",
  );
  check("same model different id -> one seed", sameModel.seeds.length, 1);
  check("same model -> duplicate_model_key", reasons(sameModel), ["duplicate_model_key"]);
  check("the data-richer row is the one kept", sameModel.seeds[0].modelSkuHint, "ilce-7m5");

  const suffixPair = buildSeedBatch(
    [product({ productId: "a", productNo: "DC-S5M2" }), product({ productId: "b", productNo: "DC-S5M2W" })],
    "camera",
  );
  check("suffix variants are two separate seeds", suffixPair.seeds.length, 2);
  check("suffix variants produce no rejections", suffixPair.rejected.length, 0);

  // ---- buildSeedBatch: mixed batch accounting ----
  const mixed = buildSeedBatch(
    [
      product({ productId: "1", productNo: "ILCE-7M5" }),
      product({ productId: "2", productNo: null }),
      product({ productId: "3", productNo: "24-70mm" }),
      product({ productId: "4", productNo: "WH-1000XM6" }),
      product({ productId: "4", productNo: "WH-1000XM6" }),
    ],
    "camera",
  );
  check("mixed batch seeds", mixed.stats.seeded, 2);
  check("mixed batch input count", mixed.stats.inputRows, 5);
  check("mixed batch yield", mixed.stats.seedYieldPct, 40);
  check("mixed batch reason tally", mixed.stats.rejectedByReason, {
    no_model_no: 1,
    no_maker_name: 0,
    model_not_sku_like: 1,
    duplicate_product_id: 1,
    duplicate_model_key: 0,
    no_product_name: 0,
  });

  const empty = buildSeedBatch([], "camera");
  check("empty input -> no seeds, no crash", [empty.seeds.length, empty.stats.seedYieldPct], [0, 0]);

  // Rows with a null productId must not all collide on one dedupe slot.
  const nullIds = buildSeedBatch(
    [product({ productId: null, productNo: "AAA-1" }), product({ productId: null, productNo: "BBB-2" })],
    "camera",
  );
  check("null productIds do not collide", nullIds.seeds.length, 2);

  // ---- parseArgs ----
  const good = parseArgs(["--genre", "564500", "--product-type", "camera", "--pages", "3", "--live"]);
  check("valid args parsed", "args" in good ? good.args : good, {
    genreId: "564500",
    productType: "camera",
    pages: 3,
    live: true,
    out: null,
    force: false,
  });
  check("pages defaults to 1", "args" in parseArgs(["--genre", "1", "--product-type", "camera"]) ? (parseArgs(["--genre", "1", "--product-type", "camera"]) as any).args.pages : null, 1);
  check("dry run is the default (no --live)", "args" in parseArgs(["--genre", "1", "--product-type", "camera"]) ? (parseArgs(["--genre", "1", "--product-type", "camera"]) as any).args.live : null, false);
  check("missing --genre rejected", "error" in parseArgs(["--product-type", "camera"]), true);
  check("missing --product-type rejected", "error" in parseArgs(["--genre", "1"]), true);
  check("pages=0 rejected", "error" in parseArgs(["--genre", "1", "--product-type", "c", "--pages", "0"]), true);
  check("pages=101 rejected", "error" in parseArgs(["--genre", "1", "--product-type", "c", "--pages", "101"]), true);
  check("non-numeric pages rejected", "error" in parseArgs(["--genre", "1", "--product-type", "c", "--pages", "many"]), true);
  const withOut = parseArgs(["--genre", "1", "--product-type", "c", "--out", "/tmp/x.json", "--force"]);
  check("--out captured", "args" in withOut ? withOut.args.out : null, "/tmp/x.json");
  check("--force captured", "args" in withOut ? withOut.args.force : null, true);

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

main();
