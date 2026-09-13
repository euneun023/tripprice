/**
 * Static source-text check: the public product page's price-check "확인"
 * timestamp must read from lastSuccessAt (last successful price fetch), not
 * lastCheckedAt (last attempt, which can be stale price + fresh timestamp on
 * a NOT_FOUND soft failure). No test runner is configured in this repo (see
 * web/app/admin/lib/priceGrade.test.ts for the existing plain-assertion
 * convention this follows) - run directly:
 *   npx tsx "web/app/(site)/products/[id]/page.static.test.ts"
 * Exits non-zero on any failure.
 */
import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const source = readFileSync(join(__dirname, "page.tsx"), "utf-8");

check("price-check timestamp reads lastSuccessAt", source.includes("formatCheckedDateTime(l.lastSuccessAt)"), true);
check("price-check timestamp no longer reads lastCheckedAt", source.includes("formatCheckedDateTime(l.lastCheckedAt)"), false);

// Shipping cost handling, 2nd pass: Rakuten rows must use the
// Rakuten-specific label set (never the generic Coupang-style
// SHIPPING_STATUS_LABEL) and always pair it with the international-shipping
// caveat - see web/app/lib/format.ts for why these are separate constants.
check("page branches on listing.sourceId === \"rakuten\" for shipping labeling", (source.match(/listing\.sourceId === "rakuten"/g) ?? []).length >= 2, true);
check("page imports RAKUTEN_SHIPPING_STATUS_LABEL", source.includes("RAKUTEN_SHIPPING_STATUS_LABEL"), true);
check("page imports RAKUTEN_INTERNATIONAL_SHIPPING_NOTE", source.includes("RAKUTEN_INTERNATIONAL_SHIPPING_NOTE"), true);
check("page never shows a bare Coupang-style included/separate label for a Rakuten row without the note alongside it", source.includes("RAKUTEN_SHIPPING_STATUS_LABEL[listing.shippingStatus] ?? RAKUTEN_SHIPPING_STATUS_LABEL.unknown}"), true);

// Comparison-level caveat: a Rakuten leg must always count as shipping-unconfirmed,
// never trusted even when its own shippingStatus says "included".
check("comparison-level shipping caveat treats a rakuten leg as always unconfirmed", source.includes('if (listing.sourceId === "rakuten") return true;'), true);

// Disclaimer text update.
check("disclaimer mentions international shipping being separate", source.includes("해외 배송비가 별도로 부과될 수 있으며"), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
