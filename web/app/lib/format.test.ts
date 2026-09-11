/**
 * Boundary-value checks for formatCheckedDateTime() / formatAsOf() KST
 * time-of-day rendering. No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx web/app/lib/format.test.ts
 * Exits non-zero on any failure.
 */
import { formatCheckedDateTime, formatAsOf, formatVariantAttributeValue, formatVariantAttributeEntries } from "./format";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
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

// --- formatVariantAttributeValue(): mount slug -> human label, everything else passthrough ---
check("mount=sony_e -> Sony E", formatVariantAttributeValue("mount", "sony_e"), "Sony E");
check("mount=canon_rf -> Canon RF", formatVariantAttributeValue("mount", "canon_rf"), "Canon RF");
check("mount=nikon_z -> Nikon Z", formatVariantAttributeValue("mount", "nikon_z"), "Nikon Z");
check("mount=leica_l -> Leica L", formatVariantAttributeValue("mount", "leica_l"), "Leica L");
// legacy pre-slug production value - passes through unchanged, never "corrected"
check('legacy mount="Sony E" -> "Sony E" unchanged', formatVariantAttributeValue("mount", "Sony E"), "Sony E");
// unrecognized/unexpected mount value - passes through unchanged rather than breaking
check("unknown mount value -> original value kept", formatVariantAttributeValue("mount", "some_future_mount"), "some_future_mount");
// non-mount keys are never touched, even if the value happens to collide with a mount slug
check("non-mount key kit=body-only -> unchanged", formatVariantAttributeValue("kit", "body-only"), "body-only");
check("non-mount key edition=Standard -> unchanged", formatVariantAttributeValue("edition", "Standard"), "Standard");
check("non-mount key whose value equals a mount slug -> still unchanged", formatVariantAttributeValue("color", "sony_e"), "sony_e");

// --- formatVariantAttributeEntries(): whole-record behavior, existing non-mount displays unaffected ---
check("mount entry translated, kit entry untouched (regression: existing body-only display)", formatVariantAttributeEntries({ mount: "sony_e", kit: "body-only" }), [
  ["mount", "Sony E"],
  ["kit", "body-only"],
]);
check("no mount key at all -> every entry passes through (regression: RX100 VII-style {\"kit\":\"body-only\"})", formatVariantAttributeEntries({ kit: "body-only" }), [
  ["kit", "body-only"],
]);
check("null attrs -> empty array", formatVariantAttributeEntries(null), []);
check("undefined attrs -> empty array", formatVariantAttributeEntries(undefined), []);
check("empty object -> empty array", formatVariantAttributeEntries({}), []);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
