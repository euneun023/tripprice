/**
 * Measures the ONE number that currently bounds how many products Tripprice
 * can carry: Coupang Partners' real search-API call budget.
 *
 * WHY THIS IS THE BOTTLENECK (docs/data-sources-research-2026-11.md §7):
 *   - The Partners search API returns at most 10 results per keyword
 *     (COUPANG_MAX_SEARCH_LIMIT) and has no category browse, so the KR leg
 *     costs exactly ONE call per product per refresh cycle.
 *   - Public sources disagree about the limit by a factor of 300: "10 per
 *     hour" vs "50 per minute". Both are community posts; Coupang's own
 *     partner docs sit behind a login this repo has no access to.
 *   - At 50/min a few thousand products refresh daily. At 10/hour the ceiling
 *     is ~240 calls/day, i.e. a 1,000-product catalog takes 4+ days per
 *     cycle. The product roadmap cannot be chosen without this number.
 *
 * SAFETY - this script is deliberately paranoid, because the downside is a
 * restricted Partners account, not a failed test:
 *   - DRY RUN BY DEFAULT. It prints the plan and exits. Live calls happen
 *     only with an explicit `--live` flag.
 *   - ABORTS ON THE FIRST REJECTION. A community report says three 403s can
 *     get an account's API access restricted, so this stops at one - it
 *     never probes "how deep" the rejection goes.
 *   - Hard caps: MAX_TOTAL_CALLS, and a slow-to-fast ramp that starts at one
 *     call every 10 seconds (well under even the most pessimistic reading of
 *     the limit).
 *   - Rotates keywords so it is not hammering one identical URL.
 *   - Read-only: no database, no file writes, no mapping changes. Prints a
 *     report to stdout for a human to paste into the research doc.
 *
 * Run:
 *   npx tsx src/scripts/measure-coupang-rate-limit.ts            # dry run
 *   npx tsx src/scripts/measure-coupang-rate-limit.ts --live     # real calls
 *   (needs COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY in .env)
 */
import "dotenv/config";
import { searchCoupangProduct, CoupangApiError } from "../adapters/coupang";

// ---------------------------------------------------------------------------
// Pure, unit-tested planning/analysis helpers (see
// measure-coupang-rate-limit.test.ts - no live call involved in any of them)
// ---------------------------------------------------------------------------

/** Absolute ceiling on live calls this script may ever make in one run. */
export const MAX_TOTAL_CALLS = 40;

export interface RampPhase {
  /** gap between calls inside this phase */
  intervalMs: number;
  calls: number;
  /** calls-per-minute this phase sustains, for reporting */
  ratePerMinute: number;
}

/**
 * A conservative slow->fast ramp. Each phase sustains a higher rate than the
 * last; the run stops the moment any call is rejected, so the last
 * successful phase is the measured floor of the real limit.
 *
 * The phases are chosen to straddle the two candidate hypotheses: the first
 * phase (6/min) already exceeds "10 per hour", so a 10/hour limit is
 * detected within the first minute instead of after a long clean run, and
 * the final phase (50/min) is exactly the optimistic claim.
 */
export function buildRampSchedule(maxTotalCalls = MAX_TOTAL_CALLS): RampPhase[] {
  const phases: Array<{ intervalMs: number; calls: number }> = [
    { intervalMs: 10_000, calls: 4 }, //  6/min - detects "10 per hour" fast
    { intervalMs: 5_000, calls: 6 },  // 12/min
    { intervalMs: 3_000, calls: 8 },  // 20/min
    { intervalMs: 2_000, calls: 10 }, // 30/min
    { intervalMs: 1_200, calls: 12 }, // 50/min - the optimistic claim
  ];

  const out: RampPhase[] = [];
  let budget = maxTotalCalls;
  for (const p of phases) {
    if (budget <= 0) break;
    const calls = Math.min(p.calls, budget);
    budget -= calls;
    out.push({
      intervalMs: p.intervalMs,
      calls,
      ratePerMinute: Math.round(60_000 / p.intervalMs),
    });
  }
  return out;
}

export type AttemptOutcome = "ok" | "rate_limited" | "api_error" | "transport_error";

/**
 * Maps what came back into one of four outcomes. The distinction that matters
 * is rate_limited vs api_error: the Coupang adapter raises CoupangApiError
 * for BOTH an HTTP 403 and a non-success rCode on an HTTP 200 (see
 * adapters/coupang.ts - a rejected parameter looks like 200 + rCode!=0). Only
 * the former is evidence about the rate limit; mistaking a parameter error for
 * a rate limit would produce a bogus measurement, which is exactly the class
 * of mistake the D18L regression was.
 */
export function classifyAttempt(err: unknown): AttemptOutcome {
  if (err === null || err === undefined) return "ok";
  if (err instanceof CoupangApiError) {
    if (err.status === 429 || err.status === 403) return "rate_limited";
    if (err.status === 0) return "transport_error";
    return "api_error";
  }
  return "api_error";
}

export interface AttemptRecord {
  index: number;
  phaseRatePerMinute: number;
  outcome: AttemptOutcome;
  /** ms since the first call of the run */
  elapsedMs: number;
  detail?: string;
}

export interface Measurement {
  totalCalls: number;
  okCalls: number;
  /** highest phase rate at which every call succeeded */
  maxSustainedRatePerMinute: number | null;
  /** phase rate at which the first rejection happened, if any */
  rejectedAtRatePerMinute: number | null;
  /** observed throughput across the whole run, calls per minute */
  observedRatePerMinute: number | null;
  verdict:
    | "consistent_with_50_per_minute"
    | "limited_below_50_per_minute"
    | "consistent_with_10_per_hour"
    | "inconclusive_api_error"
    | "inconclusive_no_calls";
  /** daily call budget implied by the measurement, for catalog sizing */
  impliedCallsPerDay: number | null;
}

/**
 * Turns the attempt log into the numbers the roadmap actually needs. Kept
 * pure so the interpretation can be tested against synthetic logs rather
 * than re-run against Coupang.
 */
export function summarize(records: AttemptRecord[]): Measurement {
  const totalCalls = records.length;
  const okCalls = records.filter((r) => r.outcome === "ok").length;

  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      okCalls: 0,
      maxSustainedRatePerMinute: null,
      rejectedAtRatePerMinute: null,
      observedRatePerMinute: null,
      verdict: "inconclusive_no_calls",
      impliedCallsPerDay: null,
    };
  }

  const firstRejection = records.find((r) => r.outcome === "rate_limited") ?? null;
  const rejectedAtRatePerMinute = firstRejection?.phaseRatePerMinute ?? null;

  // Highest phase where no rejection occurred at that phase's rate.
  const rejectedRates = new Set(
    records.filter((r) => r.outcome === "rate_limited").map((r) => r.phaseRatePerMinute),
  );
  const cleanRates = records
    .filter((r) => r.outcome === "ok" && !rejectedRates.has(r.phaseRatePerMinute))
    .map((r) => r.phaseRatePerMinute);
  const maxSustainedRatePerMinute = cleanRates.length > 0 ? Math.max(...cleanRates) : null;

  const lastElapsed = records[records.length - 1].elapsedMs;
  const observedRatePerMinute =
    lastElapsed > 0 ? Math.round((okCalls / (lastElapsed / 60_000)) * 10) / 10 : null;

  const hadApiError = records.some((r) => r.outcome === "api_error");

  // "Rejected even at the slowest rate we tried" is the pessimistic case.
  // Derived from the rates actually present in the log rather than from a
  // call-index threshold, so re-tuning buildRampSchedule() cannot silently
  // change how a result is interpreted.
  const slowestRateTried = Math.min(...records.map((r) => r.phaseRatePerMinute));

  let verdict: Measurement["verdict"];
  if (firstRejection && firstRejection.phaseRatePerMinute === slowestRateTried) {
    verdict = "consistent_with_10_per_hour";
  } else if (firstRejection) {
    verdict = "limited_below_50_per_minute";
  } else if (hadApiError) {
    verdict = "inconclusive_api_error";
  } else {
    verdict = "consistent_with_50_per_minute";
  }

  // Always derived from the SUSTAINED rate - the fastest phase that was
  // completed cleanly - never from a phase that got rejected and never from
  // the optimistic end of the schedule if the run never reached it. When
  // nothing succeeded at any rate, this stays null rather than guessing.
  const impliedCallsPerDay =
    maxSustainedRatePerMinute === null ? null : maxSustainedRatePerMinute * 60 * 24;

  return {
    totalCalls,
    okCalls,
    maxSustainedRatePerMinute,
    rejectedAtRatePerMinute,
    observedRatePerMinute,
    verdict,
    impliedCallsPerDay,
  };
}

/**
 * How many products a given daily call budget can keep fresh at a target
 * refresh interval. One product costs one call per cycle on the KR leg.
 */
export function catalogCeiling(callsPerDay: number, refreshIntervalHours: number): number {
  if (callsPerDay <= 0 || refreshIntervalHours <= 0) return 0;
  const cyclesPerDay = 24 / refreshIntervalHours;
  return Math.floor(callsPerDay / cyclesPerDay);
}

// ---------------------------------------------------------------------------
// Live runner
// ---------------------------------------------------------------------------

/**
 * Rotated so the run is not repeatedly hitting one identical request URL
 * (the kind of pattern most likely to be treated as abuse). All are ordinary
 * product searches in categories this project already tracks.
 */
const KEYWORDS = [
  "소니 A7",
  "캐논 EOS R8",
  "니콘 Z6",
  "후지필름 X-T5",
  "소니 WH-1000XM6",
  "보스 QC 울트라",
  "가민 인스팅트",
  "애플워치 울트라",
  "다이슨 에어랩",
  "파나소닉 면도기",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function printPlan(schedule: RampPhase[]) {
  console.log("=== Coupang Partners rate-limit measurement: PLAN ===");
  let cumulative = 0;
  let predictedMs = 0;
  for (const [i, phase] of schedule.entries()) {
    cumulative += phase.calls;
    predictedMs += phase.calls * phase.intervalMs;
    console.log(
      `  phase ${i + 1}: ${String(phase.calls).padStart(2)} calls @ ${String(phase.intervalMs).padStart(6)}ms ` +
        `(~${String(phase.ratePerMinute).padStart(2)}/min)  cumulative=${cumulative}`,
    );
  }
  console.log(`  total: ${cumulative} calls, ~${Math.round(predictedMs / 1000)}s if nothing is rejected`);
  console.log("  aborts immediately on the first 403/429.");
}

function printReport(records: AttemptRecord[]) {
  const m = summarize(records);
  console.log("\n=== RESULT ===");
  console.log(`  calls made           : ${m.totalCalls} (ok: ${m.okCalls})`);
  console.log(`  max sustained rate   : ${m.maxSustainedRatePerMinute ?? "unknown"} calls/min`);
  console.log(`  first rejection at   : ${m.rejectedAtRatePerMinute ?? "none"} calls/min`);
  console.log(`  observed throughput  : ${m.observedRatePerMinute ?? "unknown"} calls/min`);
  console.log(`  verdict              : ${m.verdict}`);
  console.log(`  implied calls/day    : ${m.impliedCallsPerDay ?? "unknown"}`);

  if (m.impliedCallsPerDay !== null) {
    console.log("\n  catalog ceiling implied by this budget (1 KR call per product per cycle):");
    for (const hours of [6, 12, 24, 48]) {
      console.log(
        `    refresh every ${String(hours).padStart(2)}h -> ${catalogCeiling(m.impliedCallsPerDay, hours).toLocaleString()} products`,
      );
    }
    console.log(
      "\n  NOTE: these are headroom ceilings, not targets - they assume the whole budget\n" +
        "  goes to refresh with nothing left for candidate search or retries. Plan on a\n" +
        "  fraction of it.",
    );
  }

  console.log(
    "\n  Paste the verdict + implied budget into docs/data-sources-research-2026-11.md §7\n" +
      "  item 2, replacing the 'C등급·충돌' note for Coupang's rate limit.",
  );
}

async function main() {
  const live = process.argv.includes("--live");
  const schedule = buildRampSchedule();

  printPlan(schedule);

  if (!live) {
    console.log(
      "\nDRY RUN - no API call was made. Re-run with --live to measure for real:\n" +
        "  npx tsx src/scripts/measure-coupang-rate-limit.ts --live",
    );
    return;
  }

  const accessKey = process.env.COUPANG_PARTNERS_ACCESS_KEY;
  const secretKey = process.env.COUPANG_PARTNERS_SECRET_KEY;
  if (!accessKey || !secretKey) {
    console.error(
      "\nMissing COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY in .env - cannot run live.",
    );
    process.exit(1);
  }

  console.log("\n=== LIVE RUN ===");
  const credentials = { accessKey, secretKey };
  const records: AttemptRecord[] = [];
  const startedAt = Date.now();
  let index = 0;
  let aborted = false;

  for (const phase of schedule) {
    if (aborted) break;
    console.log(`\n-- phase @ ~${phase.ratePerMinute}/min (${phase.intervalMs}ms gap) --`);
    for (let i = 0; i < phase.calls; i++) {
      if (index > 0) await sleep(phase.intervalMs);

      const keyword = KEYWORDS[index % KEYWORDS.length];
      let outcome: AttemptOutcome;
      let detail: string | undefined;

      try {
        const result = await searchCoupangProduct(credentials, keyword, 10);
        outcome = "ok";
        const headers = Object.entries(result.rateLimitHeaders);
        detail = `${result.items.length} items` + (headers.length ? ` | headers: ${headers.map(([k, v]) => `${k}=${v}`).join(", ")}` : " | no rate-limit headers");
      } catch (err) {
        outcome = classifyAttempt(err);
        detail = err instanceof Error ? err.message : String(err);
      }

      const elapsedMs = Date.now() - startedAt;
      records.push({ index, phaseRatePerMinute: phase.ratePerMinute, outcome, elapsedMs, detail });
      console.log(`  #${String(index + 1).padStart(2)} ${outcome.padEnd(16)} t+${String(Math.round(elapsedMs / 1000)).padStart(3)}s  ${detail ?? ""}`);
      index++;

      if (outcome === "rate_limited") {
        console.log(
          "\n  ABORTING on first rejection - by design. Not probing further: repeated 403s\n" +
            "  are reported to risk the Partners account's API access.",
        );
        aborted = true;
        break;
      }
      if (outcome === "api_error") {
        console.log(
          "\n  ABORTING on a non-rate-limit API error. This is NOT rate-limit evidence\n" +
            "  (a rejected parameter returns HTTP 200 + rCode!=0) - fix the call first.",
        );
        aborted = true;
        break;
      }
      if (outcome === "transport_error") {
        console.log("\n  ABORTING on transport failure - network problem, not a limit signal.");
        aborted = true;
        break;
      }
    }
  }

  printReport(records);
}

main().catch((err) => {
  console.error(`\nUnhandled failure: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
