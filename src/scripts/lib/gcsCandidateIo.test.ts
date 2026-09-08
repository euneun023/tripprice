/**
 * Boundary/behavior checks for the GCS candidate I/O helpers. No test
 * runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/lib/gcsCandidateIo.test.ts
 * Exits non-zero on any failure. Never calls the real @google-cloud/storage
 * API or any real GCS endpoint - every case uses an in-memory fake client
 * implementing the same narrow GcsClient shape.
 */
import { parseGsUri, isGsUri, downloadJsonFromGcs, uploadJsonToGcs, GcsIoError, type GcsClient } from "./gcsCandidateIo";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

/** A fake GcsClient that serves fixed in-memory JSON per (bucket, object) and records upload calls. */
function makeFakeClient(fixtures: Record<string, string> = {}): {
  client: GcsClient;
  uploads: { bucket: string; object: string; body: string }[];
} {
  const uploads: { bucket: string; object: string; body: string }[] = [];
  const client: GcsClient = {
    bucket(bucket: string) {
      return {
        file(object: string) {
          const key = `${bucket}/${object}`;
          return {
            async download() {
              if (!(key in fixtures)) {
                const err: any = new Error("No such object");
                err.code = 404;
                throw err;
              }
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

async function main() {
  // ============================================================
  // parseGsUri / isGsUri
  // ============================================================
  check("parseGsUri: gs://bucket/a/b.json", parseGsUri("gs://bucket/a/b.json"), { bucket: "bucket", object: "a/b.json" });
  check("parseGsUri: bucket-only path segment", parseGsUri("gs://my-bucket/file.json"), { bucket: "my-bucket", object: "file.json" });
  check("isGsUri: valid gs:// URI", isGsUri("gs://bucket/a/b.json"), true);
  check("isGsUri: local path is not a gs:// URI", isGsUri("./local/file.json"), false);
  check("isGsUri: http URL is not a gs:// URI", isGsUri("https://example.com/file.json"), false);
  check("isGsUri: gs:// with no object path is invalid", isGsUri("gs://bucket-only"), false);
  check("isGsUri: empty string is invalid", isGsUri(""), false);

  {
    let threw = false;
    try {
      parseGsUri("not-a-gs-uri");
    } catch {
      threw = true;
    }
    check("parseGsUri: throws on malformed/non-gs URI", threw, true);
  }
  {
    let threw = false;
    try {
      parseGsUri("gs://bucket-with-no-object-path");
    } catch {
      threw = true;
    }
    check("parseGsUri: throws when there's no object path after the bucket", threw, true);
  }

  // ============================================================
  // downloadJsonFromGcs: success
  // ============================================================
  {
    const { client } = makeFakeClient({ "my-bucket/candidate-search/input/seed.json": JSON.stringify([{ productName: "X" }]) });
    const data = await downloadJsonFromGcs("gs://my-bucket/candidate-search/input/seed.json", client);
    check("download: returns parsed JSON", data, [{ productName: "X" }]);
  }

  // ============================================================
  // downloadJsonFromGcs: JSON parse failure
  // ============================================================
  {
    const { client } = makeFakeClient({ "my-bucket/bad.json": "{ not valid json" });
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://my-bucket/bad.json", client);
    } catch (e) {
      error = e;
    }
    check("download: JSON parse failure throws GcsIoError", error instanceof GcsIoError, true);
    check("download: parse-failure message references only the gs:// location", (error as GcsIoError).message, "gs://my-bucket/bad.json did not contain valid JSON");
  }

  // ============================================================
  // downloadJsonFromGcs: object not found (download itself fails)
  // ============================================================
  {
    const { client } = makeFakeClient({});
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://my-bucket/missing.json", client);
    } catch (e) {
      error = e;
    }
    check("download: missing object throws GcsIoError", error instanceof GcsIoError, true);
    check("download: missing object carries the bare status code", (error as GcsIoError).httpStatus, 404);
    check("download: missing object location is the gs:// bucket/object, nothing else", (error as GcsIoError).location, { bucket: "my-bucket", object: "missing.json" });
  }

  // ============================================================
  // uploadJsonToGcs: writes to the exact bucket/object requested
  // ============================================================
  {
    const { client, uploads } = makeFakeClient();
    const payload = [{ productName: "Y", rakutenResults: [], coupangResults: [] }];
    await uploadJsonToGcs("gs://out-bucket/candidate-search/output/searched.json", payload, client);
    check("upload: exactly one upload call", uploads.length, 1);
    check("upload: correct bucket", uploads[0].bucket, "out-bucket");
    check("upload: correct object path", uploads[0].object, "candidate-search/output/searched.json");
    check("upload: body round-trips to the same data", JSON.parse(uploads[0].body), payload);
  }

  // ============================================================
  // Error serialization: no credential/token/header leakage
  // ============================================================
  {
    const client: GcsClient = {
      bucket(bucket: string) {
        return {
          file(object: string) {
            return {
              async download(): Promise<[Buffer]> {
                // Simulate an SDK error that (hypothetically) carries sensitive
                // fields on top of the normal error shape - the extractor must
                // only ever pull a bare numeric `code`, nothing else.
                const err: any = new Error(
                  "request to https://storage.googleapis.com/... failed: Authorization: Bearer SHOULD-NOT-LEAK-TOKEN",
                );
                err.code = 403;
                err.config = { headers: { Authorization: "Bearer SHOULD-NOT-LEAK-TOKEN" } };
                throw err;
              },
              async save() {},
            };
          },
        };
      },
    };
    let error: unknown;
    try {
      await downloadJsonFromGcs("gs://sensitive-bucket/object.json", client);
    } catch (e) {
      error = e;
    }
    const serialized = JSON.stringify({
      message: (error as GcsIoError).message,
      location: (error as GcsIoError).location,
      httpStatus: (error as GcsIoError).httpStatus,
    });
    check("error serialization: no leaked token/header text", serialized.includes("SHOULD-NOT-LEAK-TOKEN") || serialized.includes("Authorization"), false);
    check("error serialization: message is the fixed, sanitized template", (error as GcsIoError).message, "Failed to download gs://sensitive-bucket/object.json from GCS");
    check("error serialization: only a bare numeric status carried over", (error as GcsIoError).httpStatus, 403);
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
