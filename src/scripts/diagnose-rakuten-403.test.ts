/**
 * Offline regression tests for diagnose-rakuten-403.ts - no real network
 * call anywhere in this file (the "LIVE" tests replace globalThis.fetch
 * with a fake, same convention as src/adapters/coupang.test.ts's
 * withFakeFetch, always restored afterward).
 *
 * Run directly:
 *   npx tsx src/scripts/diagnose-rakuten-403.test.ts
 */
import { buildUrl, redactUrl, redactSecret, runLive, ENDPOINT, DIAGNOSTIC_KEYWORD } from "./diagnose-rakuten-403";

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

async function withFakeFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  return fn()
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.log = original;
    });
}

const FAKE_APP_ID = "TEST-APP-ID-0001";
const FAKE_ACCESS_KEY = "TEST-ACCESS-KEY-SECRET-XYZ";

async function main() {
  // ============================================================
  // 1. redactSecret / redactUrl / buildUrl - pure, offline
  // ============================================================
  check("redactSecret strips every occurrence of the secret", redactSecret(`a${FAKE_ACCESS_KEY}b${FAKE_ACCESS_KEY}c`, FAKE_ACCESS_KEY), "a<redacted>b<redacted>c");
  check("redactSecret is a no-op for an empty secret", redactSecret("hello", ""), "hello");

  {
    const url = buildUrl(FAKE_APP_ID, FAKE_ACCESS_KEY);
    checkTrue("buildUrl hits the documented endpoint", url.toString().startsWith(ENDPOINT));
    check("buildUrl sets applicationId", url.searchParams.get("applicationId"), FAKE_APP_ID);
    check("buildUrl sets accessKey", url.searchParams.get("accessKey"), FAKE_ACCESS_KEY);
    check("buildUrl sets keyword to the fixed diagnostic keyword", url.searchParams.get("keyword"), DIAGNOSTIC_KEYWORD);
    check("buildUrl sets hits=1 (exactly one diagnostic request worth of data)", url.searchParams.get("hits"), "1");

    const redacted = redactUrl(url, FAKE_APP_ID, FAKE_ACCESS_KEY);
    checkTrue("redactUrl never contains the raw applicationId", !redacted.includes(FAKE_APP_ID));
    checkTrue("redactUrl never contains the raw accessKey", !redacted.includes(FAKE_ACCESS_KEY));
    checkTrue(
      "redactUrl still shows the non-secret keyword param (useful for diagnosis)",
      new URL(redacted).searchParams.get("keyword") === DIAGNOSTIC_KEYWORD,
    );
  }

  // ============================================================
  // 2. runLive() against a fake fetch - exactly 1 request, no retry, and
  //    secrets never survive into anything printed, including when the
  //    fake 403 body ECHOES the key back (worst case, matching what the
  //    11st adapter was found to do in an earlier fix)
  // ============================================================
  await withEnv({ applicationId: FAKE_APP_ID, accessKey: FAKE_ACCESS_KEY }, async () => {
    // 2a. JSON 403 body with Rakuten-style error fields
    {
      let fetchCalls = 0;
      const fake = (async (input: string) => {
        fetchCalls++;
        checkTrue("the single request hits the documented Rakuten endpoint", input.startsWith(ENDPOINT));
        return {
          ok: false,
          status: 403,
          headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
          text: async () => JSON.stringify({ error: "wrong_parameter", error_description: `invalid applicationId=${FAKE_APP_ID}` }),
        } as unknown as Response;
      }) as typeof fetch;

      const { lines } = await withFakeFetch(fake, () => captureConsole(() => runLive()));
      check("exactly 1 fetch call for the JSON-403 case (no retry)", fetchCalls, 1);
      checkTrue("HTTP 403 reported", lines.some((l) => l.includes("HTTP status: 403")));
      checkTrue("error field surfaced", lines.some((l) => l.includes("wrong_parameter")));
      checkTrue("error_description field surfaced", lines.some((l) => l.includes("error_description")));
      for (const line of lines) {
        checkTrue(`line does not leak accessKey: "${line.slice(0, 60)}..."`, !line.includes(FAKE_ACCESS_KEY));
        checkTrue(`line does not leak applicationId even when echoed by the server: "${line.slice(0, 60)}..."`, !line.includes(FAKE_APP_ID));
      }
    }

    // 2b. non-JSON 403 body (WAF/gateway page) - must not crash, must show
    // raw (redacted) text instead of swallowing it as null
    {
      let fetchCalls = 0;
      const htmlBody = `<html><body>Forbidden - IP not allowed (key ${FAKE_ACCESS_KEY})</body></html>`;
      const fake = (async () => {
        fetchCalls++;
        return {
          ok: false,
          status: 403,
          headers: { get: () => null },
          text: async () => htmlBody,
        } as unknown as Response;
      }) as typeof fetch;

      const { lines } = await withFakeFetch(fake, () => captureConsole(() => runLive()));
      check("exactly 1 fetch call for the non-JSON-403 case", fetchCalls, 1);
      checkTrue("falls back to showing raw text instead of crashing on JSON.parse", lines.some((l) => l.includes("NOT JSON")));
      checkTrue("the HTML body's content is still shown (truncated raw text)", lines.some((l) => l.includes("Forbidden")));
      for (const line of lines) {
        checkTrue(`non-JSON case: line does not leak accessKey even when the HTML body echoes it: "${line.slice(0, 60)}..."`, !line.includes(FAKE_ACCESS_KEY));
      }
    }

    // 2c. transport failure (no HTTP response at all)
    {
      let fetchCalls = 0;
      const fake = (async () => {
        fetchCalls++;
        throw new Error(`connect ETIMEDOUT for key ${FAKE_ACCESS_KEY}`);
      }) as typeof fetch;

      const { lines } = await withFakeFetch(fake, () => captureConsole(() => runLive()));
      check("exactly 1 fetch attempt on transport failure (no retry)", fetchCalls, 1);
      checkTrue("reported as a transport failure, not confused with a 403", lines.some((l) => l.includes("TRANSPORT FAILURE")));
      for (const line of lines) {
        checkTrue(`transport-failure case: line does not leak accessKey: "${line.slice(0, 60)}..."`, !line.includes(FAKE_ACCESS_KEY));
      }
    }
  });

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
