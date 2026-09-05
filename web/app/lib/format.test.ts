/**
 * Boundary-value checks for formatCheckedDateTime() / formatAsOf() KST
 * time-of-day rendering. No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx web/app/lib/format.test.ts
 * Exits non-zero on any failure.
 */
import { formatCheckedDateTime, formatAsOf } from "./format";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

// --- boundary cases (KST instants, given as ISO with explicit +09:00 offset) ---
check("01:05 -> 오전 1:05", formatCheckedDateTime("2026-09-04T01:05:00+09:00"), "9월 4일 오전 1:05 확인");
check("11:30 -> 오전 11:30", formatCheckedDateTime("2026-09-04T11:30:00+09:00"), "9월 4일 오전 11:30 확인");
check("12:00 -> 오후 12:00 (noon)", formatCheckedDateTime("2026-09-04T12:00:00+09:00"), "9월 4일 오후 12:00 확인");
check("15:45 -> 오후 3:45", formatCheckedDateTime("2026-09-04T15:45:00+09:00"), "9월 4일 오후 3:45 확인");
check("00:05 -> 오전 12:05 (midnight)", formatCheckedDateTime("2026-09-04T00:05:00+09:00"), "9월 4일 오전 12:05 확인");

// same boundaries for formatAsOf (FX-basis line), which has no "확인" suffix and adds "기준"
check("formatAsOf 01:05 -> 오전 1:05", formatAsOf("2026-09-04T01:05:00+09:00"), "9월 4일 오전 1:05 기준");
check("formatAsOf 12:00 -> 오후 12:00", formatAsOf("2026-09-04T12:00:00+09:00"), "9월 4일 오후 12:00 기준");

// --- production examples from this task's request, expressed as KST instants ---
// price-check time: "9월 4일 AM 01:55 확인" -> "9월 4일 오전 1:55 확인"
check("production price-check example", formatCheckedDateTime("2026-09-04T01:55:00+09:00"), "9월 4일 오전 1:55 확인");
// FX-as-of time: "9월 4일 AM 08:55" -> "9월 4일 오전 8:55 기준"
check("production fx-as-of example", formatAsOf("2026-09-04T08:55:00+09:00"), "9월 4일 오전 8:55 기준");

// --- no English AM/PM leaks through ---
check("no 'AM' substring", formatCheckedDateTime("2026-09-04T01:55:00+09:00").includes("AM"), false);
check("no 'PM' substring", formatCheckedDateTime("2026-09-04T15:45:00+09:00").includes("PM"), false);

// --- null handling unchanged ---
check("null -> 확인 이력 없음", formatCheckedDateTime(null), "확인 이력 없음");
check("null -> empty string (formatAsOf)", formatAsOf(null), "");

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
