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
import {
  recordDecision,
  loadDecisions,
  pickLatestPerN,
  isPurchasabilityUncertain,
  hasPriceDataAnomaly,
  buildReviewedRows,
  summarizeReview,
  assertValidApproval,
  approvalContextFromRow,
  DEFAULT_DECISIONS_PATH,
  MIN_EVIDENCE_LENGTH,
  MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL,
  type ReviewDecision,
  type ApprovalContext,
} from "./review-kr-jp-sample10";
import { buildReport } from "./compare-kr-jp-sample10";
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

const LONG_EVIDENCE = "두 URL 직접 열어 모델/색상/가격 모두 일치하는지 확인함";
checkTrue("sanity: LONG_EVIDENCE actually clears both length floors used below", LONG_EVIDENCE.length >= MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL);

function main() {
  const dir = mkdtempSync(join(tmpdir(), "review-kr-jp-test-"));
  const decisionsPath = join(dir, "review-decisions.json");
  // Requirement 8 ("실제 검수 없이 승인 수를 증가시키는 코드나 테스트
  // 데이터가 운영 결과에 섞이지 않도록 방지"): assert every test write in
  // this file targets an isolated temp path, never the real default.
  checkTrue("test decisions path is isolated from the production default", decisionsPath !== DEFAULT_DECISIONS_PATH);

  try {
    // ============================================================
    // 1. loadDecisions on a missing file -> empty array, never throws
    // ============================================================
    check("loadDecisions on a file that doesn't exist yet -> []", loadDecisions(decisionsPath), []);
    checkTrue("no file was created just by reading", !existsSync(decisionsPath));

    // ============================================================
    // 2. evidence floor - requirement 4: existence alone isn't enough
    // ============================================================
    const okContext: ApprovalContext = { status: "자동 동일 모델 후보", hasKrData: true, hasJpData: true, optionAxisLabels: [] };
    {
      let threw = false;
      try {
        assertValidApproval(4, "approved", "", okContext, []);
      } catch {
        threw = true;
      }
      checkTrue("empty evidence throws for ANY decision", threw);

      let threwShort = false;
      try {
        assertValidApproval(4, "approved", "ok", okContext, []);
      } catch {
        threwShort = true;
      }
      checkTrue(`evidence shorter than MIN_EVIDENCE_LENGTH(${MIN_EVIDENCE_LENGTH}) throws - "exists" is not "verified"`, threwShort);
    }

    // ============================================================
    // 3. THE REPORTED BUG, fixed at the write side: approving a 불일치
    //    row must be structurally impossible, regardless of evidence
    //    length or confirmedOptionAxes.
    // ============================================================
    {
      const mismatchContext: ApprovalContext = { status: "불일치", hasKrData: true, hasJpData: true, optionAxisLabels: [] };
      let threw = false;
      let message = "";
      try {
        assertValidApproval(7, "approved", LONG_EVIDENCE, mismatchContext, []);
      } catch (e) {
        threw = true;
        message = e instanceof Error ? e.message : String(e);
      }
      checkTrue("approving a 불일치 row THROWS even with long, real-looking evidence", threw);
      checkTrue("the error names 불일치 and points to rejected instead", message.includes("불일치") && message.includes("rejected"));

      // rejected/held for a 불일치 row must still be ALLOWED (only
      // "approved" is blocked).
      let rejectThrew = false;
      try {
        assertValidApproval(7, "rejected", LONG_EVIDENCE, mismatchContext, []);
      } catch {
        rejectThrew = true;
      }
      checkTrue("rejecting a 불일치 row is still allowed (only approval is blocked)", !rejectThrew);
    }

    // ============================================================
    // 4. 데이터없음 / incomplete data can't be approved either
    // ============================================================
    {
      const noDataContext: ApprovalContext = { status: "데이터없음", hasKrData: true, hasJpData: false, optionAxisLabels: [] };
      let threw = false;
      try {
        assertValidApproval(2, "approved", LONG_EVIDENCE, noDataContext, []);
      } catch {
        threw = true;
      }
      checkTrue("approving with missing JP data throws even if status weren't already 데이터없음", threw);
    }

    // ============================================================
    // 5. 검수 필요 approval requires every option axis to be explicitly
    //    confirmed AND a longer evidence string (requirement 2/3)
    // ============================================================
    {
      const reviewContext: ApprovalContext = { status: "검수 필요", hasKrData: true, hasJpData: true, optionAxisLabels: ["color"] };

      let threwMissingAxis = false;
      try {
        assertValidApproval(1, "approved", LONG_EVIDENCE, reviewContext, []); // no confirmedOptionAxes at all
      } catch {
        threwMissingAxis = true;
      }
      checkTrue("검수 필요 approval without confirming the 'color' axis throws", threwMissingAxis);

      let threwShortEvidence = false;
      try {
        assertValidApproval(1, "approved", "확인함", reviewContext, ["color"]); // axis confirmed, but evidence too short
      } catch {
        threwShortEvidence = true;
      }
      checkTrue(
        `검수 필요 approval with the axis confirmed but evidence under MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL(${MIN_EVIDENCE_LENGTH_FOR_REVIEW_APPROVAL}) still throws`,
        threwShortEvidence,
      );

      let succeeded = true;
      try {
        assertValidApproval(1, "approved", LONG_EVIDENCE, reviewContext, ["color"]);
      } catch {
        succeeded = false;
      }
      checkTrue("검수 필요 approval with the axis confirmed AND long enough evidence succeeds", succeeded);
    }

    // ============================================================
    // 5b. The widened rule: a row that reaches 자동 동일 모델 후보 (NOT
    //     검수 필요) via a SOFT axis that simply went undetected on both
    //     sides must STILL require axis confirmation before approval -
    //     "실제 옵션이 확인되지 않은 것을 일치로 간주하지 않음".
    // ============================================================
    {
      const autoCandidateWithUndeclaredAxis: ApprovalContext = {
        status: "자동 동일 모델 후보",
        hasKrData: true,
        hasJpData: true,
        optionAxisLabels: ["color"], // e.g. a soft config/color axis that never triggered 검수 필요 because neither side mentioned it
      };
      let threwUnconfirmedAxis = false;
      try {
        assertValidApproval(2, "approved", LONG_EVIDENCE, autoCandidateWithUndeclaredAxis, []);
      } catch {
        threwUnconfirmedAxis = true;
      }
      checkTrue(
        "approving a 자동 동일 모델 후보 row still throws when its option axis was never confirmed (status alone is not enough)",
        threwUnconfirmedAxis,
      );

      let succeededWithAxisNamed = true;
      try {
        assertValidApproval(2, "approved", LONG_EVIDENCE, autoCandidateWithUndeclaredAxis, ["color"]);
      } catch {
        succeededWithAxisNamed = false;
      }
      checkTrue("...but succeeds once the human explicitly names that axis as checked", succeededWithAxisNamed);
    }

    // ============================================================
    // 6. recordDecision - real write, round-tripped through disk, and
    //    APPENDS (preserves history) rather than overwriting
    // ============================================================
    {
      const now1 = new Date("2026-11-20T03:00:00.000Z");
      const afterFirst = recordDecision(decisionsPath, 4, "held", "라쿠텐 재고 플래그 재확인 필요함", okContext, { reviewer: "alice", now: now1 });
      check("first decision recorded", afterFirst.length, 1);

      const now2 = new Date("2026-11-21T03:00:00.000Z");
      const afterSecond = recordDecision(decisionsPath, 4, "approved", LONG_EVIDENCE, okContext, { reviewer: "bob", now: now2 });
      check("second decision for the SAME n APPENDS, does not replace - history has 2 entries now", afterSecond.length, 2);

      const onDisk = JSON.parse(readFileSync(decisionsPath, "utf-8")) as ReviewDecision[];
      check("both historical entries are still on disk (requirement 7: preserve amendment history)", onDisk.length, 2);
      check("the FIRST entry's decision is still 'held', unmodified", onDisk[0].decision, "held");

      const latest = pickLatestPerN(onDisk);
      check("pickLatestPerN resolves n=4 to the MOST RECENT entry (approved), not the first (held)", latest.get(4)?.decision, "approved");
    }

    // ============================================================
    // 7. isPurchasabilityUncertain - never conflated with decision
    // ============================================================
    check("no delivery-uncertain wording, availability=1 -> not uncertain", isPurchasabilityUncertain({ n: 1 }, { n: 1, availability: 1 }), false);
    checkTrue("KR delivery-uncertain wording alone -> uncertain", isPurchasabilityUncertain({ n: 1, deliveryUncertain: ["입고대기"] }, { n: 1 }));
    checkTrue("JP availability=0 alone -> uncertain", isPurchasabilityUncertain({ n: 1 }, { n: 1, availability: 0 }));

    // ============================================================
    // 8. THE EXACT REGRESSION ASKED FOR: approving a 불일치 item (via
    //    this script's own public API) must NEVER count as a valid
    //    price pair - both at the write side (recordDecision refuses)
    //    AND, independently, at the read side (buildReviewedRows/
    //    summarizeReview re-check row.status themselves, in case a
    //    decisions file was edited by hand or predates this fix).
    // ============================================================
    {
      // #7 OnePlus Buds Pro 3 - a real accessory-only listing, which
      // classifyCandidate rejects outright (REJECTED_ACCESSORY) -> row
      // status 불일치.
      const krEntries: KrResultEntry[] = [{ n: 7, productName: "OnePlus Buds Pro 3 교체용 폼 이어팁", priceKrw: 15000 }];
      const jpEntries: JpResultEntry[] = [{ n: 7, itemName: "ワンプラス Buds Pro3 イヤーピース 交換用セット", priceJpy: 1800 }];

      // buildReport (not a bare compareRow) because its reclassifyKr/
      // reclassifyJp is what actually recomputes classification from
      // productName/itemName - exactly what buildReviewedRows also uses.
      const row7 = buildReport(krEntries, jpEntries).rows.find((r) => r.item.n === 7)!;
      check("sanity: #7 with this data really is 불일치 (REJECTED_ACCESSORY on both sides)", row7.status, "불일치");
      checkTrue("sanity: both prices are present (this is exactly the risky case)", row7.bothPricesPresent);

      // 8a. write side: recordDecision must REFUSE to record "approved".
      const dedicatedPath = join(dir, "mismatch-decisions.json");
      let wrongApprovalThrew = false;
      try {
        recordDecision(dedicatedPath, 7, "approved", LONG_EVIDENCE, approvalContextFromRow(row7));
      } catch {
        wrongApprovalThrew = true;
      }
      checkTrue("recordDecision() refuses to write 'approved' for this 불일치 item at all", wrongApprovalThrew);
      checkTrue("no decisions file was created by the refused call", !existsSync(dedicatedPath));

      // 8b. read side defense-in-depth: even if an "approved" entry for
      // this 불일치 item exists in the file some other way (hand-edited,
      // or written before this fix), buildReviewedRows/summarizeReview
      // must still never count it.
      const smuggledDecisions: ReviewDecision[] = [
        { n: 7, decision: "approved", evidence: "(사전 기록 - 이 수정 이전에 잘못 승인된 것을 시뮬레이션)", reviewedAt: "2026-01-01T00:00:00.000Z" },
      ];
      const reviewed = buildReviewedRows(krEntries, jpEntries, smuggledDecisions);
      const reviewedRow7 = reviewed.find((r) => r.row.item.n === 7)!;
      check("reviewedRow7.row.status is still 불일치", reviewedRow7.row.status, "불일치");
      checkTrue(
        "even with a smuggled-in 'approved' decision on disk, validPricePair is FALSE for this 불일치 item - the exact bug reported",
        !reviewedRow7.validPricePair,
      );

      const summary = summarizeReview(reviewed);
      check("summarizeReview.validPricePairCount does NOT count the smuggled 불일치 approval", summary.validPricePairCount, 0);
      check("but it IS counted as finalizedCount (a decision exists, just not a valid price pair)", summary.finalizedCount, 1);
    }

    // ============================================================
    // 9. held vs finalized vs pending - requirement 5
    // ============================================================
    {
      const krEntries: KrResultEntry[] = [
        { n: 4, productName: "소니 FE 24mm F1.4 GM 정품", priceKrw: 2390000, salePriceKrw: 2190000 },
        { n: 2, productName: "후지필름 X-H2", priceKrw: 2890000 },
        { n: 3, productName: "캐논 EOS R6 Mark II 바디", priceKrw: 3190000 },
      ];
      const jpEntries: JpResultEntry[] = [
        { n: 4, itemName: "ソニー FE 24mm F1.4 GM SEL24F14GM", priceJpy: 198000 },
        { n: 2, itemName: "フジフイルム X-H2", priceJpy: 228000 },
        { n: 3, itemName: "キヤノン EOS R6 Mark II ボディ", priceJpy: 268000 },
      ];
      const decisions: ReviewDecision[] = [
        { n: 4, decision: "approved", evidence: LONG_EVIDENCE, reviewedAt: "2026-11-20T00:00:00.000Z" },
        { n: 2, decision: "held", evidence: "재고 플래그 재확인 중", reviewedAt: "2026-11-20T00:00:00.000Z" },
        // n=3: no decision at all - pending
      ];
      const reviewed = buildReviewedRows(krEntries, jpEntries, decisions);
      const summary = summarizeReview(reviewed);
      check("summary.total covers all 10 SELECTED_ITEMS", summary.total, 10);
      check("finalizedCount is 1 (only the approved n=4)", summary.finalizedCount, 1);
      check("heldCount is 1 (n=2), separate from finalizedCount (requirement 5)", summary.heldCount, 1);
      check("pendingCount is 8 (everything else, n=3 included, even though n=3 HAS data)", summary.pendingCount, 8);
      check("validPricePairCount is 1 (only the approved, non-불일치, both-prices-present n=4)", summary.validPricePairCount, 1);
    }

    // ============================================================
    // 10. hasPriceDataAnomaly - requirement 6, a narrow well-defined check
    // ============================================================
    check("salePriceKrw > priceKrw -> anomaly (inverted discount)", hasPriceDataAnomaly({ n: 1, priceKrw: 100000, salePriceKrw: 150000 }, { n: 1 }), true);
    check("priceKrw=0 -> anomaly (near-certain data error)", hasPriceDataAnomaly({ n: 1, priceKrw: 0 }, { n: 1 }), true);
    check("priceJpy=0 -> anomaly", hasPriceDataAnomaly({ n: 1 }, { n: 1, priceJpy: 0 }), true);
    check("normal prices on both sides -> no anomaly", hasPriceDataAnomaly({ n: 1, priceKrw: 200000, salePriceKrw: 180000 }, { n: 1, priceJpy: 15000 }), false);

    // ============================================================
    // 11. REQUIREMENT 7 - classification rule changes recompute from the
    //     latest classifier, while the decision file's history survives
    //     untouched. Simulates: a human approved #2 (X-H2) under what
    //     WAS, at the time, an undetected kit/body mismatch (exactly the
    //     real bug this review reported) - re-running the report under
    //     the NOW-fixed classifier must recompute #2 as 불일치 and refuse
    //     to count it as a valid price pair, while the old decision
    //     record itself is neither deleted nor silently rewritten.
    // ============================================================
    {
      const historyPath = join(dir, "rule-change-decisions.json");
      const oldApproval = recordDecision(
        historyPath,
        2,
        "approved",
        "구형 분류기 기준으로 승인 - 이 승인은 분류 규칙 수정 전에 기록됨",
        { status: "자동 동일 모델 후보", hasKrData: true, hasJpData: true, optionAxisLabels: [] }, // the OLD (pre-fix) context #2 would have had
      );
      check("the old approval was actually written", oldApproval.length, 1);

      // Now feed the SAME real text through the CURRENT (fixed) pipeline.
      const krEntries: KrResultEntry[] = [{ n: 2, productName: "후지필름 X-H2 + XF 16-80mm 렌즈킷", priceKrw: 2890000 }];
      const jpEntries: JpResultEntry[] = [{ n: 2, itemName: "フジフイルム X-H2 ボディ単品", priceJpy: 228000 }];
      const reviewed = buildReviewedRows(krEntries, jpEntries, loadDecisions(historyPath));
      const row2 = reviewed.find((r) => r.row.item.n === 2)!;

      check("re-running under the FIXED classifier now recomputes #2 as 불일치", row2.row.status, "불일치");
      checkTrue("the old 'approved' decision is still THERE (history preserved, not deleted)", loadDecisions(historyPath).some((d) => d.n === 2 && d.decision === "approved"));
      checkTrue("but it no longer counts as a valid price pair under the corrected rules", !row2.validPricePair);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
