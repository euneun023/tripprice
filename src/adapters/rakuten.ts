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
