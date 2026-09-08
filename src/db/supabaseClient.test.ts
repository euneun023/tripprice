/**
 * Boundary/behavior checks for createFetchWithPgrst303Retry(). No test
 * runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/db/supabaseClient.test.ts
 * Exits non-zero on any failure. Never touches real network/Supabase -
 * every case uses an in-memory fake fetch and an injected no-op sleep.
 */
import { createFetchWithPgrst303Retry } from "./supabaseClient";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

type Fetch = typeof fetch;
type FakeCall = { input: unknown; init: unknown };

function makeFakeFetch(responses: Response[]): { fetch: Fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch: Fetch = async (input, init) => {
    calls.push({ input, init });
    const idx = Math.min(calls.length - 1, responses.length - 1);
    return responses[idx];
  };
  return { fetch, calls };
}

function recordingSleep(): { sleepFn: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  const sleepFn = async (ms: number) => {
    calls.push(ms);
  };
  return { sleepFn, calls };
}

async function main() {
  // ============================================================
  // A. 401 + PGRST303 -> retried exactly once, second response returned
  // ============================================================
  {
    const first = new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
    const second = new Response(JSON.stringify({ data: "ok" }), { status: 200 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([first, second]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("A: total fetch calls", calls.length, 2);
    check("A: returned response is the second response", result, second);
    check("A: returned status", result.status, 200);
    check("A: slept once", sleepCalls, [2000]);
  }

  // ============================================================
  // B. 401 + a different error code -> no retry, original returned
  // ============================================================
  {
    const only = new Response(JSON.stringify({ code: "PGRST301", message: "some other error" }), { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([only]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("B: total fetch calls", calls.length, 1);
    check("B: returned the original response", result, only);
    check("B: no sleep", sleepCalls, []);
  }

  // ============================================================
  // C. Non-401 responses (200 and 500) -> no retry, original returned
  // ============================================================
  {
    const ok = new Response(JSON.stringify({ data: "ok" }), { status: 200 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([ok]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("C(200): total fetch calls", calls.length, 1);
    check("C(200): returned the original response", result, ok);
    check("C(200): no sleep", sleepCalls, []);
  }
  {
    const serverError = new Response(JSON.stringify({ code: "XX000", message: "internal error" }), { status: 500 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([serverError]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("C(500): total fetch calls", calls.length, 1);
    check("C(500): returned the original response", result, serverError);
    check("C(500): no sleep", sleepCalls, []);
  }

  // ============================================================
  // D. PGRST303 on both attempts -> stops after exactly 2, no 3rd request
  // ============================================================
  {
    const first = new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
    const second = new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([first, second]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("D: total fetch calls (no 3rd attempt)", calls.length, 2);
    check("D: returned the second (still-401) response as-is", result, second);
    check("D: returned status still 401", result.status, 401);
    check("D: slept exactly once", sleepCalls, [2000]);
  }

  // ============================================================
  // E. 401 with a non-JSON body -> no retry, original returned
  // ============================================================
  {
    const notJson = new Response("<html>not json</html>", { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([notJson]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("E: total fetch calls", calls.length, 1);
    check("E: returned the original response", result, notJson);
    check("E: no sleep", sleepCalls, []);
  }

  // ============================================================
  // F. POST with a body -> retry reuses the exact same input/init
  // ============================================================
  {
    const first = new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
    const second = new Response(JSON.stringify({ data: "created" }), { status: 201 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([first, second]);
    const { sleepFn } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, 2000, sleepFn);

    const input = "https://example.test/rest/v1/foo";
    const init: RequestInit = {
      method: "POST",
      headers: { apikey: "test-key", Authorization: "Bearer test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "example" }),
    };
    const result = await wrapped(input, init);

    check("F: total fetch calls", calls.length, 2);
    check("F: first call input", calls[0].input, input);
    check("F: second call input identical to first", calls[1].input, calls[0].input);
    check("F: second call init identical to first (same method/headers/body)", calls[1].init, calls[0].init);
    check("F: second call body unchanged", (calls[1].init as RequestInit).body, init.body);
    check("F: returned the second response", result, second);
    check("F: returned status", result.status, 201);
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
