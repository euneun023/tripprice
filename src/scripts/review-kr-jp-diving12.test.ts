/**
 * Offline regression tests for review-kr-jp-diving12.ts - no network.
 * File I/O against a real temp file (os.tmpdir()), cleaned up at the
 * end. Run directly:
 *   npx tsx src/scripts/review-kr-jp-diving12.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordDivingDecision,
  loadDivingDecisions,
  buildDivingReviewedRows,
  buildDivingScorecard,
  specialtyShopStatus,
  DEFAULT_DIVING_DECISIONS_PATH,
  type DivingReviewDecision,
} from "./review-kr-jp-diving12";
import { buildDivingReport } from "./compare-kr-jp-diving12";
import { approvalContextFromRow } from "./review-kr-jp-sample10";
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
  const dir = mkdtempSync(join(tmpdir(), "review-diving12-test-"));
  const decisionsPath = join(dir, "review-decisions-diving12.json");
  checkTrue("test decisions path is isolated from the production default", decisionsPath !== DEFAULT_DIVING_DECISIONS_PATH);

  try {
    // ============================================================
    // specialtyShopStatus - the new 전문몰 의존 metric
    // ============================================================
    check(
      "KR seller 'mic21' -> 전문몰 의존",
      specialtyShopStatus({ n: 1, seller: "mic21 (일본 다이빙 전문몰)" }, undefined),
      "전문몰 의존",
    );
    check(
      "JP shop URL containing 'elfdive' -> 전문몰 의존",
      specialtyShopStatus(undefined, { n: 1, url: "https://elfdive.com/product/x" } as JpResultEntry),
      "전문몰 의존",
    );
    check("no seller/shop/url data at all -> 알수없음, never assumed mainstream", specialtyShopStatus(undefined, undefined), "알수없음");
    check(
      "a seller name that matches none of the known specialty shops -> 대형몰/확인됨",
      specialtyShopStatus({ n: 1, seller: "11번가 공식스토어" }, undefined),
      "대형몰/확인됨",
    );

    // ============================================================
    // recordDivingDecision - reuses assertValidApproval (same 불일치
    // block as the camera reviewer), plus the new diving-only fields
    // ============================================================
    {
      const krEntries: KrResultEntry[] = [{ n: 14, productName: "가민 Garmin Descent Mk3s 다이빙 컴퓨터", priceKrw: 950000 }];
      const jpEntries: JpResultEntry[] = [{ n: 14, itemName: "ガーミン Garmin Descent Mk3s ダイブコンピューター", priceJpy: 187000 }];
      const row = buildDivingReport(krEntries, jpEntries).rows.find((r) => r.item.n === 14)!;
      check("sanity: #14 with clean matching data -> 자동 동일 모델 후보", row.status, "자동 동일 모델 후보");

      // #14 declares a case_size soft axis (43mm/51mm) - the widened
      // assertValidApproval rule (요청 3) requires it be named in
      // confirmedOptionAxes even though the row's automatic status is
      // 자동 동일 모델 후보, not 검수 필요.
      const decisions = recordDivingDecision(decisionsPath, 14, "approved", "두 URL 직접 확인, 모델/가격/케이스사이즈 일치함", approvalContextFromRow(row), {
        reviewer: "alice",
        confirmedOptionAxes: ["case_size"],
        reviewTimeMinutes: 7,
        commercialRightsStatus: "unconfirmed",
      });
      check("decision recorded with the diving-only fields", decisions[0].reviewTimeMinutes, 7);
      check("commercialRightsStatus defaults/stays unconfirmed unless explicitly set otherwise", decisions[0].commercialRightsStatus, "unconfirmed");

      const reloaded = loadDivingDecisions(decisionsPath);
      check("round-trips through disk correctly", reloaded[0].reviewTimeMinutes, 7);
    }
    {
      // The reported-bug class, re-verified for diving: #17 is a KNOWN
      // 불일치 후보 (wrong_category) - approving it must be refused the
      // same way it is for camera's 불일치 rows.
      const krEntries: KrResultEntry[] = [{ n: 17, productName: "완전히 다른 카테고리 상품", priceKrw: 10000 }];
      const row17 = buildDivingReport(krEntries, []).rows.find((r) => r.item.n === 17)!;
      // KR text doesn't even contain the base model token ("Zeo") -> KR
      // side classifies MISMATCH, which compareRow treats as 불일치
      // immediately (checked before "both sides must have data"), same
      // as camera's own NON_IDENTITY_CLASSIFICATIONS handling.
      check("#17 whose KR text doesn't match the base model at all -> 불일치", row17.status, "불일치");
      let threw = false;
      try {
        recordDivingDecision(join(dir, "never-written.json"), 17, "approved", "충분히 긴 근거 문자열입니다", approvalContextFromRow(row17));
      } catch {
        threw = true;
      }
      checkTrue("approving a 불일치 diving row is refused, same discipline as camera", threw);
    }
    {
      // ============================================================
      // 요청 3: BCD/핀/슈트에서 필수 사이즈·색상·성별이 불명확하면 동일
      // 상품을 최종 승인하지 않도록 - item #18 is a BCD with a `size`
      // soft axis. Neither side's title states a size, so the axis is
      // 해당없음(soft, undetected) and the row still reaches 자동 동일
      // 모델 후보 - but approval must still be refused unless a human
      // explicitly names "size" as checked, because 해당없음 means
      // "nothing stated", not "confirmed to not matter".
      // ============================================================
      const krEntries: KrResultEntry[] = [{ n: 18, productName: "지글 Zeagle Ranger BCD", priceKrw: 450000 }];
      const jpEntries: JpResultEntry[] = [{ n: 18, itemName: "ジーグル Zeagle Ranger BCD", priceJpy: 48000 }];
      const row18 = buildDivingReport(krEntries, jpEntries).rows.find((r) => r.item.n === 18)!;
      check("#18 BCD with no size stated on either side -> still 자동 동일 모델 후보 (soft axis, 해당없음)", row18.status, "자동 동일 모델 후보");
      checkTrue("#18 declares a size option axis", approvalContextFromRow(row18).optionAxisLabels.includes("size"));

      let threwUnconfirmedSize = false;
      try {
        recordDivingDecision(
          join(dir, "never-written-18a.json"),
          18,
          "approved",
          "두 URL 직접 확인, 브랜드/모델명 일치함",
          approvalContextFromRow(row18),
        );
      } catch {
        threwUnconfirmedSize = true;
      }
      checkTrue("approving #18 BCD without confirming the size axis is refused - 실제 옵션 미확인을 일치로 간주하지 않음", threwUnconfirmedSize);

      let succeededWithSizeConfirmed = true;
      try {
        recordDivingDecision(
          join(dir, "never-written-18b.json"),
          18,
          "approved",
          "두 URL 직접 확인, 사이즈 옵션 없음(단일 사이즈 상품)을 직접 확인함",
          approvalContextFromRow(row18),
          { confirmedOptionAxes: ["size"] },
        );
      } catch {
        succeededWithSizeConfirmed = false;
      }
      checkTrue("...but succeeds once a human explicitly names 'size' as checked", succeededWithSizeConfirmed);
    }

    // ============================================================
    // buildDivingScorecard - the 8 requested metrics, individually
    // ============================================================
    {
      const krEntries: KrResultEntry[] = [
        { n: 14, productName: "가민 Garmin Descent Mk3s 다이빙 컴퓨터", priceKrw: 950000, seller: "11번가 공식스토어" },
        { n: 22, productName: "투사 TUSA Freedom HD Mask", priceKrw: 89000, seller: "elfdive 다이빙 전문몰" },
      ];
      const jpEntries: JpResultEntry[] = [{ n: 14, itemName: "ガーミン Garmin Descent Mk3s ダイブコンピューター", priceJpy: 187000 }];
      const decisions: DivingReviewDecision[] = [
        { n: 14, decision: "approved", evidence: "확인완료 - 모델 및 가격 직접 대조함", reviewedAt: "2026-11-25T00:00:00.000Z", reviewTimeMinutes: 7, commercialRightsStatus: "unconfirmed" },
      ];
      const reviewed = buildDivingReviewedRows(krEntries, jpEntries, decisions);
      const scorecard = buildDivingScorecard(reviewed);

      check("krFoundCount counts items with a KR productName (2 here)", scorecard.krFoundCount, 2);
      check("jpFoundCount counts items with a JP itemName (1 here)", scorecard.jpFoundCount, 1);
      check("bothPricesPresentCount is 1 (#14 only - #22 has no JP price at all)", scorecard.bothPricesPresentCount, 1);
      checkTrue("candidateCount includes #14 (자동 동일 모델 후보)", scorecard.candidateCount >= 1);
      check("finalValidPricePairCount is 1 (#14 approved + both prices)", scorecard.finalValidPricePairCount, 1);
      checkTrue("specialtyShopDependentCount counts #22 (elfdive)", scorecard.specialtyShopDependentCount >= 1);
      check("totalReviewTimeMinutes sums only recorded decisions (7, not more)", scorecard.totalReviewTimeMinutes, 7);
      check("commercialRightsConfirmedCount is 0 - unconfirmed is the recorded status, never silently promoted", scorecard.commercialRightsConfirmedCount, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
