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
import { runSearchMode, runEvaluateMode, runSearchModeWithIo, buildRakutenFallbackKeyword, dedupeCoupangProductsByExternalId, isSkuLikeModelSku, unionCoupangResults, type CandidateSeed, type CandidateSearchOutput } from "./evaluate-candidates";
import { RakutenApiError, type RakutenItem } from "../adapters/rakuten";
import { CoupangApiError, type CoupangProduct } from "../adapters/coupang";
import type { ConvertToKrwFn } from "../services/candidateEvaluationService";
import type { FetchFn } from "./lib/gcsCandidateIo";
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
    // Product A has no modelSkuHint -> Coupang A-only (1 call). Product B's
    // modelSkuHint "SKU-B" is SKU-like (isSkuLikeModelSku) -> Coupang runs
    // productName AND modelSkuHint (2 calls), unioned.
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
      // same externalId (default productId 12345) regardless of keyword, so
      // Product B's two queries land on the same product - exercises the
      // union's dedupe + matchedQueries merge, not just "two separate items".
      return [fakeCoupangProduct({ productName: `${keyword} coupang #1` })];
    };

    const results = await runSearchMode(seeds, FAKE_CREDS, {
      searchRakuten: searchRakuten as any,
      searchCoupang: searchCoupang as any,
    });

    check("search mode: calls rakuten search once per candidate", rakutenCallCount, 2);
    check("search mode: calls coupang search once for A (no modelSkuHint) + twice for B (SKU-like) = 3 total", coupangCallCount, 3);
    check("search mode: returns one output per seed", results.length, 2);
    check("search mode: preserves seed fields (productName)", results[1].productName, "Product B");
    check("search mode: preserves seed fields (modelSkuHint)", results[1].modelSkuHint, "SKU-B");
    check("search mode: rakutenResults preserved per candidate (A)", results[0].rakutenResults.map((r) => r.itemName), ["Product A rakuten #1", "Product A rakuten #2"]);
    check("search mode: rakutenResults preserved per candidate (B, not mixed with A)", results[1].rakutenResults.map((r) => r.itemName), ["Product B rakuten #1", "Product B rakuten #2"]);
    check("search mode: coupangResults preserved per candidate", results[0].coupangResults.map((r) => r.productName), ["Product A coupang #1"]);
    check("search mode: candidate A coupang result matchedQueries is productName only (not SKU-like, no modelSkuHint query)", results[0].coupangResults[0].matchedQueries, ["productName"]);
    check(
      "search mode: candidate B's productName+modelSkuHint queries hit the same externalId -> 1 deduped result, matchedQueries has both",
      { count: results[1].coupangResults.length, matchedQueries: results[1].coupangResults[0].matchedQueries },
      { count: 1, matchedQueries: ["productName", "modelSkuHint"] },
    );
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
    check("search mode: rakutenSelectedMount/coupangSelectedMount both null (no automatic mount inference)", [results[0].rakutenSelectedMount, results[0].coupangSelectedMount], [null, null]);
  }

  // ============================================================
  // SEARCH MODE: RakutenItem.postageFlag/shipOverseasFlag/shipOverseasArea
  // are preserved raw into SafeRakutenResult (never re-interpreted beyond
  // shippingStatus - see deriveRakutenShippingStatus()'s own doc comment on
  // why postageFlag alone never confirms Korea-bound shipping cost).
  // ============================================================
  {
    const seeds: CandidateSeed[] = [{ productName: "Overseas Product", productType: "camera" }];
    const searchRakuten = async () => [
      fakeRakutenItem({ itemName: "Overseas item", postageFlag: 0, shipOverseasFlag: 1, shipOverseasArea: "ASIA" }),
    ];
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("search mode: postageFlag preserved raw on SafeRakutenResult", results[0].rakutenResults[0].postageFlag, 0);
    check("search mode: shipOverseasFlag preserved raw on SafeRakutenResult", results[0].rakutenResults[0].shipOverseasFlag, 1);
    check("search mode: shipOverseasArea preserved raw on SafeRakutenResult", results[0].rakutenResults[0].shipOverseasArea, "ASIA");
    check("search mode: shippingStatus is still just the seller-postage derivation (included), not upgraded by shipOverseasFlag", results[0].rakutenResults[0].shippingStatus, "included");
  }

  // ============================================================
  // SEARCH MODE: seed variantAttributes (mount) survives into SearchOutput
  // unchanged, and selectedMount stays null even for a camera_lens seed.
  // ============================================================
  {
    const seeds: CandidateSeed[] = [
      { productName: "Sony FE 24-70mm F2.8 GM II", brand: "Sony", productType: "camera_lens", modelSkuHint: "SEL2470GM2", variantAttributes: { mount: "sony_e" } },
      { productName: "Product No Mount", productType: "camera" },
    ];
    const searchRakuten = async () => [fakeRakutenItem()];
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("search mode: variantAttributes.mount preserved unchanged from seed to output", results[0].variantAttributes, { mount: "sony_e" });
    check("search mode: rakutenSelectedMount/coupangSelectedMount still both null even for a camera_lens seed with a target mount", [results[0].rakutenSelectedMount, results[0].coupangSelectedMount], [null, null]);
    check("search mode: seed without variantAttributes -> field simply absent/undefined, no fabricated default", results[1].variantAttributes, undefined);
  }

  // ============================================================
  // dedupeCoupangProductsByExternalId(): candidate SEARCH-only dedupe unit tests
  // ============================================================
  {
    const same3 = [
      fakeCoupangProduct({ productId: 111, productName: "Dup A" }),
      fakeCoupangProduct({ productId: 111, productName: "Dup B (later, same id)" }),
      fakeCoupangProduct({ productId: 111, productName: "Dup C (later, same id)" }),
    ];
    check("dedupe: same externalId 3x -> 1 kept", dedupeCoupangProductsByExternalId(same3).map((p) => p.productName), ["Dup A"]);
  }
  {
    const distinct = [
      fakeCoupangProduct({ productId: 1, productName: "First" }),
      fakeCoupangProduct({ productId: 2, productName: "Second" }),
      fakeCoupangProduct({ productId: 3, productName: "Third" }),
    ];
    check("dedupe: distinct externalIds -> all kept", dedupeCoupangProductsByExternalId(distinct).map((p) => p.productName), ["First", "Second", "Third"]);
  }
  {
    // same title/price, different productId - must NOT be collapsed (no title/price fallback matching)
    const sameTitlePriceDifferentId = [
      fakeCoupangProduct({ productId: 9715042060, productName: "Identical Title", productPrice: 1_680_000 }),
      fakeCoupangProduct({ productId: 8925710636, productName: "Identical Title", productPrice: 1_680_000 }),
    ];
    check(
      "dedupe: identical title/price but different externalId -> both kept (no false-positive dedupe)",
      dedupeCoupangProductsByExternalId(sameTitlePriceDifferentId).map((p) => p.productId),
      [9715042060, 8925710636],
    );
  }
  {
    // first-occurrence order preserved even when a later duplicate would otherwise sort earlier
    const mixed = [
      fakeCoupangProduct({ productId: 5, productName: "E" }),
      fakeCoupangProduct({ productId: 3, productName: "C" }),
      fakeCoupangProduct({ productId: 5, productName: "E dup" }),
      fakeCoupangProduct({ productId: 1, productName: "A" }),
      fakeCoupangProduct({ productId: 3, productName: "C dup" }),
    ];
    check("dedupe: keeps original relative order of first occurrences", dedupeCoupangProductsByExternalId(mixed).map((p) => p.productId), [5, 3, 1]);
  }
  {
    check("dedupe: empty input -> empty output", dedupeCoupangProductsByExternalId([]), []);
  }

  // ============================================================
  // SEARCH MODE integration: Coupang dedupe applied before index assignment
  // ============================================================
  {
    const seeds: CandidateSeed[] = [{ productName: "Dedupe Candidate", productType: "camera" }];
    const searchRakuten = async () => [fakeRakutenItem()];
    const searchCoupang = async () => [
      fakeCoupangProduct({ productId: 100, productName: "Real Listing" }),
      fakeCoupangProduct({ productId: 200, productName: "Accessory" }),
      fakeCoupangProduct({ productId: 100, productName: "Real Listing (repeat)" }),
    ];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("search mode + dedupe: repeated productId collapsed to first occurrence", results[0].coupangResults.map((r) => r.productName), ["Real Listing", "Accessory"]);
    check("search mode + dedupe: externalId matches the kept (first) occurrence", results[0].coupangResults[0].externalId, "100");
    check("search mode + dedupe: index stays 0-based sequential over the deduped list", results[0].coupangResults.map((r) => r.index), [0, 1]);
  }
  {
    // Rakuten fails for this candidate; Coupang dedupe must still run and not be skipped by the failure isolation path
    const seeds: CandidateSeed[] = [{ productName: "Dedupe With Rakuten Failure", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("x", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    const searchCoupang = async () => [
      fakeCoupangProduct({ productId: 7, productName: "Kept" }),
      fakeCoupangProduct({ productId: 7, productName: "Kept (repeat)" }),
    ];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("search mode + dedupe: still applied when the OTHER source (rakuten) fails", results[0].coupangResults.map((r) => r.productName), ["Kept"]);
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
  // SEARCH MODE: Rakuten 400 fallback (trailing single-char ASCII token merge) - candidate SEARCH-only
  // ============================================================
  {
    // 1. raw keyword succeeds -> exactly one call, no fallback
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Sony α1 II", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      calls.push(keyword);
      return [fakeRakutenItem({ itemName: "ok" })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("fallback: raw success -> exactly 1 rakuten call", calls, ["Sony α1 II"]);
  }
  {
    // 2. raw keyword 400 -> second call uses the merged fallback keyword
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Sony α7 V", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      calls.push(keyword);
      if (keyword === "Sony α7 V") throw new RakutenApiError("Rakuten API responded 400", 400, { error: "wrong_parameter" });
      return [fakeRakutenItem({ itemName: "fallback ok" })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("fallback: 400 -> second call is merged keyword", calls, ["Sony α7 V", "Sony α7V"]);
  }
  {
    // 3. raw 400 + fallback succeeds -> fallback results preserved, no error
    const seeds: CandidateSeed[] = [{ productName: "Sony α7R V", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      if (keyword === "Sony α7R V") throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
      return [fakeRakutenItem({ itemName: `${keyword} rakuten` })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("fallback: 400 + fallback success -> results preserved", results[0].rakutenResults.map((r) => r.itemName), ["Sony α7RV rakuten"]);
    check("fallback: 400 + fallback success -> no rakutenError", results[0].rakutenError, null);
  }
  {
    // 4. raw 400 + fallback also fails -> safe error returned, no crash, batch continues
    const seeds: CandidateSeed[] = [{ productName: "Canon EOS R50 V", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
    };
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Coupang Still OK" })];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("fallback: 400 + fallback fails -> rakutenResults empty", results[0].rakutenResults, []);
    check("fallback: 400 + fallback fails -> safe rakutenError recorded", results[0].rakutenError, { kind: "http_error", status: 400, code: "wrong_parameter" });
    check("fallback: 400 + fallback fails -> coupang unaffected", results[0].coupangResults.map((r) => r.productName), ["Coupang Still OK"]);
  }
  {
    // 5. non-400 HTTP errors -> no fallback call at all
    const calls403: string[] = [];
    const seeds403: CandidateSeed[] = [{ productName: "Sony α7 V", productType: "camera" }];
    const searchRakuten403 = async (keyword: string) => {
      calls403.push(keyword);
      throw new RakutenApiError("x", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    await runSearchMode(seeds403, FAKE_CREDS, { searchRakuten: searchRakuten403 as any, searchCoupang: (async () => [fakeCoupangProduct()]) as any });
    check("fallback: 403 -> no fallback retry (exactly 1 call)", calls403, ["Sony α7 V"]);

    const calls500: string[] = [];
    const seeds500: CandidateSeed[] = [{ productName: "Sony α7 V", productType: "camera" }];
    const searchRakuten500 = async (keyword: string) => {
      calls500.push(keyword);
      throw new RakutenApiError("x", 500, null);
    };
    await runSearchMode(seeds500, FAKE_CREDS, { searchRakuten: searchRakuten500 as any, searchCoupang: (async () => [fakeCoupangProduct()]) as any });
    check("fallback: 500 -> no fallback retry (exactly 1 call)", calls500, ["Sony α7 V"]);
  }
  {
    // 6. normal (non-trailing-single-char) keywords are never transformed
    const normalKeywords = [
      "Sony α1 II", "Sony α9 III", "Sony α7R VI", "Sony α7C II", "Sony α6700", "Sony ZV-E10 II",
      "Canon EOS R1", "Canon EOS R5 Mark II", "Canon EOS R6 Mark III", "Canon EOS R7", "Canon EOS R8",
      "Nikon Z9", "Nikon Z8", "Nikon Z6III", "Nikon Z5II", "Nikon Zf", "Nikon Z50II",
      "FUJIFILM X-H2", "FUJIFILM X-T5", "FUJIFILM X-T50", "FUJIFILM X-S20", "FUJIFILM X-E5", "FUJIFILM X-M5",
      "Panasonic LUMIX S1RII", "Panasonic LUMIX S5II", "Panasonic LUMIX S9", "OM SYSTEM OM-3",
    ];
    check(
      "fallback: none of the 27 unaffected-style keywords produce a fallback",
      normalKeywords.map(buildRakutenFallbackKeyword),
      normalKeywords.map(() => null),
    );
    check("fallback: merges trailing single-char token", buildRakutenFallbackKeyword("Sony α7 V"), "Sony α7V");
    check("fallback: merges trailing single-char token (R50 V)", buildRakutenFallbackKeyword("Canon EOS R50 V"), "Canon EOS R50V");
  }
  {
    // 6b. generalized standalone-token merge: every standalone 1-char ASCII
    // letter token in the query is merged in a single transform, not just a
    // trailing one.
    check(
      "fallback: Canon lens L merges into preceding aperture (mid-query, not trailing)",
      buildRakutenFallbackKeyword("Canon RF24-70mm F2.8 L IS USM"),
      "Canon RF24-70mm F2.8L IS USM",
    );
    check(
      "fallback: Nikon Z + S both merge (Z into following digit-led token, S into preceding aperture)",
      buildRakutenFallbackKeyword("Nikon NIKKOR Z 24-70mm f/2.8 S"),
      "Nikon NIKKOR Z24-70mm f/2.8S",
    );
    check(
      "fallback: FUJIFILM R merges into preceding digit-bearing token",
      buildRakutenFallbackKeyword("FUJIFILM XF16-55mmF2.8 R LM WR II"),
      "FUJIFILM XF16-55mmF2.8R LM WR II",
    );
    check(
      "fallback: Panasonic S merges into following non-digit token",
      buildRakutenFallbackKeyword("Panasonic LUMIX S PRO 24-70mm F2.8"),
      "Panasonic LUMIX SPRO 24-70mm F2.8",
    );
    check(
      "fallback: trailing standalone token after a non-digit previous is dropped, not fused into a meaningful word (VR + S !-> VRS)",
      buildRakutenFallbackKeyword("Nikon NIKKOR Z 70-200mm f/2.8 VR S"),
      "Nikon NIKKOR Z70-200mm f/2.8 VR",
    );
  }
  {
    // 6c. standalone 1-digit token (e.g. a trailing generation number) also
    // 400s - found live via the earbuds candidate-search batch (2026-09-12,
    // 12/20 candidates), disproving this function's original "digits are
    // always safe" assumption. Always merges into the previous token -
    // multi-digit tokens ("10") are untouched, only a lone digit triggers.
    check("fallback: standalone digit merges into previous (trailing)", buildRakutenFallbackKeyword("Jabra Elite 10 Gen 2"), "Jabra Elite 10 Gen2");
    check("fallback: standalone digit merges into previous (trailing, single previous word)", buildRakutenFallbackKeyword("JBL Tour Pro 3"), "JBL Tour Pro3");
    check("fallback: standalone digit merges into previous (mid-query, not trailing)", buildRakutenFallbackKeyword("Xiaomi Buds 5 Pro"), "Xiaomi Buds5 Pro");
    check("fallback: standalone digit merges into previous (multi-digit '10' left untouched)", buildRakutenFallbackKeyword("Anker Soundcore Liberty 4 Pro"), "Anker Soundcore Liberty4 Pro");
    check(
      "fallback: no standalone digit remains after the transform",
      ["Jabra Elite 10 Gen 2", "Sennheiser Momentum True Wireless 4", "Google Pixel Buds Pro 2", "Beats Powerbeats Pro 2", "JBL Tour Pro 3", "Huawei FreeBuds Pro 5", "Xiaomi Buds 5 Pro", "OnePlus Buds Pro 3", "Edifier NeoBuds Pro 2"].map(
        (k) => buildRakutenFallbackKeyword(k)!.split(" ").some((t) => /^[0-9]$/.test(t)),
      ),
      [false, false, false, false, false, false, false, false, false],
    );
  }
  {
    // 6d. standalone "&" also 400s (same batch) - dropped entirely, never
    // fused into a neighbor (fusing would produce "Bang&"/"&Olufsen", not
    // the connector-word removal that actually fixes the query).
    check("fallback: standalone ampersand is dropped", buildRakutenFallbackKeyword("Bang & Olufsen Beoplay Eleven"), "Bang Olufsen Beoplay Eleven");
    check("fallback: standalone ampersand is dropped (mid-query, code-like next token)", buildRakutenFallbackKeyword("Master & Dynamic MW09"), "Master Dynamic MW09");
    check(
      "fallback: no standalone ampersand remains after the transform",
      ["Bang & Olufsen Beoplay Eleven", "Master & Dynamic MW09"].map((k) => buildRakutenFallbackKeyword(k)!.split(" ").includes("&")),
      [false, false],
    );
  }
  {
    // 6f. already-normal keywords (no standalone letter/digit/ampersand
    // token) are never touched by the digit/ampersand extension either.
    check(
      "fallback: already-normal keywords (incl. multi-digit/parenthesized tokens) produce no fallback",
      ["Samsung Galaxy Buds4 Pro", "Technics EAH-AZ100", "Nothing Ear (3)"].map(buildRakutenFallbackKeyword),
      [null, null, null],
    );
  }
  {
    // 6e. end-to-end: raw 400 -> fallback drops the trailing "S" (confirmed
    // live against Rakuten - see evaluate-candidates.ts's buildRakutenFallbackKeyword
    // doc comment) -> fallback succeeds, results preserved.
    const seeds: CandidateSeed[] = [{ productName: "Nikon NIKKOR Z 70-200mm f/2.8 VR S", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      if (keyword === "Nikon NIKKOR Z 70-200mm f/2.8 VR S") throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
      return [fakeRakutenItem({ itemName: `${keyword} rakuten` })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check(
      "fallback: trailing-S-drop case -> fallback succeeds with the S-dropped keyword",
      results[0].rakutenResults.map((r) => r.itemName),
      ["Nikon NIKKOR Z70-200mm f/2.8 VR rakuten"],
    );
    check("fallback: trailing-S-drop case -> no rakutenError", results[0].rakutenError, null);
  }
  {
    // 6g. end-to-end: the new standalone-digit/ampersand triggers also go
    // through runSearchMode's real 400-only, exactly-once fallback path
    // (searchRakutenWithFallback), same as the letter case above - not just
    // the pure buildRakutenFallbackKeyword() unit.
    const seeds: CandidateSeed[] = [
      { productName: "Jabra Elite 10 Gen 2", productType: "earbuds" },
      { productName: "Bang & Olufsen Beoplay Eleven", productType: "earbuds" },
    ];
    const rakutenCalls: string[] = [];
    const searchRakuten = async (keyword: string) => {
      rakutenCalls.push(keyword);
      if (keyword === "Jabra Elite 10 Gen 2" || keyword === "Bang & Olufsen Beoplay Eleven") {
        throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
      }
      return [fakeRakutenItem({ itemName: `${keyword} rakuten` })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check(
      "fallback: standalone-digit case -> fallback succeeds with the digit-merged keyword",
      results[0].rakutenResults.map((r) => r.itemName),
      ["Jabra Elite 10 Gen2 rakuten"],
    );
    check("fallback: standalone-digit case -> no rakutenError", results[0].rakutenError, null);
    check(
      "fallback: standalone-ampersand case -> fallback succeeds with the ampersand-dropped keyword",
      results[1].rakutenResults.map((r) => r.itemName),
      ["Bang Olufsen Beoplay Eleven rakuten"],
    );
    check("fallback: standalone-ampersand case -> no rakutenError", results[1].rakutenError, null);
    check(
      "fallback: exactly 2 rakuten calls per candidate (raw + 1 fallback, no more)",
      rakutenCalls,
      ["Jabra Elite 10 Gen 2", "Jabra Elite 10 Gen2", "Bang & Olufsen Beoplay Eleven", "Bang Olufsen Beoplay Eleven"],
    );
  }
  {
    // 6c. end-to-end: a multi-standalone-token query still triggers exactly
    // one fallback call, using the fully-merged keyword.
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Nikon NIKKOR Z 24-70mm f/2.8 S", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      calls.push(keyword);
      if (keyword === "Nikon NIKKOR Z 24-70mm f/2.8 S") throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
      return [fakeRakutenItem({ itemName: "fallback ok" })];
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check(
      "fallback: multi-token query -> exactly 2 calls, second is fully merged",
      calls,
      ["Nikon NIKKOR Z 24-70mm f/2.8 S", "Nikon NIKKOR Z24-70mm f/2.8S"],
    );
  }
  {
    // 6d. fallback of the fallback is forbidden: if the merged keyword still
    // 400s, no third call is made (max 2 requests total).
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Nikon NIKKOR Z 24-70mm f/2.8 S", productType: "camera" }];
    const searchRakuten = async (keyword: string) => {
      calls.push(keyword);
      throw new RakutenApiError("x", 400, { error: "wrong_parameter" });
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });
    check("fallback: merged keyword also 400s -> exactly 2 calls total, no third retry", calls, [
      "Nikon NIKKOR Z 24-70mm f/2.8 S",
      "Nikon NIKKOR Z24-70mm f/2.8S",
    ]);
    check("fallback: merged keyword also 400s -> safe rakutenError recorded", results[0].rakutenError, { kind: "http_error", status: 400, code: "wrong_parameter" });
  }

  // ============================================================
  // Coupang candidate SEARCH: A(productName)+B(modelSkuHint) union - never
  // used by the general Rakuten/Coupang refresh flow. B only ever ADDS to A,
  // never replaces it (see isSkuLikeModelSku's doc comment for why a bare
  // SKU-like code alone isn't trustworthy on Coupang).
  // ============================================================
  {
    // isSkuLikeModelSku: matches the rule confirmed against the live A/B/C
    // Coupang experiment (2026-09-10) - short alnum/hyphen token, no "mm".
    check("isSkuLikeModelSku: null/undefined -> false", [isSkuLikeModelSku(null), isSkuLikeModelSku(undefined)], [false, false]);
    check("isSkuLikeModelSku: empty string -> false", isSkuLikeModelSku(""), false);
    const skuLike = ["SEL2470GM2", "SEL70200GM2", "A063", "A058", "DC-S5M2", "ILCE-7RM5", "Z6III", "Zf", "OM-3", "X-T5"];
    check("isSkuLikeModelSku: known SKU-like codes all true", skuLike.map(isSkuLikeModelSku), skuLike.map(() => true));
    const notSkuLike = ["RF24-70mm F2.8 L IS USM", "NIKKOR Z 24-70mm f/2.8 S II", "24-70mm F2.8 DG DN II", "EOS R7", "24-70mm"];
    check("isSkuLikeModelSku: descriptive specs / space-containing / 'mm'-bearing all false", notSkuLike.map(isSkuLikeModelSku), notSkuLike.map(() => false));
  }
  {
    // unionCoupangResults: order preserved (A first, then only B's new
    // items), same externalId -> 1 entry with both matchedQueries.
    const a = [fakeCoupangProduct({ productId: 1, productName: "A-only" }), fakeCoupangProduct({ productId: 2, productName: "Shared (A's title)" })];
    const b = [fakeCoupangProduct({ productId: 2, productName: "Shared (B's title)" }), fakeCoupangProduct({ productId: 3, productName: "B-only" })];
    const union = unionCoupangResults(a, b);
    check("unionCoupangResults: order is A first, then only B's new items", union.map((p) => p.productId), [1, 2, 3]);
    check("unionCoupangResults: shared externalId keeps A's own fields (first-seen wins), not B's", union[1].productName, "Shared (A's title)");
    check("unionCoupangResults: matchedQueries - A-only", union[0].matchedQueries, ["productName"]);
    check("unionCoupangResults: matchedQueries - shared has both", union[1].matchedQueries, ["productName", "modelSkuHint"]);
    check("unionCoupangResults: matchedQueries - B-only", union[2].matchedQueries, ["modelSkuHint"]);
    check("unionCoupangResults: both empty -> empty", unionCoupangResults([], []), []);
  }
  {
    // not-SKU-like modelSkuHint -> Coupang is called exactly once (productName only)
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Canon RF24-70mm F2.8 L IS USM", productType: "camera_lens", modelSkuHint: "RF24-70mm F2.8 L IS USM" }];
    const searchCoupang = async (keyword: string) => {
      calls.push(keyword);
      return [fakeCoupangProduct({ productName: `${keyword} coupang` })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: not-SKU-like modelSkuHint -> exactly 1 call (productName only)", calls, ["Canon RF24-70mm F2.8 L IS USM"]);
    check("Coupang A+B: not-SKU-like -> result matchedQueries is productName only", results[0].coupangResults[0].matchedQueries, ["productName"]);
  }
  {
    // SKU-like modelSkuHint -> Coupang is called exactly twice (productName + modelSkuHint)
    const calls: string[] = [];
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => {
      calls.push(keyword);
      return [fakeCoupangProduct({ productId: calls.length, productName: `${keyword} coupang` })];
    };
    await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: SKU-like modelSkuHint -> exactly 2 calls (productName + modelSkuHint)", calls.sort(), ["SEL2470GM2", "Sony FE 24-70mm F2.8 GM II"]);
  }
  {
    // A succeeds, B fails -> A's results kept, no error (SKU-like modelSkuHint)
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => {
      if (keyword === "SEL2470GM2") throw new CoupangApiError("x", 500, { rCode: "ERROR", rMessage: "boom" });
      return [fakeCoupangProduct({ productName: "A result" })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: A succeeds, B fails -> A's results kept", results[0].coupangResults.map((r) => r.productName), ["A result"]);
    check("Coupang A+B: A succeeds, B fails -> no coupangError", results[0].coupangError, null);
  }
  {
    // A fails, B succeeds -> B's results kept (the case this feature exists
    // for: descriptive productName finds nothing/wrong things, the real SKU finds it)
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => {
      if (keyword === "Sony FE 24-70mm F2.8 GM II") throw new CoupangApiError("x", 500, { rCode: "ERROR", rMessage: "boom" });
      return [fakeCoupangProduct({ productName: "B result (found via SKU)" })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: A fails, B succeeds -> B's results kept", results[0].coupangResults.map((r) => r.productName), ["B result (found via SKU)"]);
    check("Coupang A+B: A fails, B succeeds -> no coupangError", results[0].coupangError, null);
  }
  {
    // both succeed, distinct externalIds -> union, both present
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => {
      if (keyword === "Sony FE 24-70mm F2.8 GM II") return [fakeCoupangProduct({ productId: 1, productName: "From A" })];
      return [fakeCoupangProduct({ productId: 2, productName: "From B" })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: both succeed, distinct ids -> union of both, A's order first", results[0].coupangResults.map((r) => r.productName), ["From A", "From B"]);
  }
  {
    // both succeed, same externalId -> deduped to 1 entry
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => [fakeCoupangProduct({ productId: 99, productName: `${keyword} title` })];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: same externalId from both queries -> deduped to 1", results[0].coupangResults.length, 1);
    check("Coupang A+B: deduped entry has both matchedQueries", results[0].coupangResults[0].matchedQueries, ["productName", "modelSkuHint"]);
  }
  {
    // both fail -> error reported (A's error, the always-attempted query), no crash
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async () => {
      throw new CoupangApiError("x", 500, { rCode: "ERROR", rMessage: "boom" });
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: both fail -> coupangResults empty", results[0].coupangResults, []);
    check("Coupang A+B: both fail -> coupangError recorded", results[0].coupangError, { kind: "http_error", status: 500, code: "boom" });
  }
  {
    // real-world pollution cases from the live experiment: A063/DC-S9/X-T5 -
    // B returns only unrelated noise, A's real results must survive untouched
    const pollutedSkus = ["A063", "DC-S9", "X-T5"];
    for (const sku of pollutedSkus) {
      const seeds: CandidateSeed[] = [{ productName: "Real Product Name", productType: "camera", modelSkuHint: sku }];
      const searchCoupang = async (keyword: string) => {
        if (keyword === sku) return [fakeCoupangProduct({ productId: 555, productName: "Unrelated noise product" })];
        return [fakeCoupangProduct({ productId: 1, productName: "Real Product Name coupang" })];
      };
      const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
      check(
        `Coupang A+B: polluted SKU "${sku}" -> A's real result still present alongside B's noise`,
        results[0].coupangResults.map((r) => r.productName),
        ["Real Product Name coupang", "Unrelated noise product"],
      );
    }
  }
  {
    // Sony SEL... shape from the live experiment: A alone finds only
    // accessories, B (SEL2470GM2) rescues the real lens - proves rule 6
    // (B still runs even though A "succeeded", just found nothing useful)
    const seeds: CandidateSeed[] = [{ productName: "Sony FE 24-70mm F2.8 GM II", productType: "camera_lens", modelSkuHint: "SEL2470GM2" }];
    const searchCoupang = async (keyword: string) => {
      if (keyword === "SEL2470GM2") return [fakeCoupangProduct({ productId: 2, productName: "소니 SEL2470GM2 (FE 24-70mm F2.8 GM 2)" })];
      return [fakeCoupangProduct({ productId: 1, productName: "호환 렌즈필터 (accessory only)" })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check(
      "Coupang A+B: Sony SEL... case - A succeeds (accessory only) but B still runs and adds the real lens",
      results[0].coupangResults.map((r) => r.productName),
      ["호환 렌즈필터 (accessory only)", "소니 SEL2470GM2 (FE 24-70mm F2.8 GM 2)"],
    );
  }
  {
    // one candidate's Coupang A+B failure never promotes to full candidate/source
    // batch failure - batch continues, next candidate searched normally
    const seeds: CandidateSeed[] = [
      { productName: "Failing Candidate", productType: "camera_lens", modelSkuHint: "A063" },
      { productName: "Second OK", productType: "camera" },
    ];
    const searchCoupang = async (keyword: string) => {
      if (keyword === "Failing Candidate" || keyword === "A063") throw new CoupangApiError("x", 500, { rCode: "ERROR", rMessage: "boom" });
      return [fakeCoupangProduct({ productName: `${keyword} coupang` })];
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: (async () => [fakeRakutenItem()]) as any, searchCoupang: searchCoupang as any });
    check("Coupang A+B: one candidate's total Coupang failure doesn't stop the batch", results.length, 2);
    check("Coupang A+B: failing candidate's coupangResults empty, error recorded", { r: results[0].coupangResults, e: results[0].coupangError }, { r: [], e: { kind: "http_error", status: 500, code: "boom" } });
    check("Coupang A+B: next candidate searched normally", results[1].coupangResults.map((r) => r.productName), ["Second OK coupang"]);
  }

  {
    // 7 + 8. flat Rakuten { error } shape extracted as a safe code; error_description/credentials never surfaced
    const seeds: CandidateSeed[] = [{ productName: "Flat Error Product", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten API responded 400", 400, {
        error: "wrong_parameter",
        error_description: "keyword=SECRET-LOOKING-TEXT applicationId=SECRET-APP-ID is invalid",
      });
    };
    const searchCoupang = async () => [fakeCoupangProduct()];
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any });

    check("flat error shape: safe code extracted from body.error", results[0].rakutenError, { kind: "http_error", status: 400, code: "wrong_parameter" });
    const serialized = JSON.stringify(results[0].rakutenError);
    check(
      "flat error shape: error_description/credential text never leaked",
      serialized.includes("SECRET-LOOKING-TEXT") || serialized.includes("SECRET-APP-ID") || serialized.includes("error_description"),
      false,
    );
    check("flat error shape: only kind/status/code keys present", Object.keys(results[0].rakutenError!).sort(), ["code", "kind", "status"]);
  }
  {
    // unsafe-looking body.error values (not matching the safe pattern) are dropped, not surfaced
    const seeds: CandidateSeed[] = [{ productName: "Unsafe Error Shape Product", productType: "camera" }];
    const searchRakuten = async () => {
      throw new RakutenApiError("x", 400, { error: "this has spaces and is not a safe code" });
    };
    const results = await runSearchMode(seeds, FAKE_CREDS, { searchRakuten: searchRakuten as any, searchCoupang: (async () => [fakeCoupangProduct()]) as any });
    check("flat error shape: non-matching body.error is not surfaced as code", results[0].rakutenError, { kind: "http_error", status: 400 });
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
        { index: 0, itemName: "Rakuten Match", itemPrice: 100_000, itemUrl: "https://x", currency: "JPY", availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "included" },
      ],
      coupangResults: [
        { index: 0, productName: "Coupang Match", productPrice: 90_000, productUrl: "https://y", currency: "KRW", externalId: "c1", isRocket: true, matchedQueries: ["productName"], shippingStatus: "included" },
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
    // Same underlying candidate data, only matchConfidence differs -> verified used to reach ADD
    // pre-shipping-gate; now both land on REVIEW, but for different reasons (verified: shipping
    // gate only; estimated: capped by confidence, same as before) - the score gap below still
    // proves matchConfidence actually reached evaluateCandidate(), not just accepted and ignored.
    const strong = {
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "included" as const }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "included" as const }],
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

    check("matchConfidence passthrough: verified -> REVIEW (shipping gate, not a confidence cap)", verifiedResult.decision, "REVIEW");
    check("matchConfidence passthrough: verified -> reason is the shipping gate", verifiedResult.reasons.includes("국제배송비 미확인 - 총 구매가 확인 필요"), true);
    check("matchConfidence passthrough: estimated (same score) -> REVIEW", estimatedResult.decision, "REVIEW");
    check("matchConfidence passthrough: estimated score is lower by exactly the B2 gap (15 vs 7)", verifiedResult.totalScore - estimatedResult.totalScore, 8);

    const riskCandidate = candidateWithResults({ productName: "Risky", ...strong, matchConfidence: "verified", riskFlags: [{ type: "region_lock" }] });
    const riskOutcome = await runEvaluateMode([riskCandidate], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("riskFlags passthrough: region_lock -> SKIP", riskOutcome.evaluated[0].decision, "SKIP");
    check("riskFlags passthrough: riskFlags preserved on the result", riskOutcome.evaluated[0].riskFlags, [{ type: "region_lock" }]);
  }

  // ============================================================
  // EVALUATE MODE: mount gate wiring - runEvaluateMode() must actually pass
  // variantAttributes.mount/rakutenSelectedMount/coupangSelectedMount through
  // to evaluateCandidate() as targetMount/rakutenMount/coupangMount.
  // ============================================================
  {
    const strongLens = {
      productType: "camera_lens",
      modelSkuHint: "SEL2470GM2",
      rakutenResults: [{ index: 0, itemName: "Sony FE 24-70mm F2.8 GM II SEL2470GM2", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "included" as const }],
      coupangResults: [{ index: 0, productName: "소니 SEL2470GM2 FE 24-70mm F2.8 GM II", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "included" as const }],
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      matchConfidence: "verified" as const,
    };

    // no variantAttributes at all -> targetMount null -> REVIEW (rule 1)
    const noVariantAttrs = candidateWithResults({ productName: "NoVariantAttrs", ...strongLens });
    const noVariantOutcome = await runEvaluateMode([noVariantAttrs], { camera_lens: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: no variantAttributes -> REVIEW (targetMount defaults to null)", noVariantOutcome.evaluated[0].decision, "REVIEW");

    // variantAttributes.mount=sony_e + matching selected mounts -> mount gate
    // passes (score qualifies for ADD), shipping gate still forces REVIEW
    const matching = candidateWithResults({
      productName: "Matching",
      ...strongLens,
      variantAttributes: { mount: "sony_e" },
      rakutenSelectedMount: "sony_e",
      coupangSelectedMount: "sony_e",
    });
    const matchingOutcome = await runEvaluateMode([matching], { camera_lens: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: variantAttributes.mount=sony_e + matching selected mounts -> mount gate passes, score qualifies", matchingOutcome.evaluated[0].totalScore >= 70, true);
    check("EVALUATE wiring: variantAttributes.mount=sony_e + matching selected mounts -> REVIEW via shipping gate, not the mount gate", matchingOutcome.evaluated[0].decision, "REVIEW");
    check("EVALUATE wiring: matching mounts -> reason is the shipping gate", matchingOutcome.evaluated[0].reasons.includes("국제배송비 미확인 - 총 구매가 확인 필요"), true);

    // variantAttributes.mount=sony_e but coupangSelectedMount=nikon_z -> SKIP via variant_mismatch
    const mismatching = candidateWithResults({
      productName: "Mismatching",
      ...strongLens,
      variantAttributes: { mount: "sony_e" },
      rakutenSelectedMount: "sony_e",
      coupangSelectedMount: "nikon_z",
    });
    const mismatchOutcome = await runEvaluateMode([mismatching], { camera_lens: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: coupangSelectedMount=nikon_z vs target sony_e -> SKIP", mismatchOutcome.evaluated[0].decision, "SKIP");
    check("EVALUATE wiring: mismatch decision carries a derived variant_mismatch flag", mismatchOutcome.evaluated[0].riskFlags.some((f) => f.type === "variant_mismatch"), true);
  }

  // ============================================================
  // EVALUATE MODE: shipping status wiring - runEvaluateMode() must pass the
  // SELECTED rakuten/coupang result's own shippingStatus through to
  // evaluateCandidate() as rakutenShippingStatus/coupangShippingStatus.
  // Never changes the score itself. 2nd-pass safety fix: every one of these
  // is REVIEW regardless of shippingStatus value, because `rakuten` is
  // always the JP/international leg and a Rakuten "included" (postageFlag=0)
  // is never a Korea-bound-cost confirmation - see candidateEvaluationService.ts.
  // ============================================================
  {
    const strongWetsuit = {
      productType: "wetsuit",
      modelSkuHint: "MODEL-X",
      rakutenSelectedIndex: 0,
      coupangSelectedIndex: 0,
      matchConfidence: "verified" as const,
    };

    // both sides included -> still REVIEW (rakuten "included" never resolves this gate)
    const bothIncluded = candidateWithResults({
      productName: "BothIncluded",
      ...strongWetsuit,
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "included" as const }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "included" as const }],
    });
    const bothIncludedOutcome = await runEvaluateMode([bothIncluded], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: shippingStatus included/included -> still REVIEW (rakuten leg always unconfirmed)", bothIncludedOutcome.evaluated[0].decision, "REVIEW");
    check("EVALUATE wiring: included/included -> reason present", bothIncludedOutcome.evaluated[0].reasons.includes("국제배송비 미확인 - 총 구매가 확인 필요"), true);

    // rakuten side separate -> same REVIEW, score unchanged
    const rakutenSeparate = candidateWithResults({
      productName: "RakutenSeparate",
      ...strongWetsuit,
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "separate" as const }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "included" as const }],
    });
    const rakutenSeparateOutcome = await runEvaluateMode([rakutenSeparate], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: rakuten shippingStatus=separate -> REVIEW", rakutenSeparateOutcome.evaluated[0].decision, "REVIEW");
    check("EVALUATE wiring: shipping-gate reason present", rakutenSeparateOutcome.evaluated[0].reasons.includes("국제배송비 미확인 - 총 구매가 확인 필요"), true);
    check("EVALUATE wiring: shipping gate does not change totalScore", rakutenSeparateOutcome.evaluated[0].totalScore, bothIncludedOutcome.evaluated[0].totalScore);

    // coupang side unknown -> same REVIEW
    const coupangUnknown = candidateWithResults({
      productName: "CoupangUnknown",
      ...strongWetsuit,
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "included" as const }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "unknown" as const }],
    });
    const coupangUnknownOutcome = await runEvaluateMode([coupangUnknown], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: coupang shippingStatus=unknown -> REVIEW", coupangUnknownOutcome.evaluated[0].decision, "REVIEW");

    // no shippingStatus at all on either pick (undefined -> unknown, no bypass)
    const noShippingAtAll = candidateWithResults({
      productName: "NoShippingAtAll",
      ...strongWetsuit,
      rakutenResults: [{ index: 0, itemName: "MODEL-X item", itemPrice: 500_000, itemUrl: "https://x", currency: "JPY" as const, availability: true, externalId: "r1", shopName: "Shop", shippingStatus: "unknown" as const }],
      coupangResults: [{ index: 0, productName: "MODEL-X item", productPrice: 300_000, productUrl: "https://y", currency: "KRW" as const, externalId: "c1", isRocket: true, matchedQueries: ["productName" as const], shippingStatus: "unknown" as const }],
    });
    const noShippingAtAllOutcome = await runEvaluateMode([noShippingAtAll], { wetsuit: 0 }, IDENTITY_CONVERT);
    check("EVALUATE wiring: both unknown -> REVIEW, ADD unreachable via this evaluator until a real Korea-bound-cost source exists", noShippingAtAllOutcome.evaluated[0].decision, "REVIEW");
  }

  // ============================================================
  // EVALUATE MODE: rakuten/coupangReviewStatus - distinguishes "not yet
  // reviewed" (pending) from "reviewed, no matching product" (no_match),
  // which previously both collapsed into the same skippedUnselected bucket
  // via selectedIndex=null.
  // ============================================================
  {
    // 1. either side "pending" -> skippedUnselected, never evaluated
    const bothPending = candidateWithResults({ productName: "BothPending", rakutenReviewStatus: "pending", rakutenSelectedIndex: null, coupangReviewStatus: "pending", coupangSelectedIndex: null });
    const rakutenPendingOnly = candidateWithResults({ productName: "RakutenPendingOnly", rakutenReviewStatus: "pending", rakutenSelectedIndex: null, coupangReviewStatus: "selected" });
    const coupangPendingOnly = candidateWithResults({ productName: "CoupangPendingOnly", coupangReviewStatus: "pending", coupangSelectedIndex: null, rakutenReviewStatus: "selected" });
    const pendingOutcome = await runEvaluateMode([bothPending, rakutenPendingOnly, coupangPendingOnly], { camera: 0 }, IDENTITY_CONVERT);
    check("reviewStatus: any side pending -> skippedUnselected, none evaluated", pendingOutcome.skippedUnselected.sort(), ["BothPending", "CoupangPendingOnly", "RakutenPendingOnly"]);
    check("reviewStatus: pending candidates produce no invalid-selection entries", pendingOutcome.invalidSelections, []);
    check("reviewStatus: pending candidates produce no evaluated results", pendingOutcome.evaluated, []);
  }
  {
    // 2. "selected" + a valid index -> evaluated normally
    const selected = candidateWithResults({ productName: "Selected", rakutenReviewStatus: "selected", coupangReviewStatus: "selected" });
    const outcome = await runEvaluateMode([selected], { camera: 0 }, IDENTITY_CONVERT);
    check("reviewStatus: selected + valid index -> evaluated", outcome.evaluated.length, 1);
    check("reviewStatus: selected + valid index -> no invalid/skipped", [outcome.skippedUnselected, outcome.invalidSelections], [[], []]);
  }
  {
    // 3. "selected" but index is null -> invalidSelections (never evaluated)
    const badRakuten = candidateWithResults({ productName: "SelectedNoIndexRakuten", rakutenReviewStatus: "selected", rakutenSelectedIndex: null, coupangReviewStatus: "selected" });
    const outcome = await runEvaluateMode([badRakuten], { camera: 0 }, IDENTITY_CONVERT);
    check("reviewStatus: selected + null index -> invalid, not evaluated", { evaluated: outcome.evaluated.length, invalid: outcome.invalidSelections.length }, { evaluated: 0, invalid: 1 });
    check("reviewStatus: selected + null index -> reason mentions selected/index", outcome.invalidSelections[0].reason.includes("selected") && outcome.invalidSelections[0].reason.includes("Index"), true);
  }
  {
    // 4. "no_match" + index null -> normal: reaches evaluateCandidate() as a
    // missing candidate, comes back SKIP via the existing hard gate (not
    // skippedUnselected, not invalidSelections).
    const noMatch = candidateWithResults({ productName: "NoMatchNormal", rakutenReviewStatus: "no_match", rakutenSelectedIndex: null, rakutenSelectedMount: null, coupangReviewStatus: "selected" });
    const outcome = await runEvaluateMode([noMatch], { camera: 0 }, IDENTITY_CONVERT);
    check("reviewStatus: no_match + null index -> evaluated (not skipped/invalid)", { evaluated: outcome.evaluated.length, skipped: outcome.skippedUnselected, invalid: outcome.invalidSelections }, { evaluated: 1, skipped: [], invalid: [] });
    check("reviewStatus: no_match + null index -> decision is SKIP (missing-source hard gate)", outcome.evaluated[0].decision, "SKIP");
  }
  {
    // 5. "no_match" but an index is still set -> invalidSelections (contradiction)
    const contradiction = candidateWithResults({ productName: "NoMatchButIndexSet", rakutenReviewStatus: "no_match", rakutenSelectedIndex: 0, coupangReviewStatus: "selected" });
    const outcome = await runEvaluateMode([contradiction], { camera: 0 }, IDENTITY_CONVERT);
    check("reviewStatus: no_match + index still set -> invalid, not evaluated", { evaluated: outcome.evaluated.length, invalid: outcome.invalidSelections.length }, { evaluated: 0, invalid: 1 });
    check("reviewStatus: no_match + index still set -> reason mentions no_match/index", outcome.invalidSelections[0].reason.includes("no_match") && outcome.invalidSelections[0].reason.includes("0"), true);
  }
  {
    // 6/7. one side selected, the other confirmed no_match -> SKIP either way
    // (rakuten/coupang: null flows into evaluateCandidate()'s existing
    // missing-source hard gate), and that hard gate fires before any FX call.
    let convertCalls = 0;
    const COUNTING_CONVERT: ConvertToKrwFn = async (price) => { convertCalls++; return { krwPrice: price, fxRateUsed: 1, fxAsOf: null }; };

    const rakutenSelectedCoupangNoMatch = candidateWithResults({ productName: "R-selected-C-no_match", rakutenReviewStatus: "selected", coupangReviewStatus: "no_match", coupangSelectedIndex: null, coupangSelectedMount: null });
    const outcome1 = await runEvaluateMode([rakutenSelectedCoupangNoMatch], { camera: 0 }, COUNTING_CONVERT);
    check("reviewStatus: R selected / C no_match -> SKIP", outcome1.evaluated[0].decision, "SKIP");

    const rakutenNoMatchCoupangSelected = candidateWithResults({ productName: "R-no_match-C-selected", rakutenReviewStatus: "no_match", rakutenSelectedIndex: null, rakutenSelectedMount: null, coupangReviewStatus: "selected" });
    const outcome2 = await runEvaluateMode([rakutenNoMatchCoupangSelected], { camera: 0 }, COUNTING_CONVERT);
    check("reviewStatus: R no_match / C selected -> SKIP", outcome2.evaluated[0].decision, "SKIP");

    check("reviewStatus: missing-source SKIP never calls the FX converter", convertCalls, 0);
  }
  {
    // Mount-aware + no_match interaction: the missing-source hard gate must
    // win over the mount gate's own "REVIEW forced" path (targetMount set but
    // one side's mount missing) - a no_match candidate should still come back
    // SKIP, not REVIEW, and without touching FX.
    let convertCalls = 0;
    const COUNTING_CONVERT: ConvertToKrwFn = async (price) => { convertCalls++; return { krwPrice: price, fxRateUsed: 1, fxAsOf: null }; };
    const lensNoMatch = candidateWithResults({
      productName: "LensCoupangNoMatch",
      productType: "camera_lens",
      variantAttributes: { mount: "sony_e" },
      rakutenReviewStatus: "selected",
      rakutenSelectedMount: "sony_e",
      coupangReviewStatus: "no_match",
      coupangSelectedIndex: null,
      coupangSelectedMount: null,
    });
    const outcome = await runEvaluateMode([lensNoMatch], { camera_lens: 0 }, COUNTING_CONVERT);
    check("reviewStatus: mount-aware candidate, Coupang no_match -> SKIP (missing-source gate wins over mount REVIEW)", outcome.evaluated[0].decision, "SKIP");
    check("reviewStatus: mount-aware no_match SKIP never calls the FX converter", convertCalls, 0);
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

const GCS_METADATA_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function gcsTokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
}

/** Fakes both the metadata-server token endpoint and the GCS JSON API download/upload endpoints - never calls anything real. */
function makeFakeGcsFetch(fixtures: Record<string, string> = {}): { fetchFn: FetchFn; uploads: { bucket: string; object: string; body: string }[] } {
  const uploads: { bucket: string; object: string; body: string }[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === GCS_METADATA_URL) return gcsTokenResponse();

    const downloadMatch = /^https:\/\/storage\.googleapis\.com\/storage\/v1\/b\/([^/]+)\/o\/([^?]+)\?alt=media$/.exec(url);
    if (downloadMatch) {
      const bucket = decodeURIComponent(downloadMatch[1]);
      const object = decodeURIComponent(downloadMatch[2]);
      const key = `${bucket}/${object}`;
      if (!(key in fixtures)) return new Response("not found", { status: 404 });
      return new Response(fixtures[key], { status: 200 });
    }

    const uploadMatch = /^https:\/\/storage\.googleapis\.com\/upload\/storage\/v1\/b\/([^/]+)\/o\?uploadType=media&name=([^&]+)$/.exec(url);
    if (uploadMatch) {
      const bucket = decodeURIComponent(uploadMatch[1]);
      const object = decodeURIComponent(uploadMatch[2]);
      uploads.push({ bucket, object, body: typeof init?.body === "string" ? init.body : "" });
      return new Response("", { status: 200 });
    }

    return new Response(`unexpected fake fetch call: ${url}`, { status: 500 });
  }) as FetchFn;
  return { fetchFn, uploads };
}

  // ============================================================
  // runSearchModeWithIo: local file mode keeps working exactly as before
  // ============================================================
  {
    const dir = mkdtempSync(join(tmpdir(), "candidate-search-io-test-"));
    const inputPath = join(dir, "seed.json");
    const outputPath = join(dir, "searched.json");
    writeFileSyncNode(inputPath, JSON.stringify([{ productName: "Local Product", productType: "camera" }]), "utf8");

    const searchRakuten = async () => [fakeRakutenItem({ itemName: "Local rakuten", postageFlag: 1 })];
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Local coupang", isFreeShipping: false })];

    const { results, outputLocation } = await runSearchModeWithIo(
      { input: { kind: "local", path: inputPath }, output: { kind: "local", path: outputPath } },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any },
    );

    check("local mode: outputLocation is the local path", outputLocation, outputPath);
    check("local mode: results reflect the local input file", results[0].productName, "Local Product");
    const written = JSON.parse(readFileSyncNode(outputPath, "utf8"));
    check("local mode: output file actually written with the same results", written[0].rakutenResults[0].itemName, "Local rakuten");
    check("local mode: shippingStatus survives into the written searched.json (rakuten postageFlag=1 -> separate)", written[0].rakutenResults[0].shippingStatus, "separate");
    check("local mode: shippingStatus survives into the written searched.json (coupang isFreeShipping=false -> separate)", written[0].coupangResults[0].shippingStatus, "separate");

    rmSync(dir, { recursive: true, force: true });
  }

  // ============================================================
  // runSearchModeWithIo: GCS mode reuses runSearchMode() as-is and uploads the exact result
  // ============================================================
  {
    const { fetchFn, uploads } = makeFakeGcsFetch({
      "in-bucket/candidate-search/input/seed.json": JSON.stringify([{ productName: "GCS Product", productType: "camera" }]),
    });
    const searchRakuten = async () => [fakeRakutenItem({ itemName: "GCS rakuten", postageFlag: 0 })];
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "GCS coupang", isFreeShipping: true })];

    const { results, outputLocation } = await runSearchModeWithIo(
      {
        input: { kind: "gcs", uri: "gs://in-bucket/candidate-search/input/seed.json" },
        output: { kind: "gcs", uri: "gs://out-bucket/candidate-search/output/searched.json" },
      },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any, fetchFn },
    );

    check("GCS mode: outputLocation is the gs:// URI", outputLocation, "gs://out-bucket/candidate-search/output/searched.json");
    check("GCS mode: input read from GCS reaches runSearchMode", results[0].productName, "GCS Product");
    check("GCS mode: exactly one upload, to the exact requested bucket/object", uploads.length, 1);
    check("GCS mode: upload target bucket", uploads[0].bucket, "out-bucket");
    check("GCS mode: upload target object", uploads[0].object, "candidate-search/output/searched.json");
    const uploadedResults: CandidateSearchOutput[] = JSON.parse(uploads[0].body);
    check("GCS mode: uploaded body is exactly runSearchMode's own result (same rakuten item)", uploadedResults[0].rakutenResults[0].itemName, "GCS rakuten");
    check("GCS mode: uploaded body is exactly runSearchMode's own result (same coupang item)", uploadedResults[0].coupangResults[0].productName, "GCS coupang");
    check("GCS mode: shippingStatus survives the upload round-trip (rakuten postageFlag=0 -> included)", uploadedResults[0].rakutenResults[0].shippingStatus, "included");
    check("GCS mode: shippingStatus survives the upload round-trip (coupang isFreeShipping=true -> included)", uploadedResults[0].coupangResults[0].shippingStatus, "included");
  }

  // ============================================================
  // runSearchModeWithIo: source partial failure is preserved through to the GCS upload
  // ============================================================
  {
    const { fetchFn, uploads } = makeFakeGcsFetch({
      "in-bucket/seed.json": JSON.stringify([{ productName: "Partial Fail Product", productType: "camera" }]),
    });
    const searchRakuten = async () => {
      throw new RakutenApiError("Rakuten API responded 403", 403, { errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" } });
    };
    const searchCoupang = async () => [fakeCoupangProduct({ productName: "Still Present" })];

    await runSearchModeWithIo(
      { input: { kind: "gcs", uri: "gs://in-bucket/seed.json" }, output: { kind: "gcs", uri: "gs://out-bucket/searched.json" } },
      FAKE_CREDS,
      { searchRakuten: searchRakuten as any, searchCoupang: searchCoupang as any, fetchFn },
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
