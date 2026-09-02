/**
 * New-product approval flow (semi-automatic, per Phase 1 principle):
 * search only ever returns candidates. A human (CLI operator, later an
 * admin UI) picks the exact one. This module never auto-confirms a match
 * by name alone - see docs/phase1-design.md §4.
 */
import { searchRakutenItem, type RakutenItem } from "../adapters/rakuten";
import { searchCoupangProduct, type CoupangProduct, type CoupangCredentials } from "../adapters/coupang";
import { convertToKrw } from "../domain/pricing";
import type { Repositories } from "../repository/types";
import type { Confidence, SourceListing } from "../domain/types";
import { isHttpUrl } from "../domain/url";

export interface RakutenCreds {
  applicationId: string;
  accessKey: string;
}

export async function searchRakutenCandidates(keyword: string, creds: RakutenCreds, hits = 15): Promise<RakutenItem[]> {
  const result = await searchRakutenItem({ applicationId: creds.applicationId, accessKey: creds.accessKey, keyword, hits });
  return result.items;
}

export async function searchCoupangCandidates(keyword: string, creds: CoupangCredentials, limit = 10): Promise<CoupangProduct[]> {
  const result = await searchCoupangProduct(creds, keyword, limit);
  return result.items;
}

export interface ApproveListingInput {
  productVariantId: string;
  /** any row id from the `sources` table - not restricted to rakuten/coupang, so manual/test/future sources work without a type change here */
  sourceId: string;
  externalId: string;
  externalIdType: string;
  sourceUrl: string | null;
  searchKeywordUsed: string;
  approvedBy: string;
  confidence: Confidence;
  initialPrice: number;
  initialCurrency: string;
  initialAvailability: boolean;
}

/**
 * Persists a human-approved mapping. This is the ONLY place a source_listing
 * row gets created - there is no code path that creates one from a raw
 * search result without going through this function.
 */
export async function approveListing(
  repos: Pick<Repositories, "sourceListings" | "priceHistory">,
  input: ApproveListingInput,
): Promise<SourceListing> {
  const existing = await repos.sourceListings.findByExternalId(input.sourceId, input.externalId);
  if (existing) {
    throw new Error(
      `externalId ${input.externalId} on source ${input.sourceId} is already mapped to source_listing ${existing.id} - not creating a duplicate.`,
    );
  }

  // sourceUrl ends up in an <a href> and a JSON-LD offer url on the product
  // page - reject anything but http(s) here, at the only place a
  // source_listing gets created, so a javascript:/data: URL can never be
  // stored in the first place.
  if (input.sourceUrl !== null && !isHttpUrl(input.sourceUrl)) {
    throw new Error(`sourceUrl must be an http(s) URL, got: ${input.sourceUrl}`);
  }

  const listing = await repos.sourceListings.create({
    productVariantId: input.productVariantId,
    sourceId: input.sourceId,
    externalId: input.externalId,
    externalIdType: input.externalIdType,
    sourceUrl: input.sourceUrl,
    searchKeywordUsed: input.searchKeywordUsed,
    approvedBy: input.approvedBy,
    confidence: input.confidence,
    initialPrice: input.initialPrice,
    initialCurrency: input.initialCurrency,
    initialAvailability: input.initialAvailability,
  });

  let krwPrice: number | null = null;
  let fxRateUsed: number | null = null;
  try {
    const conv = await convertToKrw(input.initialPrice, input.initialCurrency);
    krwPrice = conv.krwPrice;
    fxRateUsed = conv.fxRateUsed;
  } catch {
    // fx lookup failing shouldn't block the approval itself - krw_price stays null
  }

  await repos.priceHistory.append({
    sourceListingId: listing.id,
    price: input.initialPrice,
    currency: input.initialCurrency,
    krwPrice,
    fxRateUsed,
    availability: input.initialAvailability,
    outcome: "success",
    changeReason: "initial",
  });

  return listing;
}
