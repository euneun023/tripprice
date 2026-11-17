/**
 * Regression test for the card price line: a JPY offer price must render
 * as "¥215,000", never "JP 215,000원" (it used to go through formatKrw(),
 * which appends 원 to any number). Renders the real PricesLine component to
 * static HTML - no Next runtime, no network. No test runner is configured in
 * this repo - run directly from web/ (for the @core path alias):
 *   cd web && npx tsx "app/(site)/components/ProductCardGrid.test.tsx"
 * Exits non-zero on any failure.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { PricesLine } from "./ProductCardGrid";
import type { MarketQuote, Offer } from "@core/services/marketQuoteService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function quote(region: "KR" | "JP", price: number, currency: string): MarketQuote {
  const offer: Offer = {
    sourceListingId: `${region}-1`,
    sourceId: region === "KR" ? "coupang" : "rakuten",
    region,
    price,
    currency,
    availability: true,
    reviewRequired: false,
    confidence: "verified",
    shippingStatus: "unknown",
    sourceUrl: null,
  };
  return {
    marketKey: region,
    eligibleOffers: [offer],
    excludedOffersWithReasons: [],
    representativeOffer: offer,
    offerCount: 1,
    hasDuplicate: false,
    allVerified: true,
    status: "single",
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, "");

const both = text(renderToStaticMarkup(<PricesLine kr={quote("KR", 1_234_000, "KRW")} jp={quote("JP", 215_000, "JPY")} />));
check("JPY amount never rendered with 원", both.includes("215,000원"), false);
check("compact line shows JP ¥215,000", both.includes("JP ¥215,000"), true);
check("compact line shows KR 1,234,000원", both.includes("KR 1,234,000원"), true);
check("JPY amount has no 원 anywhere after it", /215,000\s*원/.test(both), false);
check("stacked (mobile) line shows ¥215,000 too", (both.match(/¥215,000/g) ?? []).length, 2);
check("stacked (mobile) line still labels FX applied", both.includes("환율 적용"), true);
check("KRW amount never rendered with ¥", both.includes("¥1,234,000"), false);

const jpOnly = text(renderToStaticMarkup(<PricesLine jp={quote("JP", 103_400, "JPY")} />));
check("JP-only: ¥103,400 shown", jpOnly.includes("JP ¥103,400"), true);
check("JP-only: no 원 at all", jpOnly.includes("원"), false);

const none = renderToStaticMarkup(<PricesLine />);
check("no quotes -> renders nothing", none, "");

// Static guard: no raw offer price may go through formatKrw() in this file.
const source = readFileSync(join(__dirname, "ProductCardGrid.tsx"), "utf-8");
check("no formatKrw(jpOffer...) in source", /formatKrw\(\s*jpOffer/.test(source), false);
check("no formatKrw(krOffer...) in source", /formatKrw\(\s*krOffer/.test(source), false);
check("no hardcoded ¥ prefix in source", source.includes("¥{"), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
