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

function pgrst303(): Response {
  return new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
}

async function main() {
  // ============================================================
  // A. 1st PGRST303 -> 2nd success: total 2 requests, one 2000ms sleep
  // ============================================================
  {
    const second = new Response(JSON.stringify({ data: "ok" }), { status: 200 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([pgrst303(), second]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("A: total fetch calls", calls.length, 2);
    check("A: returned response is the second response", result, second);
    check("A: returned status", result.status, 200);
    check("A: slept once, 2000ms", sleepCalls, [2000]);
  }

  // ============================================================
  // B. 401 + a different error code -> no retry, original returned
  // ============================================================
  {
    const only = new Response(JSON.stringify({ code: "PGRST301", message: "some other error" }), { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([only]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

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
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("C(200): total fetch calls", calls.length, 1);
    check("C(200): returned the original response", result, ok);
    check("C(200): no sleep", sleepCalls, []);
  }
  {
    const serverError = new Response(JSON.stringify({ code: "XX000", message: "internal error" }), { status: 500 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([serverError]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("C(500): total fetch calls", calls.length, 1);
    check("C(500): returned the original response", result, serverError);
    check("C(500): no sleep", sleepCalls, []);
  }

  // ============================================================
  // D. 1st and 2nd PGRST303 -> 3rd success: total 3 requests,
  //    sleeps in order [2000, 4000]
  // ============================================================
  {
    const third = new Response(JSON.stringify({ data: "ok" }), { status: 200 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([pgrst303(), pgrst303(), third]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("D: total fetch calls", calls.length, 3);
    check("D: returned response is the third response", result, third);
    check("D: returned status", result.status, 200);
    check("D: slept twice, in order [2000, 4000]", sleepCalls, [2000, 4000]);
  }

  // ============================================================
  // E. All 3 attempts PGRST303 -> stops after exactly 3, no 4th request
  // ============================================================
  {
    const attempt1 = pgrst303();
    const attempt2 = pgrst303();
    const attempt3 = pgrst303();
    const { fetch: fakeFetch, calls } = makeFakeFetch([attempt1, attempt2, attempt3]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("E: total fetch calls (no 4th attempt)", calls.length, 3);
    check("E: returned the third (still-401) response as-is", result, attempt3);
    check("E: returned status still 401", result.status, 401);
    check("E: slept twice, in order [2000, 4000]", sleepCalls, [2000, 4000]);
  }

  // ============================================================
  // F. 401 with a non-JSON body -> no retry, original returned
  // ============================================================
  {
    const notJson = new Response("<html>not json</html>", { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([notJson]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("F: total fetch calls", calls.length, 1);
    check("F: returned the original response", result, notJson);
    check("F: no sleep", sleepCalls, []);
  }

  // ============================================================
  // G. PGRST303 on the 2nd attempt's JSON parse -> stop there, return
  //    the 2nd (unparseable) response as-is, no 3rd request
  // ============================================================
  {
    const notJsonSecond = new Response("<html>not json</html>", { status: 401 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([pgrst303(), notJsonSecond]);
    const { sleepFn, calls: sleepCalls } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const result = await wrapped("https://example.test/rest/v1/foo", { method: "GET" });

    check("G: total fetch calls", calls.length, 2);
    check("G: returned the second (unparseable) response as-is", result, notJsonSecond);
    check("G: slept once, 2000ms only", sleepCalls, [2000]);
  }

  // ============================================================
  // H. POST with a body -> every retry reuses the exact same input/init
  // ============================================================
  {
    const third = new Response(JSON.stringify({ data: "created" }), { status: 201 });
    const { fetch: fakeFetch, calls } = makeFakeFetch([pgrst303(), pgrst303(), third]);
    const { sleepFn } = recordingSleep();
    const wrapped = createFetchWithPgrst303Retry(fakeFetch, [2000, 4000], sleepFn);

    const input = "https://example.test/rest/v1/foo";
    const init: RequestInit = {
      method: "POST",
      headers: { apikey: "test-key", Authorization: "Bearer test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "example" }),
    };
    const result = await wrapped(input, init);

    check("H: total fetch calls", calls.length, 3);
    check("H: 2nd call input identical to 1st", calls[1].input, calls[0].input);
    check("H: 2nd call init identical to 1st", calls[1].init, calls[0].init);
    check("H: 3rd call input identical to 1st", calls[2].input, calls[0].input);
    check("H: 3rd call init identical to 1st", calls[2].init, calls[0].init);
    check("H: 3rd call body unchanged", (calls[2].init as RequestInit).body, init.body);
    check("H: returned the third response", result, third);
    check("H: returned status", result.status, 201);
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
