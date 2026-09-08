/**
 * Boundary/behavior checks for the Candidate Evaluator dry-run runner. No
 * test runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/evaluate-candidates.test.ts
 * Exits non-zero on any failure. Search mode uses fake searchRakuten/
 * searchCoupang functions (never the real adapters/real APIs); evaluate
 * mode uses a fake KRW-conversion function (never the real fx adapter).
 * Neither runSearchMode() nor runEvaluateMode() imports any repository,
 * approveListing(), or DB client - this file only exercises what's already
 * exported, so there is no code path here that could write to the DB.
 */
import { runSearchMode, runEvaluateMode, runSearchModeWithIo, type CandidateSeed, type CandidateSearchOutput } from "./evaluate-candidates";
import { RakutenApiError, type RakutenItem } from "../adapters/rakuten";
import { CoupangApiError, type CoupangProduct } from "../adapters/coupang";
import type { ConvertToKrwFn } from "../services/candidateEvaluationService";
import type { GcsClient } from "./lib/gcsCandidateIo";
import { mkdtempSync, readFileSync as readFileSyncNode, writeFileSync as writeFileSyncNode, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const IDENTITY_CONVERT: ConvertToKrwFn = async (price) => ({ krwPrice: price, fxRateUsed: 1, fxAsOf: "2026-01-01T00:00:00Z" });

const FAKE_CREDS = {
  rakuten: { applicationId: "fake-app-id", accessKey: "fake-access-key" },
  coupang: { accessKey: "fake-coupang-access", secretKey: "fake-coupang-secret" },
};

function fakeRakutenItem(overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    itemName: "Fake Rakuten Item",
    itemPrice: 100_000,
    itemUrl: "https://item.rakuten.co.jp/fake/1",
    itemCode: "fakeshop:fake-1",
    shopName: "Fake Shop",
    shopCode: "fakeshop",
    availability: 1,
    ...overrides,
  };
}

function fakeCoupangProduct(overrides: Partial<CoupangProduct> = {}): CoupangProduct {
  return {
    keyword: "fake",
    rank: 1,
    isRocket: true,
    isFreeShipping: true,
    productId: 12345,
    productImage: "https://image.coupang.com/fake.jpg",
    productName: "Fake Coupang Product",
    productPrice: 90_000,
    productUrl: "https://coupang.com/re/fake",
    ...overrides,
  };
}

async function main() {
  // ============================================================
  // SEARCH MODE: preserves both source results, per candidate, independently
  // ============================================================
  {
    const seeds: CandidateSeed[] = [
      { productName: "Product A", productType: "camera" },
      { productName: "Product B", productType: "headphones", modelSkuHint: "SKU-B" },
    ];
    let rakutenCallCount = 0;
    let coupangCallCount = 0;
    const searchRakuten = async (keyword: string) => {
      rakutenCallCount++;
      return [fakeRakutenItem({ itemName: `${keyword} rakuten #1` }), fakeRakutenItem({ itemName: `${keyword} rakuten #2`, itemPrice: 200_000 })];
    };
    const searchCoupang = async (keyword: string) => {
      coupangCallCount++;
      return [fakeCoupangProduct({ productName: `${keyword} coupang #1` })];
    };

    const results = await runSearchMode(seeds, FAKE_CREDS, {
      searchRakuten: searchRakuten as any,
      searchCoupang: searchCoupang as any,
    });

    check("search mode: calls rakuten search once per candidate", rakutenCallCount, 2);
    check("search mode: calls coupang search once per candidate", coupangCallCount, 2);
    check("search mode: returns one output per seed", results.length, 2);
    check("search mode: preserves seed fields (productName)", results[1].productName, "Product B");
    check("search mode: preserves seed fields (modelSkuHint)", results[1].modelSkuHint, "SKU-B");
    check("search mode: rakutenResults preserved per candidate (A)", results[0].rakutenResults.map((r) => r.itemName), ["Product A rakuten #1", "Product A rakuten #2"]);
    check("search mode: rakutenResults preserved per candidate (B, not mixed with A)", results[1].rakutenResults.map((r) => r.itemName), ["Product B rakuten #1", "Product B rakuten #2"]);
    check("search mode: coupangResults preserved per candidate", results[0].coupangResults.map((r) => r.productName), ["Product A coupang #1"]);
    check("search mode: rakutenResults indices are 0-based sequential", results[0].rakutenResults.map((r) => r.index), [0, 1]);
    check("search mode: safe rakuten fields include price/currency/availability/externalId", {
      itemPrice: results[0].rakutenResults[1].itemPrice,
      currency: results[0].rakutenResults[1].currency,
      availability: results[0].rakutenResults[1].availability,
      externalId: results[0].rakutenResults[1].externalId,
    }, { itemPrice: 200_000, currency: "JPY", availability: true, externalId: "fakeshop:fake-1" });
    check("search mode: safe coupang fields include price/currency/externalId", {
      productPrice: results[0].coupangResults[0].productPrice,
      currency: results[0].coupangResults[0].currency,
      externalId: results[0].coupangResults[0].externalId,
    }, { productPrice: 90_000, currency: "KRW", externalId: "12345" });
    check("search mode: nothing pre-selected", results[0].rakutenSelectedIndex, null);
    check("search mode: no risk/confidence pre-filled", [results[0].coupangSelectedIndex, results[0].matchConfidence, results[0].riskFlags], [null, null, []]);
  }

  // ============================================================
  // SEARCH MODE isolation: Rakuten failure -> Coupang results still preserved
  // ============================================================
  {
    const seeds: CandidateSeed[] = [{ productName: "Isolated A", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten API responded 403", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Coupang Survives" })];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("isolation (rakuten fails): coupang results preserved", results[0].coupangResults.map((r) => r.productName), ["Coupang Survives"]);
    check("isolation (rakuten fails): rakuten results empty", results[0].rakutenResults, []);
    check("isolation (rakuten fails): rakutenError recorded", results[0].rakutenError, { kind: "http_error", status: 403, code: "CLIENT_IP_NOT_ALLOWED" });
    check("isolation (rakuten fails): coupangError null on success", results[0].coupangError, null);
  }

  // ============================================================
  // SEARCH MODE isolation: Coupang failure -> Rakuten results still preserved
  // ============================================================
  {
    const seeds: CandidateSeed[] = [{ productName: "Isolated B", productType: "camera" }];
    const searchRakuten = async () => [fakeRakutenItem({ itemName: "Rakuten Survives" })];
    const searchCoupang = async () => {
      throw new CoupangApiError("Coupang API responded 500", 500, { rCode: "ERROR", rMessage: "internal error" });
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("isolation (coupang fails): rakuten results preserved", results[0].rakutenResults.map((r) => r.itemName), ["Rakuten Survives"]);
    check("isolation (coupang fails): coupang results empty", results[0].coupangResults, []);
    check("isolation (coupang fails): coupangError recorded", results[0].coupangError, { kind: "http_error", status: 500, code: "internal error" });
    check("isolation (coupang fails): rakutenError null on success", results[0].rakutenError, null);
  }

  // ============================================================
  // SEARCH MODE isolation: both sources fail -> candidate still present, both results empty, both errors recorded
  // ============================================================
  {
    const seeds: CandidateSeed[] = [{ productName: "Both Fail", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("x", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    const searchCoupang = async () => {
      throw new CoupangApiError("y", 500, { rCode: "ERROR", rMessage: "boom" });
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("both fail: candidate still present in output", results.length, 1);
    check("both fail: rakutenResults empty", results[0].rakutenResults, []);
    check("both fail: coupangResults empty", results[0].coupangResults, []);
    check("both fail: rakutenError recorded", results[0].rakutenError, { kind: "http_error", status: 403, code: "CLIENT_IP_NOT_ALLOWED" });
    check("both fail: coupangError recorded", results[0].coupangError, { kind: "http_error", status: 500, code: "boom" });
  }

  // ============================================================
  // SEARCH MODE isolation: first candidate fails entirely -> batch continues, second candidate searched normally
  // ============================================================
  {
    const seeds: CandidateSeed[] = [
      { productName: "First Fails", productType: "camera" },
      { productName: "Second OK", productType: "camera" },
    ];
    const searchRakuten = async (keyword: string) => {
      if (keyword === "First Fails") throw new RakutenApiError("x", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
      return [fakeRakutenItem({ itemName: `${keyword} rakuten` })];
    };
    const searchCoupang = async (keyword: string) => {
      if (keyword === "First Fails") throw new CoupangApiError("y", 500, { rCode: "ERROR", rMessage: "boom" });
      return [fakeCoupangProduct({ productName: `${keyword} coupang` })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("batch continues after full candidate failure: 2 outputs (not aborted)", results.length, 2);
    check(
      "batch continues: first candidate has both results empty",
      { r: results[0].rakutenResults, c: results[0].coupangResults },
      { r: [], c: [] },
    );
    check("batch continues: second candidate rakuten searched normally", results[1].rakutenResults.map((r) => r.itemName), ["Second OK rakuten"]);
    check("batch continues: second candidate coupang searched normally", results[1].coupangResults.map((r) => r.productName), ["Second OK coupang"]);
  }

  // ============================================================
  // SEARCH MODE isolation: 3 inputs, one candidate's Rakuten fails -> all 3 present in output
  // ============================================================
  {
    const seeds: CandidateSeed[] = [
      { productName: "C1", productType: "camera" },
      { productName: "C2", productType: "camera" },
      { productName: "C3", productType: "camera" },
    ];
    const searchRakuten = async (keyword: string) => {
      if (keyword === "C2") throw new RakutenApiError("x", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
      return [fakeRakutenItem({ itemName: `${keyword} rakuten` })];
    };
    const searchCoupang = async (keyword: string) => [fakeCoupangProduct({ productName: `${keyword} coupang` })];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("3 inputs, partial failure: all 3 present in output", results.map((r) => r.productName), ["C1", "C2", "C3"]);
    check(
      "3 inputs: C2 rakutenResults empty but coupangResults preserved",
      { r: results[1].rakutenResults, c: results[1].coupangResults.map((x) => x.productName) },
      { r: [], c: ["C2 coupang"] },
    );
  }

  // ============================================================
  // SEARCH MODE error serialization: no credential/header/body leakage
  // ============================================================
  {
    // Transport-level failure the way the real adapters actually construct it - status=0,
    // body=the raw underlying Error, which for a real fetch failure can embed the full
    // request URL (Rakuten puts applicationId/accessKey in the query string).
    const seeds: CandidateSeed[] = [{ productName: "Transport Fail", productType: "camera" }];
    const sensitiveUnderlyingError = new Error(
      "fetch failed: request to https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=SECRET-APP-ID&accessKey=SECRET-ACCESS-KEY&keyword=x failed, reason: connect ETIMEDOUT",
    );
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten fetch transport failure: connect ETIMEDOUT", 0, sensitiveUnderlyingError);
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    const serializedTransport = JSON.stringify(results[0].rakutenError);
    check(
      "transport error: no leaked URL/credential in serialized error",
      serializedTransport.includes("SECRET-APP-ID") || serializedTransport.includes("SECRET-ACCESS-KEY") || serializedTransport.includes("applicationId"),
      false,
    );
    check("transport error: kind is transport_error, no other dynamic content", results[0].rakutenError, { kind: "transport_error" });
    check("transport error: only the 'kind' key is present", Object.keys(results[0].rakutenError!).sort(), ["kind"]);
  }
  {
    // http_error case: even if the raw response body somehow carried something sensitive,
    // the narrow allowlist-based extractor must never surface it.
    const seeds: CandidateSeed[] = [{ productName: "Http Error Body Check", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten API responded 403", 403, {
        errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" },
        requestHeaders: { Authorization: "Bearer SHOULD-NOT-LEAK" },
      });
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    const serializedHttp = JSON.stringify(results[0].rakutenError);
    check(
      "http error: no leaked header/auth even if present in the raw body",
      serializedHttp.includes("SHOULD-NOT-LEAK") || serializedHttp.includes("Authorization"),
      false,
    );
    check("http error: only kind/status/code keys present", Object.keys(results[0].rakutenError!).sort(), ["code", "kind", "status"]);
  }

  function candidateWithResults(overrides: Partial<CandidateSearchOutput> = {}): CandidateSearchOutput {
    return {
      productName: "Test Product",
      productType: "camera",
      rakutenResults: [
        { index: 0, itemName: "Rakuten Match", itemPrice: 100_000, itemUrl: "https://x", currency: "JPY", availability: true, externalId: "r1", shopName: "Shop" },
      ],
      coupangResults: [
        { index: 0, productName: "Coupang Match", productPrice: 90_000, productUrl: "https://y", currency: "KRW", externalId: "c1", isRocket: true },
      ],
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      matchConfidence: "verified",
      riskFlags: [],
      ...overrides,
    };
  }

  // ============================================================
  // EVALUATE MODE: unselected candidates are never evaluated
  // ============================================================
  {
    const unselected = candidateWithResults({ productName: "Unselected", rakutenSelectedIndex: null, coupangSelectedIndex: null });
    const partiallySelected = candidateWithResults({ productName: "PartiallySelected", coupangSelectedIndex: null });
    const selected = candidateWithResults({ productName: "Selected" });

    const outcome = await runEvaluateMode([unselected, partiallySelected, selected], { camera: 0 }, IDENTITY_CONVERT);

    check("unselected candidate: not evaluated", outcome.evaluated.map((r) => r.productName), ["Selected"]);
    check("unselected candidate: listed as skipped", outcome.skippedUnselected, ["Unselected", "PartiallySelected"]);
    check("unselected candidate: no invalid-selection entries", outcome.invalidSelections, []);
  }

  // ============================================================
  // EVALUATE MODE: selected index validation
  // ============================================================
  {
    const outOfRangeRakuten = candidateWithResults({ productName: "BadRakutenIndex", rakutenSelectedIndex: 5 });
    const outOfRangeCoupang = candidateWithResults({ productName: "BadCoupangIndex", coupangSelectedIndex: 5 });

    const outcome = await runEvaluateMode([outOfRangeRakuten, outOfRangeCoupang], { camera: 0 }, IDENTITY_CONVERT);

    check("out-of-range indices: nothing evaluated", outcome.evaluated, []);
    check("out-of-range indices: nothing marked unselected", outcome.skippedUnselected, []);
    check("out-of-range indices: two invalid-selection entries", outcome.invalidSelections.length, 2);
    check("out-of-range indices: rakuten reason mentions the index", outcome.invalidSelections[0].reason.includes("rakutenSelectedIndex 5"), true);
    check("out-of-range indices: coupang reason mentions the index", outcome.invalidSelections[1].reason.includes("coupangSelectedIndex 5"), true);
  }

  // ============================================================
  // EVALUATE MODE: verified/estimated/risk passed through to evaluateCandidate() correctly
  // ============================================================
  {
    // Same underlying candidate data, only matchConfidence differs -> verified must be able to
    // reach ADD, estimated at the exact same score must be capped at REVIEW (proves the field
    // actually reached evaluateCandidate(), not just accepted and ignored).
    const strong = {
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop" }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true }],
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      modelSkuHint: "MODEL-X",
      productType: "wetsuit",
    };
    const verifiedCandidate = candidateWithResults({ productName: "Verified", ...strong, matchConfidence: "verified" });
    const estimatedCandidate = candidateWithResults({ productName: "Estimated", ...strong, matchConfidence: "estimated" });

    const outcome = await runEvaluateMode([verifiedCandidate, estimatedCandidate], { wetsuit: 0 }, IDENTITY_CONVERT);
    const verifiedResult = outcome.evaluated.find((r) => r.productName === "Verified")!;
    const estimatedResult = outcome.evaluated.find((r) => r.productName === "Estimated")!;

    check("matchConfidence passthrough: verified -> ADD", verifiedResult.decision, "ADD");
    check("matchConfidence passthrough: estimated (same score) -> REVIEW", estimatedResult.decision, "REVIEW");
    check("matchConfidence passthrough: estimated score is lower by exactly the B2 gap (15 vs 7)", verifiedResult.totalScore - estimatedResult.totalScore, 8);

    const riskCandidate = candidateWithResults({ productName: "Risky", ...strong, matchConfidence: "verified", riskFlags: [{ type: "region_lock" }] });
    const riskOutcome = await runEvaluateMode([riskCandidate], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("riskFlags passthrough: region_lock -> SKIP", riskOutcome.evaluated[0].decision, "SKIP");
    check("riskFlags passthrough: riskFlags preserved on the result", riskOutcome.evaluated[0].riskFlags, [{ type: "region_lock" }]);
  }

  // ============================================================
  // Result JSON structure - the exact shape that gets JSON.stringify'd to the output file
  // ============================================================
  {
    const candidate = candidateWithResults();
    const outcome = await runEvaluateMode([candidate], { camera: 0 }, IDENTITY_CONVERT);
    const r = outcome.evaluated[0];
    const requiredKeys = [
      "productName",
      "productType",
      "rakuten",
      "coupang",
      "rakutenKrw",
      "coupangKrw",
      "savingKrw",
      "savingPercent",
      "priceScore",
      "matchScore",
      "coverageScore",
      "riskFlags",
      "totalScore",
      "decision",
      "reasons",
    ];
    check("result JSON: has every required field", requiredKeys.every((k) => k in r), true);
    check("result JSON: rakuten carries title+raw price", { title: r.rakuten?.itemName, price: r.rakuten?.itemPrice }, { title: "Rakuten Match", price: 100_000 });
    check("result JSON: coupang carries title+raw price", { title: r.coupang?.productName, price: r.coupang?.productPrice }, { title: "Coupang Match", price: 90_000 });
    check("result JSON: outcome top-level shape", Object.keys(outcome).sort(), ["evaluated", "invalidSelections", "skippedUnselected"]);
  }

  function makeFakeGcsClient(fixtures: Record<string, string> = {}): { client: GcsClient; uploads: { bucket: string; object: string; body: string }[] } {
    const uploads: { bucket: string; object: string; body: string }[] = [];
    const client: GcsClient = {
      bucket(bucket: string) {
        return {
          file(object: string) {
            const key = `${bucket}/${object}`;
            return {
              async download() {
                if (!(key in fixtures)) throw new Error("not found");
                return [Buffer.from(fixtures[key], "utf8")] as [Buffer];
              },
              async save(data: string) {
                uploads.push({ bucket, object, body: data });
              },
            };
          },
        };
      },
    };
    return { client, uploads };
  }

  // ============================================================
  // runSearchModeWithIo: local file mode keeps working exactly as before
  // ============================================================
  {
    const dir = mkdtempSync(join(tmpdir(), "candidate-search-io-test-"));
    const inputPath = join(dir, "seed.json");
    const outputPath = join(dir, "searched.json");
    writeFileSyncNode(inputPath, JSON.stringify([{ productName: "Local Product", productType: "camera" }]), "utf8");

    const searchRakuten = async () => [fakeRakutenItem({ itemName: "Local rakuten" })];
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Local coupang" })];

    const { results, outputLocation } = await runSearchModeWithIo(
      { input: { kind: "local", path: inputPath }, output: { kind: "local", path: outputPath } },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any },
    );

    check("local mode: outputLocation is the local path", outputLocation, outputPath);
    check("local mode: results reflect the local input file", results[0].productName, "Local Product");
    const written = JSON.parse(readFileSyncNode(outputPath, "utf8"));
    check("local mode: output file actually written with the same results", written[0].rakutenResults[0].itemName, "Local rakuten");

    rmSync(dir, { recursive: true, force: true });
  }

  // ============================================================
  // runSearchModeWithIo: GCS mode reuses runSearchMode() as-is and uploads the exact result
  // ============================================================
  {
    const { client, uploads } = makeFakeGcsClient({
      "in-bucket/candidate-search/input/seed.json": JSON.stringify([{ productName: "GCS Product", productType: "camera" }]),
    });
    const searchRakuten = async () => [fakeRakutenItem({ itemName: "GCS rakuten" })];
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "GCS coupang" })];

    const { results, outputLocation } = await runSearchModeWithIo(
      {
        input: { kind: "gcs", uri: "gs://in-bucket/candidate-search/input/seed.json" },
        output: { kind: "gcs", uri: "gs://out-bucket/candidate-search/output/searched.json" },
      },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any, gcsClient: client },
    );

    check("GCS mode: outputLocation is the gs:// URI", outputLocation, "gs://out-bucket/candidate-search/output/searched.json");
    check("GCS mode: input read from GCS reaches runSearchMode", results[0].productName, "GCS Product");
    check("GCS mode: exactly one upload, to the exact requested bucket/object", uploads.length, 1);
    check("GCS mode: upload target bucket", uploads[0].bucket, "out-bucket");
    check("GCS mode: upload target object", uploads[0].object, "candidate-search/output/searched.json");
    const uploadedResults: CandidateSearchOutput[] = JSON.parse(uploads[0].body);
    check("GCS mode: uploaded body is exactly runSearchMode's own result (same rakuten item)", uploadedResults[0].rakutenResults[0].itemName, "GCS rakuten");
    check("GCS mode: uploaded body is exactly runSearchMode's own result (same coupang item)", uploadedResults[0].coupangResults[0].productName, "GCS coupang");
  }

  // ============================================================
  // runSearchModeWithIo: source partial failure is preserved through to the GCS upload
  // ============================================================
  {
    const { client, uploads } = makeFakeGcsClient({
      "in-bucket/seed.json": JSON.stringify([{ productName: "Partial Fail Product", productType: "camera" }]),
    });
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten API responded 403", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Still Present" })];

    await runSearchModeWithIo(
      { input: { kind: "gcs", uri: "gs://in-bucket/seed.json" }, output: { kind: "gcs", uri: "gs://out-bucket/searched.json" } },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any, gcsClient: client },
    );

    const uploaded: CandidateSearchOutput[] = JSON.parse(uploads[0].body);
    check("GCS mode + partial failure: candidate still present in uploaded output", uploaded.length, 1);
    check("GCS mode + partial failure: rakutenResults empty in uploaded output", uploaded[0].rakutenResults, []);
    check("GCS mode + partial failure: coupangResults preserved in uploaded output", uploaded[0].coupangResults.map((r) => r.productName), ["Still Present"]);
    check("GCS mode + partial failure: rakutenError recorded in uploaded output", uploaded[0].rakutenError, { kind: "http_error", status: 403, code: "CLIENT_IP_NOT_ALLOWED" });
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
