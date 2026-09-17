/**
 * Boundary/behavior checks for the Phase 1-A high-confidence negative filter.
 * No test runner is configured in this repo (see src/domain/searchAliases.test.ts
 * for the same plain-assertion convention) - run directly:
 *   npx tsx src/scripts/lib/negativeFilter.test.ts
 * Exits non-zero on any failure. Pure unit tests - no file I/O.
 */
import { classifyListingText } from "./negativeFilter";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

// --- used/condition (universal) ---
check(
  "中古 marks a listing negative regardless of productType",
  classifyListingText("【中古】FUJIFILM X-Pro3 ボディ ブラック", "camera").negative,
  true,
);
check(
  "중고 (Korean) marks a listing negative",
  classifyListingText("중고 스쿠바프로 레귤레이터", "regulator").negative,
  true,
);
check(
  "a genuinely new listing mentioning 신품 is not flagged as used",
  classifyListingText("[新品]Nikon ニコン ミラーレス一眼カメラ Z8 ボディ", "camera").negative,
  false,
);

// --- wrong_category (universal cross-domain noise) ---
check(
  "an ebook listing is wrong_category regardless of productType",
  classifyListingText("Complications in Knee and Shoulder Surgery【電子書籍】", "bcd").reason,
  "wrong_category",
);
check(
  "a real product listing is not wrong_category just because it mentions the brand",
  classifyListingText("SCUBAPRO MK25 Evo / S620Ti レギュレーターセット", "regulator").negative,
  false,
);

// --- accessory guard: keyword self-containing a positive marker must still fire ---
check(
  "camera body case (ボディケース) is accessory even without a Phase 1-B compat marker (self-collision-bypass keyword rule from Phase 1-A)",
  classifyListingText("JJC ボディケース Sony A7C II", "camera"),
  { negative: true, reason: "accessory", matchedKeyword: "ボディケース" },
);
check(
  "a real camera body listing (contains ボディ, no accessory keyword) survives",
  classifyListingText("SONY｜ソニー α1 II ミラーレス一眼カメラ ILCE-1M2 [ボディ単体]", "camera").negative,
  false,
);
check(
  "a lens hood accessory is not flagged for camera_lens (filter/hood bundles are allowed by policy)",
  classifyListingText("Canon RF24-105mm F4L IS USM 用 EW-83N レンズフード", "camera_lens").negative,
  false,
);

// --- dive_computer marker fix regression: コンピュータ (no long vowel) must count as a marker ---
check(
  "dive computer listing using 'ダイブコンピュータ' (no long vowel) is not falsely flagged accessory for mentioning USBケーブル",
  classifyListingText("ダイブコンピュータ SUUNTO EON CORE 充電式バッテリー USBケーブル付 ダイビングコンピューター", "dive_computer").negative,
  false,
);
check(
  "a pure watch-band accessory for a dive computer (no computer word) is flagged accessory",
  classifyListingText("Garmin Descent Mk3i 51mm 交換 バンド シリコン素材 腕時計バンド", "dive_computer"),
  { negative: true, reason: "accessory", matchedKeyword: "交換 バンド" },
);

// --- Phase 1-B: compat-context marker + accessory noun bypasses the guard ---
check(
  "a strap-for-another-fin listing using only bare '用' (excluded marker, too risky) is NOT caught by the compat-context rule - known conservative boundary, not a bug",
  classifyListingText("AQUALUNG アクアラング スプリングフィンストラップ（1本） バックル付 マイスターフィン用 スリングショット", "fins").negative,
  false,
);
check(
  "the same listing IS caught once phrased with a safe marker (交換用) instead of bare 用",
  classifyListingText("AQUALUNG アクアラング 交換用スプリングフィンストラップ（1本） バックル付 マイスターフィン用 スリングショット", "fins"),
  { negative: true, reason: "accessory", matchedKeyword: "交換用+ストラップ" },
);
check(
  "Korean '호환' + strap noun bypasses the guard for dive_computer",
  classifyListingText("순토 D4 D4i D4iNovo 손목밴드 호환 순토스트랩 호환 Suunto시계줄", "dive_computer").negative,
  true,
);
check(
  "a real lens's own mount-compatibility phrasing ('カメラ用') does NOT trigger accessory - bare 用/対応 were deliberately excluded as markers",
  classifyListingText("ソニー FE 24-70mm F2.8 GM II SEL2470GM2 ※Eマウント用レンズ（フルサイズミラーレス対応）", "camera_lens").negative,
  false,
);
check(
  "a real bundled filter (no compat marker, just '+') is not flagged as accessory for camera_lens",
  classifyListingText("[소니 공식대리점] 소니 SEL2470GM2 + 호야렌즈필터 + 포켓융/FE 24-70mm F2.8 GM II 알파 표준 줌렌즈", "camera_lens").negative,
  false,
);
check(
  "English 'for <product>' + 'strap' bypasses the guard",
  classifyListingText("Replacement strap for Garmin Descent Mk3i 51mm watch band", "dive_computer").negative,
  true,
);

// --- unknown productType: no accessory config, only universal rules apply ---
check(
  "unknown productType with no accessory config still catches universal wrong_category/used signals",
  classifyListingText("【中古】some random item", "not_a_real_type").negative,
  true,
);
check(
  "unknown productType with no accessory keyword match and no universal signal survives",
  classifyListingText("완전히 정상적인 상품명입니다", "not_a_real_type").negative,
  false,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
