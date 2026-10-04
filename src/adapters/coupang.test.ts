/**
 * Boundary checks for deriveCoupangShippingStatus() - the only place
 * CoupangProduct.isFreeShipping is interpreted - plus D18O regression tests
 * for searchCoupangProduct()'s limit guard and response-envelope validation
 * (the two gaps that let the D18L limit=20 regression masquerade as a
 * total NOT_FOUND rather than a rejected request). No test runner is
 * configured in this repo (see src/domain/searchAliases.test.ts for the
 * same plain-assertion convention) - run directly:
 *   npx tsx src/adapters/coupang.test.ts
 * Exits non-zero on any failure. Never hits the real Coupang API - the
 * limit/rCode section replaces globalThis.fetch with a fake for its
 * duration, always restoring the original afterward.
 */
import { deriveCoupangShippingStatus, searchCoupangProduct, CoupangApiError, COUPANG_MAX_SEARCH_LIMIT } from "./coupang";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const creds = { accessKey: "x", secretKey: "y" };

/** Temporarily replaces globalThis.fetch for the duration of fn(), always
 * restoring the original afterward (even on throw) - same convention as
 * refreshService.test.ts's withFakeFetch(). */
async function withFakeFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function fakeJsonResponse(status: number, jsonBody: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(jsonBody),
      headers: { forEach: () => {} },
    }) as unknown as Response) as typeof fetch;
}

async function throws(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

async function main() {
  check("isFreeShipping=true -> included", deriveCoupangShippingStatus(true), "included");
  check("isFreeShipping=false -> separate", deriveCoupangShippingStatus(false), "separate");
  check("isFreeShipping missing (undefined) -> unknown, never assumed free", deriveCoupangShippingStatus(undefined), "unknown");

  // ============================================================
  // D18O 1. search limit guard - limit=10 is Coupang's documented max
  // ============================================================
  check("COUPANG_MAX_SEARCH_LIMIT is 10", COUPANG_MAX_SEARCH_LIMIT, 10);

  {
    // limit=10 (at the cap) must still reach fetch() normally, not be
    // rejected by the guard itself.
    let fetchCalled = false;
    const fake = (async (input: string) => {
      fetchCalled = true;
      check("limit=10 -> request querystring carries limit=10", new URL(input).searchParams.get("limit"), "10");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ rCode: "0", rMessage: "", data: { landingUrl: "u", productData: [] } }),
        headers: { forEach: () => {} },
      } as unknown as Response;
    }) as typeof fetch;
    await withFakeFetch(fake, () => searchCoupangProduct(creds, "kw", 10));
    check("limit=10 -> fetch() was actually called (not rejected by the guard)", fetchCalled, true);
  }
  {
    // limit=20 (the exact D18L regression value) must be rejected before
    // any network call - never silently clamped, never silently sent.
    let fetchCalled = false;
    const fake = (async () => {
      fetchCalled = true;
      throw new Error("fetch should never be called for an over-limit request");
    }) as typeof fetch;
    const err = await withFakeFetch(fake, () => throws(() => searchCoupangProduct(creds, "kw", 20)));
    check("limit=20 -> throws", err !== null, true);
    check("limit=20 -> NOT a CoupangApiError (caller error, not a seller/API failure)", err instanceof CoupangApiError, false);
    check("limit=20 -> fetch() never called", fetchCalled, false);
  }

  // ============================================================
  // D18O 2. response-envelope validation (rCode/rMessage)
  // ============================================================
  {
    // HTTP non-2xx - unaffected by this change, still a CoupangApiError.
    const fake = fakeJsonResponse(403, { rCode: "ERROR", rMessage: "forbidden" });
    const err = await withFakeFetch(fake, () => throws(() => searchCoupangProduct(creds, "kw", 10)));
    check("HTTP 403 -> CoupangApiError", err instanceof CoupangApiError, true);
    check("HTTP 403 -> status=403", (err as CoupangApiError).status, 403);
  }
  {
    // HTTP 200 + success rCode + a real match -> normal success.
    const product = { keyword: "kw", rank: 1, isRocket: false, isFreeShipping: true, productId: 123, productImage: "i", productName: "n", productPrice: 1000, productUrl: "u" };
    const fake = fakeJsonResponse(200, { rCode: "0", rMessage: "", data: { landingUrl: "u", productData: [product] } });
    const result = await withFakeFetch(fake, () => searchCoupangProduct(creds, "kw", 10));
    check("HTTP 200 + rCode=0 + 1 item -> items returned", result.items, [product]);
  }
  {
    // HTTP 200 + success rCode + genuinely zero results - a real NOT_FOUND
    // case - must still succeed with an empty array, not be mistaken for
    // the semantic-error case below.
    const fake = fakeJsonResponse(200, { rCode: "0", rMessage: "", data: { landingUrl: "u", productData: [] } });
    const result = await withFakeFetch(fake, () => searchCoupangProduct(creds, "kw", 10));
    check("HTTP 200 + rCode=0 + empty productData -> items=[] (real zero-results, not an error)", result.items, []);
  }
  {
    // THE regression case: HTTP 200 + a non-success rCode (what Coupang
    // actually sent back for the rejected limit=20 request) must throw,
    // never be read as "0 results found".
    const fake = fakeJsonResponse(200, { rCode: "1", rMessage: "Invalid parameter: limit", data: { landingUrl: "u", productData: [] } });
    const err = await withFakeFetch(fake, () => throws(() => searchCoupangProduct(creds, "kw", 10)));
    check("HTTP 200 + error rCode -> throws (D18O regression case)", err !== null, true);
    check("HTTP 200 + error rCode -> CoupangApiError", err instanceof CoupangApiError, true);
    check("HTTP 200 + error rCode -> status=200 (HTTP was fine, the envelope wasn't)", (err as CoupangApiError).status, 200);
    check("HTTP 200 + error rCode -> message carries rCode/rMessage for diagnosis", (err as CoupangApiError).message.includes("rCode=1") && (err as CoupangApiError).message.includes("Invalid parameter: limit"), true);
  }
  {
    // Malformed/unexpected body shape (no rCode at all) - also must not be
    // read as a successful empty result.
    const fake = fakeJsonResponse(200, { unexpected: "shape" });
    const err = await withFakeFetch(fake, () => throws(() => searchCoupangProduct(creds, "kw", 10)));
    check("HTTP 200 + missing rCode -> throws", err !== null, true);
    check("HTTP 200 + missing rCode -> CoupangApiError", err instanceof CoupangApiError, true);
  }
  {
    // Non-JSON body (e.g. an HTML error page served with a 200 status) -
    // same malformed-response handling, not a crash, not a false success.
    const fake = (async () =>
      ({ ok: true, status: 200, text: async () => "<html>not json</html>", headers: { forEach: () => {} } }) as unknown as Response) as typeof fetch;
    const err = await withFakeFetch(fake, () => throws(() => searchCoupangProduct(creds, "kw", 10)));
    check("HTTP 200 + non-JSON body -> throws", err !== null, true);
    check("HTTP 200 + non-JSON body -> CoupangApiError", err instanceof CoupangApiError, true);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}
main();
