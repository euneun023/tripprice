/**
 * Offline regression tests for supply-rakuten-sample10.ts - no real
 * network call anywhere in this file. The "LIVE run" tests below replace
 * globalThis.fetch with a fake for their duration (same convention as
 * src/adapters/coupang.test.ts's withFakeFetch), always restored
 * afterward, and use a dummy applicationId/accessKey that is never sent
 * anywhere real.
 *
 * Run directly:
 *   npx tsx src/scripts/supply-rakuten-sample10.test.ts
 */
import { JP_ITEMS, normalizeKeyword, RequestBudget, runLive } from "./supply-rakuten-sample10";
import { SELECTED_ITEMS, MAX_LIVE_CALLS, classifyCandidate } from "./supply-11st-sample10";
import { buildRakutenFallbackKeyword } from "../adapters/rakuten";

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

async function withFakeFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  return fn()
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.log = original;
    });
}

async function main() {
  // ============================================================
  // 1. keyword pre-normalization - offline, pure
  // ============================================================
  check("OnePlus Buds Pro 3 (standalone digit) is pre-normalized", normalizeKeyword("OnePlus Buds Pro 3"), "OnePlus Buds Pro3");
  check(
    "Bowers & Wilkins Px7 S3 (standalone '&') is pre-normalized",
    normalizeKeyword("Bowers & Wilkins Px7 S3"),
    "Bowers Wilkins Px7 S3",
  );
  check("Fitbit Sense 2 (standalone digit) is pre-normalized", normalizeKeyword("Fitbit Sense 2"), "Fitbit Sense2");
  check("Sony FE 24mm F1.4 GM (no issue) is left unchanged", normalizeKeyword("Sony FE 24mm F1.4 GM"), "Sony FE 24mm F1.4 GM");
  check(
    "every JP_ITEMS keyword matches what buildRakutenFallbackKeyword would eventually settle on (no second request needed)",
    JP_ITEMS.map((i) => normalizeKeyword(i.title)),
    JP_ITEMS.map((i) => buildRakutenFallbackKeyword(i.title) ?? i.title),
  );

  // ============================================================
  // 2. excludeTerms re-check (requirement 3): model-code collision guard
  //    (XH2S) must survive into the JP config, and the expanded JP
  //    used/refurb word list must be present on every item
  // ============================================================
  {
    const xh2 = JP_ITEMS.find((i) => i.n === 2)!;
    checkTrue("item #2 (X-H2) JP excludeTerms still guards against X-H2S", xh2.excludeTerms.includes("XH2S"));
    for (const item of JP_ITEMS) {
      checkTrue(`#${item.n} excludeTerms includes 整備済み (refurb)`, item.excludeTerms.includes("整備済み"));
      checkTrue(`#${item.n} excludeTerms includes 並行輸入 (parallel import)`, item.excludeTerms.includes("並行輸入"));
    }
  }

  // ============================================================
  // 2b. JP-side regression tests for the real false positives this
  //    review found (mirrors supply-11st-sample10.test.ts's own section)
  // ============================================================
  {
    const itemByN = (n: number) => JP_ITEMS.find((i) => i.n === n)!;

    // #7 OnePlus Buds Pro 3 - JP accessory wording (replacement eartip) ->
    // REJECTED_ACCESSORY (modifier+noun co-occurrence: 交換用+イヤーピース)
    const eartip = classifyCandidate(itemByN(7), { productName: "ワンプラス Buds Pro3 イヤーピース 交換用セット" });
    check("JP replacement-eartip listing for Buds Pro3 -> REJECTED_ACCESSORY, not EXACT", eartip.classification, "REJECTED_ACCESSORY");

    // Anti-false-positive: a bundle disclosure on the REAL earbuds (extra
    // eartips included) must NOT be rejected just because "イヤーピース"
    // appears - no modifier word (交換用/互換/専用/単品) is present.
    const bundleNote = classifyCandidate(itemByN(7), { productName: "ワンプラス Buds Pro3 ワイヤレスイヤホン 正規品 (イヤーピース3サイズ付属)" });
    checkTrue("JP bundle disclosure (イヤーピース付属) is NOT REJECTED_ACCESSORY", bundleNote.classification !== "REJECTED_ACCESSORY");
    check("the real earbuds (JP bundle note) still classifies EXACT", bundleNote.classification, "EXACT_CANDIDATE");

    // #5 Tamron 12-20mm F2.8 - mount is hard-required and unresolved, even
    // when the JP listing states a mount
    const nikonZ = classifyCandidate(itemByN(5), { productName: "タムロン 12-20mm F2.8 Di III-A RXD Zマウント(A084Z)" });
    check("JP Tamron 12-20mm F2.8, mount stated (Nikon Z) -> still NEEDS_REVIEW", nikonZ.classification, "NEEDS_REVIEW");
    checkTrue("JP mount hint detected and reported", nikonZ.detectedOptionHints.some((h) => h.startsWith("mount:")));

    // #1 FUJIFILM X-T50 - color hard-required and unresolved
    const silver = classifyCandidate(itemByN(1), { productName: "フジフイルム X-T50 シルバー ミラーレス一眼カメラ" });
    check("JP X-T50 with color stated (シルバー) -> still NEEDS_REVIEW", silver.classification, "NEEDS_REVIEW");
    check("JP color hint detected and reported", silver.detectedOptionHints, ["color:シルバー"]);

    // #4 Sony FE 24mm F1.4 GM - JP delivery-uncertain wording reported
    // separately, never downgrades classification
    const backorder = classifyCandidate(itemByN(4), { productName: "ソニー FE 24mm F1.4 GM SEL24F14GM 納期未定" });
    check("JP delivery-uncertain wording does not change identity classification", backorder.classification, "EXACT_CANDIDATE");
    checkTrue("JP delivery wording surfaced separately", backorder.matchedDeliveryUncertaintyTerms.includes("納期未定"));

    // Variable-length lead-time wording (requirement 2): a fixed string
    // list can't enumerate every "納期約Nヶ月" - must be caught by regex,
    // and distinct wordings must each be reported, not deduped/missed.
    const threeMonths = classifyCandidate(itemByN(1), { productName: "フジフイルム X-T50 シルバー 納期約3ヶ月" });
    checkTrue(
      "JP variable lead time '納期約3ヶ月' recognized via pattern, not just the fixed '納期未定' string",
      threeMonths.matchedDeliveryUncertaintyTerms.some((t) => t.includes("3ヶ月")),
    );
    const twoWeeks = classifyCandidate(itemByN(1), { productName: "フジフイルム X-T50 シルバー 納期2週間" });
    checkTrue(
      "JP variable lead time '納期2週間' (different number+unit) also recognized",
      twoWeeks.matchedDeliveryUncertaintyTerms.some((t) => t.includes("2週間")),
    );
    const arrivalWaiting = classifyCandidate(itemByN(1), { productName: "フジフイルム X-T50 シルバー 入荷待ち" });
    checkTrue("JP '入荷待ち' still recognized via the入荷 pattern too", arrivalWaiting.matchedDeliveryUncertaintyTerms.length > 0);
    const noDeliveryIssue = classifyCandidate(itemByN(1), { productName: "フジフイルム X-T50 シルバー 即納可能" });
    check("no delivery-uncertain wording at all -> empty list", noDeliveryIssue.matchedDeliveryUncertaintyTerms, []);
  }

  // ============================================================
  // 3. RequestBudget - hard cap, including the "adapter-internal retry"
  //    scenario this exists to prevent
  // ============================================================
  {
    const budget = new RequestBudget(10);
    for (let i = 0; i < 10; i++) budget.record();
    check("budget.spent is exactly 10 after 10 records", budget.spent, 10);
    check("budget.remaining is 0", budget.remaining, 0);
    let threw = false;
    try {
      budget.record();
    } catch {
      threw = true;
    }
    checkTrue("an 11th record() throws - the hard cap this exists for", threw);
  }

  // ============================================================
  // 4. runLive() end-to-end against a fake fetch - confirms the ACTUAL
  //    request count never exceeds 10, that maxRetries=0 means a 429
  //    produces exactly one fetch call (no adapter-internal retry), and
  //    that call-failed/no-results/model-mismatch/exact are distinguished
  // ============================================================
  await withEnv({ applicationId: "test-app-id", accessKey: "test-access-key" }, async () => {
    let fetchCallCount = 0;
    const perItemBehavior: Array<"ok_exact" | "ok_empty" | "http_429" | "http_500"> = [
      "ok_exact", // #1
      "ok_exact", // #2
      "ok_exact", // #3
      "ok_exact", // #4 Sony FE 24mm F1.4 GM
      "ok_empty", // #5 -> no_results
      "http_429", // #6 -> call_failed, must NOT retry
      "ok_exact", // #7
      "http_500", // #9 -> call_failed
      "ok_exact", // #12
      "ok_exact", // #25
    ];

    const fake = (async () => {
      const behavior = perItemBehavior[fetchCallCount];
      fetchCallCount++;
      if (behavior === "http_429") {
        return { ok: false, status: 429, json: async () => ({ error: "rate limited" }) } as unknown as Response;
      }
      if (behavior === "http_500") {
        return { ok: false, status: 500, json: async () => ({ error: "server error" }) } as unknown as Response;
      }
      if (behavior === "ok_empty") {
        return { ok: true, status: 200, json: async () => ({ Items: [] }) } as unknown as Response;
      }
      // ok_exact: return an item whose name satisfies that item's own
      // brandTerms/baseModelRequiredTerms so it classifies EXACT_CANDIDATE
      const n = JP_ITEMS[fetchCallCount - 1].n;
      const fixtureNames: Record<number, string> = {
        1: "フジフイルム X-T50 ミラーレス一眼カメラ",
        2: "フジフイルム X-H2 ミラーレス一眼カメラ",
        3: "キヤノン EOS R6 Mark II ボディ",
        4: "ソニー FE 24mm F1.4 GM SEL24F14GM",
        7: "ワンプラス Buds Pro3 ワイヤレスイヤホン",
        12: "フィットビット Sense2 スマートウォッチ",
        25: "SK-II ピテラ エッセンス 230ml",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({ Items: [{ itemName: fixtureNames[n], itemPrice: 50000, itemUrl: "https://example.jp/x", itemCode: "x", shopName: "shop", shopCode: "s", availability: 1 }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const { lines } = await withFakeFetch(fake, () => captureConsole(() => runLive(/* delayMs */ 0)));

    check("exactly 10 real HTTP requests made for 10 items (no adapter retry on 429/500)", fetchCallCount, 10);

    const tally = (label: string) => {
      const line = lines.find((l) => l.includes(label));
      return line ? Number(line.split(":").pop()?.trim()) : undefined;
    };
    checkTrue("실제 HTTP 요청 수 reported as 10/10", lines.some((l) => l.includes("실제 HTTP 요청 수: 10/10")));
    // Of the 7 "ok_exact" fixtures (n=1,2,3,4,7,12,25), n=1 (X-T50 color)
    // and n=12 (Fitbit Sense 2 color) carry hardOptionGroups with no color
    // token in their fixture name, so they're now correctly capped at
    // NEEDS_REVIEW instead of EXACT - leaving 5 true EXACT, 2 REVIEW.
    check("정확 매칭 count reflects 5 of the 7 ok_exact items (2 capped by hardOptionGroups)", tally("정확 매칭"), 5);
    checkTrue("검수 필요(NEEDS_REVIEW) 수: 2 (the 2 capped by hardOptionGroups)", lines.some((l) => l.includes("검수 필요(NEEDS_REVIEW) 수: 2")));
    checkTrue("옵션 미확인으로 REVIEW 강제된 수: 2", lines.some((l) => l.includes("옵션(마운트/색상 등) 미확인으로 REVIEW 강제된 수: 2")));
    check("검색 결과 없음 count reflects the 1 ok_empty item", tally("검색 결과 없음"), 1);
    check("호출 실패 count reflects 429 + 500 (2 items)", tally("호출 실패"), 2);
    check("예산 소진으로 스킵된 수 is 0 (never needed - exactly 10 items for 10 budget)", tally("예산 소진"), 0);
  });

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
