/**
 * Offline regression tests for supply-rakuten-diving12.ts - no network,
 * no applicationId/accessKey. Run directly:
 *   npx tsx src/scripts/supply-rakuten-diving12.test.ts
 */
import { classifyCandidate } from "./supply-11st-sample10";
import { PRIOR_EVIDENCE, MAX_LIVE_CALLS_DIVING } from "./supply-diving-sample12";
import {
  JP_DIVING_ITEMS,
  WORTHWHILE_JP_DIVING_ITEMS,
  MAX_HTTP_REQUESTS_DIVING,
  buildJpSearchKeyword,
  toJpResultEntry,
} from "./supply-rakuten-diving12";
import type { RakutenItem } from "../adapters/rakuten";

function rakutenItem(itemName: string, overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    itemName,
    itemPrice: 10000,
    itemUrl: "https://item.rakuten.co.jp/example/1/",
    itemCode: "example:1",
    shopName: "example-shop",
    shopCode: "example",
    availability: 1,
    ...overrides,
  };
}

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

function itemByN(n: number) {
  const item = JP_DIVING_ITEMS.find((i) => i.n === n);
  if (!item) throw new Error(`no JP_DIVING_ITEMS entry for n=${n}`);
  return item;
}

function main() {
  check("JP_DIVING_ITEMS has one entry per diving item", JP_DIVING_ITEMS.length, MAX_LIVE_CALLS_DIVING);
  check("WORTHWHILE_JP_DIVING_ITEMS is exactly the 동일 상품 후보 8", WORTHWHILE_JP_DIVING_ITEMS.length, 8);
  check("MAX_HTTP_REQUESTS_DIVING matches the worthwhile count", MAX_HTTP_REQUESTS_DIVING, 8);
  checkTrue(
    "every worthwhile item is actually flagged liveCallWorthwhile in PRIOR_EVIDENCE",
    WORTHWHILE_JP_DIVING_ITEMS.every((i) => PRIOR_EVIDENCE[i.n].liveCallWorthwhile),
  );

  {
    const item = itemByN(16); // regulator - JP-language DIN/stage axis
    const din = classifyCandidate(item, { productName: "アクアラング Leg3nd DINファーストステージ レギュレーター" });
    checkTrue("JP regulator DIN connection hint detected", din.detectedOptionHints.some((h) => h === "connection:DIN"));
  }
  {
    const item = itemByN(14); // Garmin Mk3s vs Mk3i in Japanese
    const mk3i = classifyCandidate(item, { productName: "ガーミン Garmin Descent Mk3i チタニウム ダイブコンピューター" });
    checkTrue("JP Garmin Mk3i (titanium) excluded, not accepted as Mk3s", mk3i.matchedExcludeTerms.includes("Mk3i"));
  }
  {
    const item = itemByN(16);
    const hose = classifyCandidate(item, { productName: "アクアラング Leg3nd 互換 交換用 ホース" });
    check("JP regulator 互換+交換用+ホース accessory listing -> REJECTED_ACCESSORY", hose.classification, "REJECTED_ACCESSORY");
  }

  // ============================================================
  // JP size-token boundary regression (요청 2): S/SS, XS/S, XL/L, XXL/XL -
  // mirrors supply-diving-sample12.test.ts's KR-side cases exactly.
  // ============================================================
  {
    const item = itemByN(18); // bcd, STANDARD size patterns (no "SS" tier - fins-only, see #20 below)
    const xs = classifyCandidate(item, { productName: "ジーグル Zeagle Ranger XSサイズ BCD" });
    checkTrue("JP XSサイズ detected as XS", xs.detectedOptionHints.includes("size:XSサイズ"));
    checkTrue("JP XSサイズ does NOT ALSO report a bare Sサイズ hit (suffix collision closed)", !xs.detectedOptionHints.includes("size:Sサイズ"));

    const xl = classifyCandidate(item, { productName: "ジーグル Zeagle Ranger XLサイズ BCD" });
    checkTrue("JP XLサイズ detected as XL", xl.detectedOptionHints.includes("size:XLサイズ"));
    checkTrue("JP XLサイズ does NOT ALSO report a bare Lサイズ hit (suffix collision closed)", !xl.detectedOptionHints.includes("size:Lサイズ"));

    const xxl = classifyCandidate(item, { productName: "ジーグル Zeagle Ranger XXLサイズ BCD" });
    checkTrue("JP XXLサイズ detected as XXL", xxl.detectedOptionHints.includes("size:XXLサイズ"));
    checkTrue("JP XXLサイズ does NOT ALSO report XLサイズ (suffix collision closed)", !xxl.detectedOptionHints.includes("size:XLサイズ"));

    const plainS = classifyCandidate(item, { productName: "ジーグル Zeagle Ranger サイズS BCD" });
    checkTrue("JP サイズS alone (no SS) detects cleanly", plainS.detectedOptionHints.includes("size:サイズS"));
  }
  {
    const item = itemByN(20); // fins, FIN size patterns (includes SS)
    const ss = classifyCandidate(item, { productName: "ツサ TUSA Solla サイズSS フィン" });
    checkTrue("JP fins サイズSS detected as SS", ss.detectedOptionHints.includes("size:サイズSS"));
    checkTrue("JP fins サイズSS does not also report サイズS (prefix collision closed)", !ss.detectedOptionHints.includes("size:サイズS"));

    const xl = classifyCandidate(item, { productName: "ツサ TUSA Solla XLサイズ フィン" });
    checkTrue("JP fins XLサイズ does not also report Lサイズ", !xl.detectedOptionHints.includes("size:Lサイズ"));
  }

  // ============================================================
  // #20 regional_spec stays 미확인 (요청 4) - mirrors KR-side test.
  // ============================================================
  {
    const item = itemByN(20);
    const sf22 = classifyCandidate(item, { productName: "ツサ TUSA Solla SF-22 オープンヒール フィン" });
    checkTrue("JP SF-22 regional_spec hint detected", sf22.detectedOptionHints.some((h) => h.startsWith("regional_spec:")));
    const noSpec = classifyCandidate(item, { productName: "ツサ TUSA Solla オープンヒール フィン" });
    check("JP no regional spec code stated -> EXACT still reachable (soft axis, no cap)", noSpec.classification, "EXACT_CANDIDATE");
  }

  // ============================================================
  // buildJpSearchKeyword (요청 5) - parenthetical/slash stripping THEN
  // Rakuten's standalone-token normalizeKeyword(), in that order.
  // ============================================================
  {
    const item = itemByN(13); // Shearwater Peregrine (parenthetical title)
    const { keyword, wasSimplified, droppedAlternative } = buildJpSearchKeyword(item.title);
    checkTrue("JP keyword is simplified from the raw title", wasSimplified);
    checkTrue("JP keyword does not contain a trailing parenthetical", !keyword.includes("("));
    check("JP keyword has no dropped-alternative for a non-slash title", droppedAlternative, undefined);
  }

  // ============================================================
  // toJpResultEntry candidate preservation (요청 1) - up to 5 candidates
  // preserved, callStatus distinguishes ok/no_results/call_failed/
  // all_candidates_rejected, top-level fields mirror best for backward
  // compat.
  // ============================================================
  {
    const item = itemByN(14); // Garmin Mk3s vs Mk3i
    const items = [
      rakutenItem("ガーミン Garmin Descent Mk3s ダイブコンピューター", { itemPrice: 350000 }),
      rakutenItem("ガーミン Garmin Descent Mk3i チタニウム ダイブコンピューター", { itemPrice: 450000 }),
    ];
    const entry = toJpResultEntry(item, { status: "ok", items }) as Record<string, unknown>;
    check("JP callStatus is 'ok' when a best candidate exists", entry.callStatus, "ok");
    check("JP candidates array preserves ALL returned candidates (2), not just best", (entry.candidates as unknown[]).length, 2);
    check("JP top-level itemName mirrors the best candidate (backward compat)", entry.itemName, "ガーミン Garmin Descent Mk3s ダイブコンピューター");
    check("JP humanVerified always starts false", entry.humanVerified, false);
  }
  {
    const item = itemByN(14);
    const entry = toJpResultEntry(item, { status: "ok", items: [] }) as Record<string, unknown>;
    check("JP callStatus is 'no_results' for an empty response", entry.callStatus, "no_results");
    check("JP candidates is an empty array, not omitted", entry.candidates, []);
  }
  {
    const item = itemByN(14);
    const items = [rakutenItem("Garmin Mk3i チタニウム ダイブコンピューター")];
    const classifiedCheck = classifyCandidate(item, { productName: items[0].itemName });
    checkTrue("JP sanity: this fixture candidate really is excluded (Mk3i)", classifiedCheck.matchedExcludeTerms.includes("Mk3i"));
    const entry = toJpResultEntry(item, { status: "ok", items }) as Record<string, unknown>;
    check("JP callStatus is 'all_candidates_rejected' (results existed, none usable)", entry.callStatus, "all_candidates_rejected");
    check("JP the rejected candidate is still preserved for inspection", (entry.candidates as unknown[]).length, 1);
  }
  {
    const item = itemByN(14);
    const entry = toJpResultEntry(item, { status: "call_failed", errorMessage: "HTTP 500 server error" }) as Record<string, unknown>;
    check("JP callStatus is 'call_failed'", entry.callStatus, "call_failed");
    check("JP errorMessage is preserved", entry.errorMessage, "HTTP 500 server error");
    check("JP candidates is empty (never fabricated) on a call failure", entry.candidates, []);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
