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

// --- Public-display policy (src/domain/publicDisplay.ts) ---
// The page renders server-side from Supabase, so it can't be mounted here;
// these source-text guards pin the wiring, and the filtering/JSON-LD logic
// itself is behavior-tested in app/(site)/lib/productPublicView.test.ts.
const listByVariantCalls = source.match(/sourceListings\.listByVariant\(/g) ?? [];
check("exactly one listings read in the page", listByVariantCalls.length, 1);
const gateStart = source.indexOf("const getPublicPageData = cache(");
const gateEnd = source.indexOf("});", gateStart);
const gateBody = gateStart >= 0 ? source.slice(gateStart, gateEnd) : "";
check("that read lives inside getPublicPageData", gateBody.includes("sourceListings.listByVariant("), true);
check("getPublicPageData filters via preparePublicListings + env policy", gateBody.includes("preparePublicListings(rawListings, sources, publicDisplayPolicyFromEnv())"), true);
check("getPublicPageData never returns raw listings", /return \{[^}]*rawListings/.test(gateBody), false);
check("rawListings is not referenced outside the gate", source.split("rawListings").length - 1, (gateBody.split("rawListings").length - 1));
check("page body reads listings from the gate", source.includes("const { listings, withheldRegions, sources } = await getPublicPageData(variantId);"), true);
check("metadata reads listings from the gate", source.includes("const { listings } = await getPublicPageData(variantId);"), true);
check("metadata description is conditional on a public price", source.includes("description: hasPublicPrice"), true);
check("variant image passes through withPublicImage", source.includes("withPublicImage(rawVariant, publicDisplayPolicyFromEnv())"), true);
check("JSON-LD offers built by buildJsonLdOffers", source.includes("buildJsonLdOffers("), true);
check("no inline JSON-LD Offer construction left in the page", source.includes('"@type": "Offer"'), false);
check("withheld markets get a neutral empty-state row", source.includes("현재 표시할 수 있는 ${REGION_KO[region]} 가격 정보가 없어요"), true);
check("no client-side hiding of prices (no 'hidden' / display:none on price rows)", /prow[^\n]*(hidden|display:\s*none)/.test(source), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
