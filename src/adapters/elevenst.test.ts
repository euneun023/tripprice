/**
 * Offline regression tests for src/adapters/elevenst.ts. No network call -
 * see this repo's existing no-test-runner convention (coupang.test.ts,
 * searchAliases.test.ts): run directly with
 *   npx tsx src/adapters/elevenst.test.ts
 * Exits non-zero on any failure.
 *
 * The fixture below is a RECONSTRUCTION, not a captured real response: it
 * encodes the field names/shape confirmed from a real ProductSearch call
 * (HTTP 200, EUC-KR XML, CDATA-wrapped ProductName/SellerNick/
 * DetailPageUrl, ProductCode/ProductPrice/SalePrice/Seller present,
 * TotalCount separate from the page's product count) plus a simulated
 * echoed-key leak (<Arguments><key>...</key></Arguments>) matching what
 * was observed live - replace with the real captured response (key
 * already redacted) if/when one is saved into this repo, since 11st's
 * full error-envelope shape is still unconfirmed otherwise.
 *
 * Never put a real 11st API key in this file, even a revoked one.
 */
import { parseElevenstResponse, searchElevenstProduct, ElevenstApiError } from "./elevenst";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}
function checkTrue(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const FAKE_KEY = "FAKE-TEST-KEY-DO-NOT-USE-1234567890";

function buildFixtureXml(apiKey: string): string {
  return `<?xml version="1.0" encoding="euc-kr"?>
<ProductSearchResponse>
  <Header><resultCode>00</resultCode><resultMsg>SUCCESS</resultMsg></Header>
  <Request>
    <Arguments>
      <key>${apiKey}</key>
      <apiCode>ProductSearch</apiCode>
      <keyword>Sony FE 24mm F1.4 GM</keyword>
    </Arguments>
  </Request>
  <TotalCount>75</TotalCount>
  <Products>
    <Product>
      <ProductCode>1234567890</ProductCode>
      <ProductName><![CDATA[소니 FE 24mm F1.4 GM]]></ProductName>
      <ProductPrice>2390000</ProductPrice>
      <SalePrice>2190000</SalePrice>
      <Seller>11st</Seller>
      <SellerNick><![CDATA[소니 공식스토어]]></SellerNick>
      <DetailPageUrl><![CDATA[http://www.11st.co.kr/products/1234567890]]></DetailPageUrl>
    </Product>
  </Products>
</ProductSearchResponse>`;
}

/** Minimal EUC-KR encoder covering only the handful of Korean characters
 * used in the fixture above - NOT a general encoder. Lets the EUC-KR
 * decode path be tested without depending on an external iconv binary
 * being present wherever these tests run. Byte values confirmed via
 * `printf '<char>' | iconv -f UTF-8 -t EUC-KR | od -An -tx1`. */
const EUCKR_BYTES: Record<string, [number, number]> = {
  "소": [0xbc, 0xd2],
  "니": [0xb4, 0xcf],
  "공": [0xb0, 0xf8],
  "식": [0xbd, 0xc4],
  "스": [0xbd, 0xba],
  "토": [0xc5, 0xe4],
  "어": [0xbe, 0xee],
};

function toEucKrBuffer(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of str) {
    const pair = EUCKR_BYTES[ch];
    if (pair) {
      bytes.push(pair[0], pair[1]);
    } else {
      const code = ch.codePointAt(0)!;
      if (code > 0x7f) throw new Error(`toEucKrBuffer: no mapping for character "${ch}" - extend EUCKR_BYTES`);
      bytes.push(code);
    }
  }
  return new Uint8Array(bytes);
}

async function withFakeFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function fakeResponse(status: number, bodyBytes: Uint8Array, contentType: string | null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength),
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
  } as unknown as Response;
}

async function throws(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

function assertNeverContainsKey(label: string, text: string, key: string) {
  checkTrue(`${label} never contains the raw API key`, !text.includes(key));
}

async function main() {
  // ============================================================
  // 1. parseElevenstResponse() - pure parsing, UTF-8 fixture text (no
  //    encoding concerns here - that's covered separately below)
  // ============================================================
  {
    const parsed = parseElevenstResponse(buildFixtureXml(FAKE_KEY));
    check("totalCount parsed separately from page product count", parsed.totalCount, 75);
    check("resultCode found", parsed.resultCode, "00");
    check("resultMessage found", parsed.resultMessage, "SUCCESS");
    check("exactly 1 product on this page", parsed.products.length, 1);
    const p = parsed.products[0];
    check("ProductCode extracted (string, not number - no leading-zero loss)", p.productCode, "1234567890");
    check("ProductName CDATA unwrapped to real text", p.productName, "소니 FE 24mm F1.4 GM");
    check("ProductPrice extracted", p.productPrice, "2390000");
    check("SalePrice extracted", p.salePrice, "2190000");
    check("Seller extracted", p.seller, "11st");
    check("SellerNick CDATA unwrapped to real text", p.sellerNick, "소니 공식스토어");
    check("DetailPageUrl CDATA unwrapped to real URL", p.detailPageUrl, "http://www.11st.co.kr/products/1234567890");
  }

  // ============================================================
  // 2. searchElevenstProduct() - EUC-KR decoding + redaction, via a fake
  //    fetch returning real EUC-KR bytes (not just UTF-8 text)
  // ============================================================
  {
    const xmlUtf8 = buildFixtureXml(FAKE_KEY);
    const bodyBytes = toEucKrBuffer(xmlUtf8);
    const fake = (async () => fakeResponse(200, bodyBytes, "text/xml; charset=euc-kr")) as typeof fetch;

    const result = await withFakeFetch(fake, () => searchElevenstProduct({ apiKey: FAKE_KEY }, "Sony FE 24mm F1.4 GM", 1));

    check("HTTP 200 surfaced", result.status, 200);
    check("TotalCount (75) kept separate from products.length (1)", [result.totalCount, result.products.length], [75, 1]);
    check("EUC-KR decoded correctly: ProductName", result.products[0].productName, "소니 FE 24mm F1.4 GM");
    check("EUC-KR decoded correctly: SellerNick", result.products[0].sellerNick, "소니 공식스토어");

    assertNeverContainsKey("requestUrlRedacted", result.requestUrlRedacted, FAKE_KEY);
    assertNeverContainsKey("rawResponseTextRedacted", result.rawResponseTextRedacted, FAKE_KEY);
    checkTrue(
      "rawResponseTextRedacted still contains the echoed <key> element (structure kept, value redacted)",
      result.rawResponseTextRedacted.includes("<key><redacted></key>"),
    );
  }

  // ============================================================
  // 3. Missing/absent Content-Type header - must still default to EUC-KR
  //    rather than mangling the Korean text as UTF-8/latin1
  // ============================================================
  {
    const bodyBytes = toEucKrBuffer(buildFixtureXml(FAKE_KEY));
    const fake = (async () => fakeResponse(200, bodyBytes, null)) as typeof fetch;
    const result = await withFakeFetch(fake, () => searchElevenstProduct({ apiKey: FAKE_KEY }, "kw", 1));
    check("no Content-Type header -> still decodes as EUC-KR by default", result.products[0].productName, "소니 FE 24mm F1.4 GM");
  }

  // ============================================================
  // 4. HTTP 200 does not by itself mean success - a non-success resultCode
  //    must still be surfaced (not silently treated as "0 results")
  // ============================================================
  {
    const errorXml = `<ProductSearchResponse><Header><resultCode>99</resultCode><resultMsg>INVALID_KEY</resultMsg></Header></ProductSearchResponse>`;
    const fake = (async () => fakeResponse(200, new TextEncoder().encode(errorXml), "text/xml; charset=euc-kr")) as typeof fetch;
    const result = await withFakeFetch(fake, () => searchElevenstProduct({ apiKey: FAKE_KEY }, "kw", 1));
    check("HTTP 200 + non-success resultCode is still surfaced, not swallowed", result.resultCode, "99");
    check("0 products when the envelope reports an error", result.products.length, 0);
  }

  // ============================================================
  // 5. Non-2xx HTTP response - error body must still be redacted (the
  //    original bug: only the success path was redacted)
  // ============================================================
  {
    const bodyWithKey = `<Fault><key>${FAKE_KEY}</key><message>forbidden</message></Fault>`;
    const fake = (async () => fakeResponse(403, new TextEncoder().encode(bodyWithKey), "text/xml; charset=utf-8")) as typeof fetch;
    const err = await withFakeFetch(fake, () => throws(() => searchElevenstProduct({ apiKey: FAKE_KEY }, "kw", 1)));
    checkTrue("HTTP 403 throws ElevenstApiError", err instanceof ElevenstApiError);
    const body = (err as ElevenstApiError).body;
    checkTrue("error body is a string", typeof body === "string");
    assertNeverContainsKey("error ElevenstApiError.body", body as string, FAKE_KEY);
  }

  // ============================================================
  // 6. Transport failure (network error) - message must be redacted too,
  //    in case the underlying fetch error ever echoes the request URL
  // ============================================================
  {
    const fake = (async () => {
      throw new Error(`connect failed for key=${FAKE_KEY}`);
    }) as typeof fetch;
    const err = await withFakeFetch(fake, () => throws(() => searchElevenstProduct({ apiKey: FAKE_KEY }, "kw", 1)));
    checkTrue("transport failure throws ElevenstApiError", err instanceof ElevenstApiError);
    assertNeverContainsKey("transport-failure error.message", (err as Error).message, FAKE_KEY);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
