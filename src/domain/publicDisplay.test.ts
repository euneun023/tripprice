/**
 * Tests for the public-display policy (default deny, explicit allowlist,
 * no wildcard, image provenance). No test runner is configured in this repo
 * (same plain-assertion convention as src/services/comparisonService.test.ts)
 * - run directly:
 *   npx tsx src/domain/publicDisplay.test.ts
 * Exits non-zero on any failure.
 */
import {
  PUBLIC_PRICE_SOURCES_ENV,
  parsePublicPriceSources,
  publicDisplayPolicyFromEnv,
  isSourcePublic,
  filterPublicListings,
  publicImageUrl,
  withPublicImage,
} from "./publicDisplay";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const ids = (raw: string | undefined | null) => [...parsePublicPriceSources(raw).allowedSourceIds].sort();

// --- default deny ---
check("env var name is PUBLIC_PRICE_SOURCES", PUBLIC_PRICE_SOURCES_ENV, "PUBLIC_PRICE_SOURCES");
check("undefined -> nothing allowed", ids(undefined), []);
check("null -> nothing allowed", ids(null), []);
check("empty string -> nothing allowed", ids(""), []);
check("whitespace/commas only -> nothing allowed", ids(" , ,, "), []);
check("missing env var -> nothing allowed", [...publicDisplayPolicyFromEnv({}).allowedSourceIds], []);
check("missing env -> rakuten not public", isSourcePublic(publicDisplayPolicyFromEnv({}), "rakuten"), false);
check("missing env -> coupang not public either (no implicit allow)", isSourcePublic(publicDisplayPolicyFromEnv({}), "coupang"), false);

// --- no wildcard / malformed tokens ---
check("'*' is not a wildcard", ids("*"), []);
check("'all' is not a wildcard", ids("all"), []);
check("'true' is not a wildcard", ids("true"), []);
check("malformed tokens are dropped, valid ones kept", ids("coupang, rak uten, <x>, ../etc"), ["coupang"]);

// --- explicit allowlist ---
check("single source", ids("coupang"), ["coupang"]);
check("trim + lowercase + dedupe", ids(" Coupang ,COUPANG, rakuten "), ["coupang", "rakuten"]);
const coupangOnly = publicDisplayPolicyFromEnv({ PUBLIC_PRICE_SOURCES: "coupang" });
check("coupang-only: coupang public", isSourcePublic(coupangOnly, "coupang"), true);
check("coupang-only: rakuten NOT public", isSourcePublic(coupangOnly, "rakuten"), false);
check("coupang-only: unknown source NOT public", isSourcePublic(coupangOnly, "11st"), false);

// --- listing filter ---
const listings = [
  { id: "a", sourceId: "coupang" },
  { id: "b", sourceId: "rakuten" },
  { id: "c", sourceId: "manual-kr" },
];
check("filter keeps only allowed sources", filterPublicListings(listings, coupangOnly).map((l) => l.id), ["a"]);
check("filter with default policy keeps nothing", filterPublicListings(listings, parsePublicPriceSources(undefined)).map((l) => l.id), []);
check("filter does not mutate input", listings.length, 3);

// --- images ---
const rakutenImg = "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/x.jpg?_ex=500x500";
const coupangImg = "https://ads-partners.coupang.com/image1/abc.jpg";
const unknownImg = "https://example.com/x.jpg";
check("rakuten image withheld under coupang-only", publicImageUrl(rakutenImg, coupangOnly), null);
check("coupang image kept under coupang-only", publicImageUrl(coupangImg, coupangOnly), coupangImg);
check("unknown-host image withheld (no known provenance)", publicImageUrl(unknownImg, coupangOnly), null);
check("look-alike host is not a subdomain match", publicImageUrl("https://evilrakuten.co.jp/x.jpg", parsePublicPriceSources("rakuten")), null);
check("rakuten image kept when rakuten explicitly allowed", publicImageUrl(rakutenImg, parsePublicPriceSources("rakuten")), rakutenImg);
check("any image withheld under default policy", publicImageUrl(coupangImg, parsePublicPriceSources(undefined)), null);
check("non-http image withheld", publicImageUrl("javascript:alert(1)", parsePublicPriceSources("coupang")), null);
check("null image stays null", publicImageUrl(null, coupangOnly), null);
const variant = { id: "v1", imageUrl: rakutenImg };
check("withPublicImage nulls a non-public image", withPublicImage(variant, coupangOnly).imageUrl, null);
check("withPublicImage does not mutate input", variant.imageUrl, rakutenImg);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
