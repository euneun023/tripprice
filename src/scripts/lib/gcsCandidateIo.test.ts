/**
 * Boundary/behavior checks for the GCS candidate I/O helpers. No test
 * runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/lib/gcsCandidateIo.test.ts
 * Exits non-zero on any failure. Never calls the real metadata server or
 * any real GCS endpoint - every case uses an in-memory fake fetch function
 * matching the injectable FetchFn shape.
 */
import { parseGsUri, isGsUri, downloadJsonFromGcs, uploadJsonToGcs, GcsIoError, type FetchFn } from "./gcsCandidateIo";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const METADATA_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFakeFetch(handler: (url: string, init?: RequestInit) => Response): { fetchFn: FetchFn; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
    }
    calls.push({ url, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : undefined });
    return handler(url, init);
  }) as FetchFn;
  return { fetchFn, calls };
}

function tokenResponse(token = "fake-token"): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600, token_type: "Bearer" }), { status: 200 });
}

async function main() {
  // ============================================================
  // A. parseGsUri / isGsUri - normal and malformed
  // ============================================================
  check("parseGsUri: gs://bucket/a/b.json", parseGsUri("gs://bucket/a/b.json"), { bucket: "bucket", object: "a/b.json" });
  check("isGsUri: valid gs:// URI", isGsUri("gs://bucket/a/b.json"), true);
  check("isGsUri: local path is not a gs:// URI", isGsUri("./local/file.json"), false);
  check("isGsUri: gs:// with no object path is invalid", isGsUri("gs://bucket-only"), false);
  {
    let threw = false;
    try {
      parseGsUri("not-a-gs-uri");
    } catch {
      threw = true;
    }
    check("parseGsUri: throws on malformed/non-gs URI", threw, true);
  }

  // ============================================================
  // B/C/D/E/K (part 1): successful download - metadata call shape, object
  // path URL encoding, Authorization header on the GCS call, JSON parsing
  // ============================================================
  {
    const bucket = "my-bucket";
    const object = "candidate-search/input/seed file.json"; // has both "/" and a space, to exercise real encoding
    const seedJson = JSON.stringify([{ productName: "X" }]);
    const { fetchFn, calls } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return tokenResponse("token-for-download");
      return new Response(seedJson, { status: 200 });
    });

    const data = await downloadJsonFromGcs(`gs://${bucket}/${object}`, fetchFn);

    check("download: returns parsed JSON", data, [{ productName: "X" }]);
    check("download: exactly 2 fetch calls (token, then object)", calls.length, 2);
    check("B: metadata call URL is exact", calls[0].url, METADATA_URL);
    check("B: metadata call includes Metadata-Flavor: Google", calls[0].headers["Metadata-Flavor"], "Google");
    check(
      "C: object path (incl. '/' and space) is fully URL-encoded in the download URL",
      calls[1].url,
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`,
    );
    check("D: download call carries Authorization: Bearer <token>", calls[1].headers["Authorization"], "Bearer token-for-download");
  }

  // ============================================================
  // F. metadata token request failure -> safe GcsIoError
  // ============================================================
  {
    const { fetchFn } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return new Response("forbidden", { status: 403 });
      return new Response("unexpected call", { status: 500 });
    });
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://b/o.json", fetchFn);
    } catch (e) {
      error = e;
    }
    check("F: token failure throws GcsIoError", error instanceof GcsIoError, true);
    check("F: token failure operation is 'token'", (error as GcsIoError).operation, "token");
    check("F: token failure carries the bare status", (error as GcsIoError).httpStatus, 403);
    check("F: token failure message is fixed/sanitized", (error as GcsIoError).message, "Metadata server token request failed");
  }

  // ============================================================
  // G. GCS download 403/404 -> only the status is safely exposed
  // ============================================================
  {
    const { fetchFn } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return tokenResponse();
      return new Response(JSON.stringify({ error: { message: "sensitive internal detail XYZ" } }), { status: 404 });
    });
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://b/o.json", fetchFn);
    } catch (e) {
      error = e;
    }
    check("G: download 404 throws GcsIoError with operation download", (error as GcsIoError).operation, "download");
    check("G: download 404 carries the bare status", (error as GcsIoError).httpStatus, 404);
    check("G: raw GCS error body text not present in the message", (error as GcsIoError).message.includes("sensitive internal detail"), false);
  }

  // ============================================================
  // E (continued): non-JSON body -> parse-failure GcsIoError
  // ============================================================
  {
    const { fetchFn } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return tokenResponse();
      return new Response("<html>not json</html>", { status: 200 });
    });
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://b/bad.json", fetchFn);
    } catch (e) {
      error = e;
    }
    check("download: non-JSON body throws GcsIoError", error instanceof GcsIoError, true);
    check("download: non-JSON body message references only the gs:// location", (error as GcsIoError).message, "gs://b/bad.json did not contain valid JSON");
  }

  // ============================================================
  // H/I/J: upload URL/name encoding, body, Content-Type
  // ============================================================
  {
    const bucket = "out-bucket";
    const object = "candidate-search/output/searched.json";
    const { fetchFn, calls } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return tokenResponse("token-for-upload");
      return new Response("", { status: 200 });
    });
    const payload = [{ productName: "Y", rakutenResults: [], coupangResults: [] }];
    await uploadJsonToGcs(`gs://${bucket}/${object}`, payload, fetchFn);

    check("upload: exactly 2 fetch calls (token, then upload)", calls.length, 2);
    check(
      "H: upload URL bucket/name encoded correctly",
      calls[1].url,
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    );
    check("I: upload body is exactly JSON.stringify(data)", calls[1].body, JSON.stringify(payload));
    check("J: upload Content-Type is application/json; charset=utf-8", calls[1].headers["Content-Type"], "application/json; charset=utf-8");
    check("upload: Authorization header present on the upload call", calls[1].headers["Authorization"], "Bearer token-for-upload");
    check("upload: POST method used", calls[1].method, "POST");
  }

  // ============================================================
  // K. a fresh token is fetched before EACH operation, never reused
  // ============================================================
  {
    let tokenCounter = 0;
    const { fetchFn, calls } = makeFakeFetch((url) => {
      if (url === METADATA_URL) {
        tokenCounter++;
        return tokenResponse(`token-${tokenCounter}`);
      }
      if (url.includes("/upload/")) return new Response("", { status: 200 });
      return new Response(JSON.stringify([{ productName: "Z" }]), { status: 200 });
    });

    await downloadJsonFromGcs("gs://b/in.json", fetchFn);
    await uploadJsonToGcs("gs://b/out.json", [{ x: 1 }], fetchFn);

    check("K: exactly 2 separate metadata token requests (one per operation)", calls.filter((c) => c.url === METADATA_URL).length, 2);
    const authHeaders = calls.filter((c) => c.headers["Authorization"]).map((c) => c.headers["Authorization"]);
    check("K: download and upload each carry a freshly fetched, distinct token", authHeaders, ["Bearer token-1", "Bearer token-2"]);
  }

  // ============================================================
  // L. error serialization: no token/Authorization/raw body leakage, even under adversarial input
  // ============================================================
  {
    const sensitiveToken = "SUPER-SECRET-TOKEN-VALUE";
    const { fetchFn } = makeFakeFetch((url) => {
      if (url === METADATA_URL) return tokenResponse(sensitiveToken);
      return new Response(`Authorization: Bearer ${sensitiveToken} - access denied, raw body detail`, { status: 403 });
    });
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://b/o.json", fetchFn);
    } catch (e) {
      error = e;
    }
    const serialized = JSON.stringify({
      message: (error as GcsIoError).message,
      operation: (error as GcsIoError).operation,
      location: (error as GcsIoError).location,
      httpStatus: (error as GcsIoError).httpStatus,
    });
    check("L: no token value leaked in serialized error", serialized.includes(sensitiveToken), false);
    check("L: no 'Authorization' text leaked in serialized error", serialized.includes("Authorization"), false);
    check("L: no raw response body text leaked in serialized error", serialized.includes("raw body detail"), false);
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
