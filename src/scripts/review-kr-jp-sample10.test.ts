/**
 * Offline regression tests for review-kr-jp-sample10.ts - no network. File
 * I/O happens against a real temp file (os.tmpdir()), cleaned up at the
 * end, to prove recordDecision()/loadDecisions() actually round-trip
 * through disk rather than just in-memory objects.
 *
 * Run directly:
 *   npx tsx src/scripts/review-kr-jp-sample10.test.ts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordDecision, loadDecisions, isPurchasabilityUncertain, buildReviewedRows, summarizeReview, type ReviewDecision } from "./review-kr-jp-sample10";
import type { KrResultEntry, JpResultEntry } from "./compare-kr-jp-sample10";

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

function main() {
  const dir = mkdtempSync(join(tmpdir(), "review-kr-jp-test-"));
  const decisionsPath = join(dir, "review-decisions.json");

  try {
    // ============================================================
    // 1. loadDecisions on a missing file -> empty array, never throws
    // ============================================================
    check("loadDecisions on a file that doesn't exist yet -> []", loadDecisions(decisionsPath), []);
    checkTrue("no file was created just by reading", !existsSync(decisionsPath));

    // ============================================================
    // 2. recordDecision - the enforcement this whole feature is for:
    //    empty/whitespace evidence must throw, never silently record
    // ============================================================
    {
      let threw = false;
      try {
        recordDecision(decisionsPath, 4, "approved", "", "tester");
      } catch {
        threw = true;
      }
      checkTrue("empty evidence throws - decision NEVER recorded without it", threw);
      checkTrue("no file was created by the rejected call", !existsSync(decisionsPath));

      let threwWhitespace = false;
      try {
        recordDecision(decisionsPath, 4, "approved", "   ", "tester");
      } catch {
        threwWhitespace = true;
      }
      checkTrue("whitespace-only evidence also throws (not just literally empty)", threwWhitespace);
    }

    // ============================================================
    // 3. recordDecision - real write, round-tripped through disk
    // ============================================================
    {
      const now = new Date("2026-11-20T03:00:00.000Z");
      const decisions = recordDecision(decisionsPath, 4, "approved", "두 URL 직접 확인, 모델/색상/가격 일치", "alice", now);
      check("recordDecision returns the full decision list", decisions.length, 1);
      checkTrue("the file actually exists on disk now", existsSync(decisionsPath));

      const reloaded = JSON.parse(readFileSync(decisionsPath, "utf-8")) as ReviewDecision[];
      check("reviewedAt is stamped by recordDecision itself, not the caller", reloaded[0].reviewedAt, "2026-11-20T03:00:00.000Z");
      check("evidence is trimmed and stored", reloaded[0].evidence, "두 URL 직접 확인, 모델/색상/가격 일치");
      check("reviewer stored", reloaded[0].reviewer, "alice");
    }

    // ============================================================
    // 4. recordDecision - upsert by n (a second decision for the same n
    //    replaces the first, doesn't duplicate)
    // ============================================================
    {
      const decisions = recordDecision(decisionsPath, 4, "rejected", "다시 보니 색상이 다름", "bob");
      check("upsert: still exactly 1 decision for n=4, not 2", decisions.filter((d) => d.n === 4).length, 1);
      check("the latest decision value wins", decisions.find((d) => d.n === 4)?.decision, "rejected");
    }

    // ============================================================
    // 5. recordDecision - a SECOND item (n=1), confirming independent
    //    entries coexist correctly
    // ============================================================
    {
      const decisions = recordDecision(decisionsPath, 1, "held", "라쿠텐 쪽 재고 플래그 재확인 필요", "alice");
      check("two independent decisions now exist (n=4 and n=1)", decisions.length, 2);
    }

    // ============================================================
    // 6. isPurchasabilityUncertain - never conflated with decision
    // ============================================================
    check("no delivery-uncertain wording, availability=1 -> not uncertain", isPurchasabilityUncertain({ n: 1 }, { n: 1, availability: 1 }), false);
    checkTrue("KR delivery-uncertain wording alone -> uncertain", isPurchasabilityUncertain({ n: 1, deliveryUncertain: ["입고대기"] }, { n: 1 }));
    checkTrue("JP delivery-uncertain wording alone -> uncertain", isPurchasabilityUncertain({ n: 1 }, { n: 1, deliveryUncertain: ["納期未定"] }));
    checkTrue("JP availability=0 alone -> uncertain", isPurchasabilityUncertain({ n: 1 }, { n: 1, availability: 0 }));
    check("undefined on both sides -> not uncertain (but NOT read as 'confirmed available' anywhere else)", isPurchasabilityUncertain(undefined, undefined), false);

    // ============================================================
    // 7. buildReviewedRows / summarizeReview - the actual KPI logic
    // ============================================================
    const krEntries: KrResultEntry[] = [
      { n: 4, productName: "소니 FE 24mm F1.4 GM 정품", priceKrw: 2390000, salePriceKrw: 2190000 },
      { n: 1, productName: "후지필름 X-T50 실버", priceKrw: 1890000, detectedOptionHints: ["color:실버"] },
      { n: 2, productName: "후지필름 X-H2", priceKrw: 2890000 },
    ];
    const jpEntries: JpResultEntry[] = [
      // deliveryUncertain is recomputed by buildReport's reclassifyJp from
      // itemName (see compare-kr-jp-sample10.ts) - the wording has to
      // actually be IN the name for it to be detected, a manually-set
      // deliveryUncertain field alone would be discarded on reclassify.
      { n: 4, itemName: "ソニー FE 24mm F1.4 GM SEL24F14GM 納期未定", priceJpy: 198000, availability: 1 },
      { n: 1, itemName: "フジフイルム X-T50 シルバー", priceJpy: 158000, detectedOptionHints: ["color:シルバー"] },
      { n: 2, itemName: "フジフイルム X-H2", priceJpy: 228000 },
    ];
    const decisions: ReviewDecision[] = [
      { n: 4, decision: "approved", evidence: "확인함", reviewedAt: "2026-11-20T00:00:00.000Z" },
      // n=1 and n=2: no decision recorded (still pending)
    ];

    const reviewed = buildReviewedRows(krEntries, jpEntries, decisions);
    const row4 = reviewed.find((r) => r.row.item.n === 4)!;
    check("n=4: status is 자동 동일 모델 후보 (no hardOptionGroups)", row4.row.status, "자동 동일 모델 후보");
    checkTrue("n=4: approved AND bothPricesPresent -> validPricePair true", row4.validPricePair);
    checkTrue("n=4: still purchasabilityUncertain despite being an approved, valid price pair (JP 納期未定)", row4.purchasabilityUncertain);

    const row2 = reviewed.find((r) => r.row.item.n === 2)!;
    check("n=2: status is 자동 동일 모델 후보 too (no hardOptionGroups, no decision yet)", row2.row.status, "자동 동일 모델 후보");
    checkTrue(
      "n=2: bothPricesPresent is true, but with NO decision at all -> validPricePair MUST be false (requirement: price presence alone is not enough)",
      row2.row.bothPricesPresent && !row2.validPricePair,
    );

    const summary = summarizeReview(reviewed);
    check("summarizeReview.total covers all 10 SELECTED_ITEMS, not just the 3 supplied", summary.total, 10);
    check("reviewedCount is 1 (only n=4 has a decision)", summary.reviewedCount, 1);
    check("pendingCount is 9 (everything else, including n=1/n=2 which have DATA but no decision)", summary.pendingCount, 9);
    check("validPricePairCount is 1 (only the approved one, despite n=2 also having both prices)", summary.validPricePairCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
