/**
 * Unit checks for the PURE planning/interpretation helpers in
 * measure-coupang-rate-limit.ts. No test runner is configured in this repo
 * (same plain-assertion convention as adapters/rakuten.test.ts) - run:
 *   npx tsx src/scripts/measure-coupang-rate-limit.test.ts
 * Exits non-zero on any failure. Makes NO Coupang API call - the live runner
 * is not invoked from here at all.
 *
 * These checks exist because the interpretation step is where a measurement
 * run can silently lie: counting a rejected parameter (HTTP 200 + rCode!=0)
 * as a rate limit, or extrapolating a daily budget from a phase that was
 * never completed cleanly, would both produce a confident wrong number that
 * the product roadmap then gets built on.
 */
import {
  buildRampSchedule,
  classifyAttempt,
  summarize,
  catalogCeiling,
  MAX_TOTAL_CALLS,
  type AttemptRecord,
} from "./measure-coupang-rate-limit";
import { CoupangApiError } from "../adapters/coupang";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`,
  );
  if (!pass) failures++;
}

/** Builds a synthetic attempt log: one entry per (rate, outcome) pair. */
function log(entries: Array<[number, AttemptRecord["outcome"]]>, msPerCall = 1000): AttemptRecord[] {
  return entries.map(([phaseRatePerMinute, outcome], index) => ({
    index,
    phaseRatePerMinute,
    outcome,
    elapsedMs: (index + 1) * msPerCall,
  }));
}

function main() {
  // ---- ramp schedule ----
  const schedule = buildRampSchedule();
  check("schedule never exceeds the hard cap", schedule.reduce((n, p) => n + p.calls, 0) <= MAX_TOTAL_CALLS, true);
  check("schedule starts slow (<=6/min)", schedule[0].ratePerMinute <= 6, true);
  check(
    "schedule rates are strictly increasing",
    schedule.every((p, i) => i === 0 || p.ratePerMinute > schedule[i - 1].ratePerMinute),
    true,
  );
  check("top phase probes the optimistic 50/min claim", schedule[schedule.length - 1].ratePerMinute, 50);
  check(
    "first phase already exceeds 10-per-hour, so the pessimistic case is caught early",
    schedule[0].ratePerMinute * 60 > 10,
    true,
  );
  const tiny = buildRampSchedule(5);
  check("a small budget is respected, not overrun", tiny.reduce((n, p) => n + p.calls, 0), 5);
  check("zero budget yields no phases", buildRampSchedule(0).length, 0);

  // ---- outcome classification ----
  check("no error -> ok", classifyAttempt(null), "ok");
  check("undefined -> ok", classifyAttempt(undefined), "ok");
  check("HTTP 403 -> rate_limited", classifyAttempt(new CoupangApiError("x", 403, null)), "rate_limited");
  check("HTTP 429 -> rate_limited", classifyAttempt(new CoupangApiError("x", 429, null)), "rate_limited");
  // The D18L-class mistake: a rejected parameter is HTTP 200 + rCode!=0, which
  // the adapter raises as CoupangApiError with the 200 status. It must never
  // be read as a rate limit.
  check(
    "HTTP 200 + non-success rCode -> api_error, NOT rate_limited",
    classifyAttempt(new CoupangApiError("non-success rCode=ERROR", 200, null)),
    "api_error",
  );
  check("status 0 -> transport_error", classifyAttempt(new CoupangApiError("transport", 0, null)), "transport_error");
  check("a non-Coupang error -> api_error", classifyAttempt(new Error("limit= exceeds max")), "api_error");

  // ---- summarize: clean run ----
  const clean = summarize(log([[6, "ok"], [6, "ok"], [12, "ok"], [12, "ok"], [50, "ok"]]));
  check("clean run verdict", clean.verdict, "consistent_with_50_per_minute");
  check("clean run max sustained = fastest clean phase", clean.maxSustainedRatePerMinute, 50);
  check("clean run has no rejection rate", clean.rejectedAtRatePerMinute, null);
  check("clean run implied budget = sustained * 60 * 24", clean.impliedCallsPerDay, 50 * 60 * 24);

  // ---- summarize: rejected mid-ramp ----
  const midReject = summarize(log([[6, "ok"], [6, "ok"], [12, "ok"], [30, "rate_limited"]]));
  check("mid-ramp rejection verdict", midReject.verdict, "limited_below_50_per_minute");
  check("rejection rate recorded", midReject.rejectedAtRatePerMinute, 30);
  check(
    "max sustained excludes the rejected rate (12, not 30)",
    midReject.maxSustainedRatePerMinute,
    12,
  );
  check("implied budget uses the sustained rate only", midReject.impliedCallsPerDay, 12 * 60 * 24);

  // A rate that saw BOTH an ok and a rejection must not count as sustained.
  const mixedRate = summarize(log([[6, "ok"], [20, "ok"], [20, "rate_limited"]]));
  check("a partially-rejected rate is not 'sustained'", mixedRate.maxSustainedRatePerMinute, 6);

  // ---- summarize: pessimistic case ----
  const slowReject = summarize(log([[6, "ok"], [6, "rate_limited"]]));
  check("rejected at the slowest rate tried -> 10/hour reading", slowReject.verdict, "consistent_with_10_per_hour");
  const immediateReject = summarize(log([[6, "rate_limited"]]));
  check("rejected on the very first call -> 10/hour reading", immediateReject.verdict, "consistent_with_10_per_hour");
  check("nothing succeeded -> no implied budget (not 0, not a guess)", immediateReject.impliedCallsPerDay, null);
  check("nothing succeeded -> no sustained rate", immediateReject.maxSustainedRatePerMinute, null);

  // ---- summarize: inconclusive ----
  const apiErr = summarize(log([[6, "ok"], [12, "api_error"]]));
  check("api_error makes the run inconclusive, not a limit finding", apiErr.verdict, "inconclusive_api_error");
  check("api_error run reports no rejection rate", apiErr.rejectedAtRatePerMinute, null);
  const empty = summarize([]);
  check("empty log verdict", empty.verdict, "inconclusive_no_calls");
  check("empty log implies nothing", empty.impliedCallsPerDay, null);

  // ---- observed throughput ----
  const throughput = summarize(log([[6, "ok"], [6, "ok"], [6, "ok"]], 10_000));
  check("observed throughput from elapsed time (3 ok in 30s = 6/min)", throughput.observedRatePerMinute, 6);

  // ---- catalog ceiling ----
  check("50/min -> 72k calls/day -> 18k products at 6h refresh", catalogCeiling(72_000, 6), 18_000);
  check("50/min budget at 24h refresh", catalogCeiling(72_000, 24), 72_000);
  // The pessimistic hypothesis, stated in products: 10/hour = 240 calls/day.
  check("10/hour budget at 24h refresh -> 240 products", catalogCeiling(240, 24), 240);
  check("10/hour budget at 6h refresh -> 60 products", catalogCeiling(240, 6), 60);
  check("zero budget -> zero products", catalogCeiling(0, 24), 0);
  check("nonsensical refresh interval -> zero, never Infinity", catalogCeiling(1000, 0), 0);
  check("negative budget -> zero", catalogCeiling(-5, 24), 0);

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
}

main();
