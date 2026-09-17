/**
 * Boundary/behavior checks for the Phase 1-C model-number token matcher. No
 * test runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/lib/identifierMatch.test.ts
 * Exits non-zero on any failure. Pure unit tests - no file I/O.
 */
import { matchesModelToken, countModelTokenMatches } from "./identifierMatch";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

check(
  "exact bracketed model code matches (real Sony listing style)",
  matchesModelToken("SONY｜ソニー α1 II ミラーレス一眼カメラ ILCE-1M2 [ボディ単体]", "ILCE-1M2"),
  true,
);
check("case-insensitive match", matchesModelToken("sony ilce-1m2 body", "ILCE-1M2"), true);
check("no match when the code is entirely absent", matchesModelToken("Canon EOS R5 Mark II Body", "ILCE-1M2"), false);

// --- critical safety case: suffix-extended codes must NOT match the base code ---
// (real regression: Panasonic LUMIX S5II's modelSkuHint "DC-S5M2" never appears
// standalone - every real listing is a kit variant "DC-S5M2W"/"DC-S5M2K"/"DC-S5M2XW")
check(
  "a suffix-extended SKU (DC-S5M2W) does NOT match the base code (DC-S5M2) - prevents body/kit conflation",
  matchesModelToken("Panasonic LUMIX S5II ダブルレンズキット DC-S5M2W ブラック", "DC-S5M2"),
  false,
);
check(
  "the base code matches only when it truly stands alone (no attached suffix)",
  matchesModelToken("Panasonic｜パナソニック LUMIX S5II ボディ DC-S5M2 [ボディ単体]", "DC-S5M2"),
  true,
);
check(
  "a prefix-extended code (XDC-S5M2) does NOT match either - boundary applies on both sides",
  matchesModelToken("XDC-S5M2 unrelated prefixed code", "DC-S5M2"),
  false,
);

// --- real cross-contamination case from TUSA Liberator: two genuinely
// different SKUs must never match each other's code ---
check(
  "TUSA Liberator's real code (BC0103B) does not match the unrelated fin SKU (SF0113)",
  matchesModelToken("TUSA(ツサ) SF0113 LIBERATOR X リブレーターテン ダイビングフィン", "BC0103B"),
  false,
);
check(
  "TUSA Liberator's real code (BC0103B) matches its own listing",
  matchesModelToken("TUSA(ツサ) BC0103B LIBERATOR リブレーター", "BC0103B"),
  true,
);

// --- regex-special characters in a code must not throw or be treated as regex syntax ---
check("a code containing a '+' is treated literally, not as a regex quantifier", matchesModelToken("Model A7C+ Kit", "A7C+"), true);
check("a '+'-suffixed code does not match its base form without the plus", matchesModelToken("Model A7C Kit", "A7C+"), false);

check("empty modelCode never matches", matchesModelToken("anything at all", ""), false);

check("countModelTokenMatches counts only true token matches across a list", countModelTokenMatches(["ILCE-1M2 body", "unrelated", "ILCE-1M2W kit"], "ILCE-1M2"), 1);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
