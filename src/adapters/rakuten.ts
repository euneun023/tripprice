/**
 * Generic Rakuten Ichiba Item Search API client.
 * Category-agnostic: caller supplies keyword/itemCode/shopCode, nothing here
 * is diving-specific. Reused for beauty/fashion/electronics/etc later.
 *
 * Docs: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
 */

// Confirmed 2026-08-15 via https://webservice.rakuten.co.jp/documentation/ichiba-item-search
// Base URL moved from app.rakuten.co.jp to openapi.rakuten.co.jp; accessKey is now required
// alongside applicationId.
const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

export interface RakutenSearchParams {
  applicationId: string;
  accessKey: string;
  keyword?: string;
  /** exact item, format "shopCode:itemUrl" (e.g. "garmin:010-02857-02") */
  itemCode?: string;
  shopCode?: string;
  hits?: number;
}

export interface RakutenItem {
  itemName: string;
  itemPrice: number;
  itemUrl: string;
  itemCode: string;
  shopName: string;
  shopCode: string;
  availability: number; // 1 = in stock, 0 = out of stock (per Rakuten docs)
  currencyCode?: string;
  // The raw API response already includes these (confirmed live) - the search
  // function below does a straight passthrough of each Items[] element, so
  // just declaring the fields here is enough; no parsing change needed.
  mediumImageUrls?: string[];
  smallImageUrls?: string[];
}

export interface RakutenSearchResult {
  requestUrl: string;
  rawResponse: unknown;
  items: RakutenItem[];
}

export class RakutenApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "RakutenApiError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The app is registered at 1 QPS (see Rakuten dev console). A tight loop of
 * calls (batch scripts) can trip 429 "Rate limit is exceeded" - retry with
 * backoff instead of failing the whole batch on a timing fluke.
 */
export async function searchRakutenItem(
  params: RakutenSearchParams,
  maxRetries = 3,
): Promise<RakutenSearchResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", params.applicationId);
  url.searchParams.set("accessKey", params.accessKey);
  url.searchParams.set("formatVersion", "2");
  if (params.keyword) url.searchParams.set("keyword", params.keyword);
  if (params.itemCode) url.searchParams.set("itemCode", params.itemCode);
  if (params.shopCode) url.searchParams.set("shopCode", params.shopCode);
  url.searchParams.set("hits", String(params.hits ?? 5));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      // Network/transport failure (DNS, connection refused, TLS, etc.) -
      // Node/undici throws a generic TypeError here with no HTTP status of
      // its own. Normalized into the same RakutenApiError shape as a real
      // non-2xx response (status 0 = "no HTTP response received") so
      // callers have exactly one error class to recognize a
      // seller-reachability failure by, instead of also needing to catch a
      // bare TypeError - narrowly scoped to this fetch() call only, so a
      // bug anywhere else in this function is NOT caught here and keeps its
      // own error type. Not retried (retries above are only for Rakuten's
      // own 429 signal, not transport failures - adding that is out of
      // scope here).
      throw new RakutenApiError(
        `Rakuten fetch transport failure: ${err instanceof Error ? err.message : String(err)}`,
        0,
        err,
      );
    }
    const body = await res.json().catch(() => null);

    if (res.status === 429 && attempt < maxRetries) {
      await sleep(1500 * (attempt + 1));
      continue;
    }

    if (!res.ok) {
      throw new RakutenApiError(
        `Rakuten API responded ${res.status}`,
        res.status,
        body,
      );
    }

    const items = (body as any)?.Items ?? [];
    return {
      requestUrl: url.toString(),
      rawResponse: body,
      items,
    };
  }

  throw new RakutenApiError("Rakuten API rate limit retries exhausted", 429, null);
}

/**
 * Pure keyword normalization shared by candidate search
 * (src/scripts/evaluate-candidates.ts) and production refresh
 * (src/services/refreshService.ts) - the one place this transform is
 * defined, so both callers 400-fallback identically. Merges every
 * standalone single ASCII-letter token (/^[A-Za-z]$/ - e.g. the "V" in
 * "Sony α7 V") into an adjacent token, since Rakuten's Ichiba Item Search
 * API rejects (400) keywords containing a lone 1-character word.
 * Standalone digit tokens ("2", "II" being 2 chars anyway) are left alone -
 * only bare letters trigger Rakuten's 400.
 *
 * For each standalone token, in left-to-right order over the already-merged
 * output so far (so an earlier merge is visible as the "previous" token to a
 * later one):
 *   1. if the previous token contains a digit, append to it - "F2.8 L" ->
 *      "F2.8L" (digit-bearing tokens are aperture/model numbers; fusing an
 *      adjacent letter is the same shape Rakuten already accepts elsewhere,
 *      e.g. naturally-written "R50V").
 *   2. else if there is a next token and it starts with a digit, prepend to
 *      it - "Z 24-70mm" -> "Z24-70mm".
 *   3. else if there is a next token, prepend to it - "S PRO" -> "SPRO".
 *   4. else (last token, previous token has no digit or there is no
 *      previous) - drop it rather than force-merge into the previous
 *      token. A blind "merge into previous" here would fuse two
 *      independently meaningful all-letter words - e.g. "VR S" -> "VRS" -
 *      corrupting the query's meaning (VR = Vibration Reduction). Leaving
 *      it standalone instead doesn't help either: it's still a lone
 *      1-character word, so Rakuten 400s on the fallback exactly like it
 *      did on the raw query - confirmed live against Rakuten's Item Search
 *      API (2026-09-10): "NIKKOR Z 70-200mm f/2.8 VR S" still 400s if "S"
 *      is left standalone, but succeeds with real results once "S" is
 *      dropped. Only case 1 is safe to force-merge, because a digit-bearing
 *      token is already a model/spec fragment, not a standalone word; a
 *      trailing word like "VR" that isn't is better silently dropped from
 *      this search-only fallback keyword than left to guarantee a repeat
 *      400 - the search is a discovery aid, not the identity check (that
 *      happens later in candidate review), so losing "VR" from the
 *      keyword costs nothing there.
 *
 * Returns null when the keyword has no standalone token, or when the
 * transform (merges and drops together) leaves the string identical to the
 * original - i.e. there is nothing to retry with.
 */
export function buildRakutenFallbackKeyword(keyword: string): string | null {
  const isStandaloneLetter = (token: string) => /^[A-Za-z]$/.test(token);
  const hasDigit = (token: string) => /\d/.test(token);

  const tokens = keyword.split(" ");
  if (!tokens.some(isStandaloneLetter)) return null;

  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isStandaloneLetter(token)) {
      merged.push(token);
      continue;
    }
    const prevIndex = merged.length - 1;
    const next = tokens[i + 1];
    if (prevIndex >= 0 && hasDigit(merged[prevIndex])) {
      merged[prevIndex] = merged[prevIndex] + token;
    } else if (next !== undefined) {
      merged.push(token + next);
      i++; // next has been fused into this entry - don't push it again
    }
    // else: last token, previous has no digit (or there is no previous) -
    // drop it (see case 4 above), i.e. push nothing
  }

  const result = merged.join(" ");
  return result === keyword ? null : result;
}
