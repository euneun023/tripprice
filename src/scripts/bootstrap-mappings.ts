/**
 * Simulates the "human approves a source listing once" step. Real API
 * calls, real matching engine (same pickItemBySku/pickItemByTerms used in
 * the earlier verify-*.ts scripts) - the only new thing here is that the
 * result gets PERSISTED as an ApprovedSourceMapping instead of just printed.
 * This is run #1. verify-refresh.ts (run #2, executed later/separately)
 * is the actual test: can it re-find these same 4 listings without
 * redoing fuzzy matching?
 */
import "dotenv/config";
import { searchRakutenItem } from "../sources/rakuten";
import { searchCoupangProduct } from "../sources/coupang";
import { pickItemBySku, pickItemByTerms } from "../match";
import { canonicalizeUrl, type ApprovedSourceMapping } from "../types";
import { saveMappings } from "../store";

const applicationId = process.env.applicationId!;
const accessKey = process.env.accessKey!;
const coupangAccessKey = process.env.COUPANG_PARTNERS_ACCESS_KEY!;
const coupangSecretKey = process.env.COUPANG_PARTNERS_SECRET_KEY!;

async function main() {
  const mappings: ApprovedSourceMapping[] = [];
  const now = new Date().toISOString();

  // --- Rakuten #1: Garmin Descent Mk3s (exact SKU match, high confidence) ---
  {
    const keyword = "Garmin Descent Mk3s";
    const result = await searchRakutenItem({ applicationId, accessKey, keyword, hits: 10 });
    const item = pickItemBySku(result.items, "010-02857-02", (i) => i.itemName);
    if (!item) throw new Error("bootstrap failed: Garmin not found on Rakuten");
    mappings.push({
      id: "map-rakuten-garmin",
      productId: "garmin-descent-mk3s-010-02857-02",
      source: "rakuten",
      externalId: item.itemCode,
      searchKeywordUsed: keyword,
      approvedAt: now,
      approvedBy: "poc-human-approval",
      lastCheckedAt: now,
      lastSuccessAt: now,
      staleAfterHours: 24,
      confidence: "verified",
      reviewRequired: false,
      reviewReason: null,
      lastKnownPrice: item.itemPrice,
      lastKnownCurrency: "JPY",
      lastKnownInStock: item.availability === 1,
      lastKnownCanonicalUrl: canonicalizeUrl(item.itemUrl),
    });
    console.log(`[approved] rakuten garmin -> externalId=${item.itemCode} price=¥${item.itemPrice}`);
  }

  // --- Rakuten #2: GULL MANTIS5 (name-term match, no confirmed SKU) ---
  {
    const keyword = "GULL MANTIS5 マスク";
    const result = await searchRakutenItem({ applicationId, accessKey, keyword, hits: 15 });
    const { matched } = pickItemByTerms(result.items, { requiredTerms: ["mantis5"] }, (i) => i.itemName);
    if (!matched) throw new Error("bootstrap failed: GULL MANTIS5 not found on Rakuten");
    mappings.push({
      id: "map-rakuten-gull",
      productId: "gull-mantis5",
      source: "rakuten",
      externalId: matched.itemCode,
      searchKeywordUsed: keyword,
      approvedAt: now,
      approvedBy: "poc-human-approval",
      lastCheckedAt: now,
      lastSuccessAt: now,
      staleAfterHours: 24,
      confidence: "estimated", // no official SKU confirmed, per earlier diving batch findings
      reviewRequired: false,
      reviewReason: null,
      lastKnownPrice: matched.itemPrice,
      lastKnownCurrency: "JPY",
      lastKnownInStock: matched.availability === 1,
      lastKnownCanonicalUrl: canonicalizeUrl(matched.itemUrl),
    });
    console.log(`[approved] rakuten gull -> externalId=${matched.itemCode} price=¥${matched.itemPrice}`);
  }

  // --- Coupang #1: Sony WF-1000XM5 (name-term match + accessory exclusion) ---
  {
    const keyword = "소니 WF-1000XM5";
    const result = await searchCoupangProduct(
      { accessKey: coupangAccessKey, secretKey: coupangSecretKey },
      keyword,
      10,
    );
    const { matched } = pickItemByTerms(
      result.items,
      { requiredTerms: ["WF-1000XM5"], excludeTerms: ["케이스", "커버", "이어팁", "이어피스", "젤리팁", "보호필름", "스트랩", "충전"] },
      (i) => i.productName,
    );
    if (!matched) throw new Error("bootstrap failed: Sony WF-1000XM5 not found on Coupang");
    mappings.push({
      id: "map-coupang-sony",
      productId: "sony-wf-1000xm5",
      source: "coupang",
      externalId: String(matched.productId),
      searchKeywordUsed: keyword,
      approvedAt: now,
      approvedBy: "poc-human-approval",
      lastCheckedAt: now,
      lastSuccessAt: now,
      staleAfterHours: 24,
      confidence: "estimated", // reseller listing title, not an official-store confirmed match
      reviewRequired: false,
      reviewReason: null,
      lastKnownPrice: matched.productPrice,
      lastKnownCurrency: "KRW",
      lastKnownInStock: true,
      lastKnownCanonicalUrl: canonicalizeUrl(matched.productUrl),
    });
    console.log(`[approved] coupang sony -> externalId=${matched.productId} price=₩${matched.productPrice}`);
  }

  // --- Coupang #2: SK-II Facial Treatment Essence 230ml ---
  // (swapped in live: Garmin Descent Mk3s returned zero real matches on
  // Coupang - only screen-protector accessories for other Garmin watches.
  // That's a genuine coverage-gap finding, not a bug - noted in the report,
  // not silently discarded.)
  {
    const keyword = "SK-II 피테라 에센스 230ml";
    const result = await searchCoupangProduct(
      { accessKey: coupangAccessKey, secretKey: coupangSecretKey },
      keyword,
      10,
    );
    const { matched } = pickItemByTerms(
      result.items,
      { requiredTerms: ["230"], excludeTerms: ["미니", "트라이얼", "세트", "리필", "파우치"] },
      (i) => i.productName,
    );
    if (!matched) throw new Error("bootstrap failed: SK-II 230ml not found on Coupang");
    mappings.push({
      id: "map-coupang-skii",
      productId: "skii-facial-treatment-essence-230ml",
      source: "coupang",
      externalId: String(matched.productId),
      searchKeywordUsed: keyword,
      approvedAt: now,
      approvedBy: "poc-human-approval",
      lastCheckedAt: now,
      lastSuccessAt: now,
      staleAfterHours: 24,
      confidence: "estimated",
      reviewRequired: false,
      reviewReason: null,
      lastKnownPrice: matched.productPrice,
      lastKnownCurrency: "KRW",
      lastKnownInStock: true,
      lastKnownCanonicalUrl: canonicalizeUrl(matched.productUrl),
    });
    console.log(`[approved] coupang sk-ii -> externalId=${matched.productId} price=₩${matched.productPrice}`);
  }

  await saveMappings(mappings);
  console.log(`\nSaved ${mappings.length} approved mappings to data/approved-mappings.json`);
}

main().catch((err) => {
  console.error("Bootstrap FAILED:", err);
  process.exit(1);
});
