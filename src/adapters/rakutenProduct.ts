/**
 * Rakuten 商品価格ナビ製品検索API (楽天プロダクト製品検索API, version
 * 2025-08-01) client.
 *
 * WHY THIS EXISTS, and how it differs from adapters/rakuten.ts:
 *   - rakuten.ts hits Ichiba *Item* Search: one row per SELLER LISTING
 *     (itemCode, that shop's price). It has no JAN and no manufacturer
 *     model number.
 *   - this file hits *Product* Search: one row per PRODUCT in 商品価格ナビ,
 *     keyed by Rakuten's own productId, carrying `productNo` (型番 =
 *     manufacturer model number), `makerName`, and searchable BY JAN via
 *     `productCode`.
 *
 * That `productNo` is the point. docs/data-sources-research-2026-11.md §3
 * established that the KR<->JP join key cannot be JAN (neither Coupang
 * Partners nor 11st expose GTIN at all), so it has to be brand + 型番. And
 * scripts/lib/identifierMatch.ts's own header records the blocker: a model
 * code was present for only 70/429 (16.3%) of reviewed candidates, because
 * today those codes are hand-typed into seed files. This API is the
 * mechanical supply of that field.
 *
 * EVIDENCE GRADE - read before trusting any field name here.
 * This repo could not open webservice.rakuten.co.jp during the 2026-11-03
 * research session (the session's network policy refused the host), so
 * every name below comes from search-engine extracts of the official
 * documentation page, NOT from reading the page or from a live response.
 * Treat this module as UNVERIFIED until verify-rakuten-product.ts has been
 * run once against the live API, exactly the way adapters/coupang.ts
 * treats its own externally-sourced spec. Specifically unconfirmed:
 *
 *   1. Whether `productNo` is actually populated in practice, and for what
 *      share of products. The whole KR-matching argument rests on it.
 *   2. A 2026-03-25 Rakuten announcement is reported (single source, a
 *      Tumblr mirror of the official blog - could not be re-confirmed) to
 *      have made several response values come back empty/null on this API:
 *      ProductDetails, rankTargetGenreId, itemCount, usedExcludeCount,
 *      usedExcludeSalesItemCount, minPrice, usedExcludeMinPrice,
 *      usedExcludeSalesMinPrice. The documentation page still lists them.
 *      => Nothing in this module may assume any numeric field is present.
 *         Every one is `number | null`, and summarizeJpOffers() refuses to
 *         invent a seller count when the field is null.
 *
 * Docs: https://webservice.rakuten.co.jp/documentation/ichiba-product-search
 */

/**
 * REST/JSON endpoint for version 2025-08-01. Note the host AND path differ
 * from Ichiba Item Search's (`.../ichibams/api/IchibaItem/Search/20260701`)
 * - this one is under `ichibaproduct`, not `ichibams`. Confirmed only at
 * the same B grade as the rest of this file's header.
 */
export const RAKUTEN_PRODUCT_SEARCH_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibaproduct/api/Product/Search/20250801";

/** Max `hits` per page accepted by the API (documented 1-30, default 30). */
export const RAKUTEN_PRODUCT_MAX_HITS = 30;
/** Max `page` accepted by the API (documented 1-100). */
export const RAKUTEN_PRODUCT_MAX_PAGE = 100;
/**
 * Hard ceiling on what one search key can ever enumerate: 30 x 100. Any
 * plan to acquire "thousands of products" has to be a sweep over MANY
 * keys (genreId by genreId), not deeper paging on one - paging simply
 * stops here. Stated as a constant so a caller can assert against it
 * instead of rediscovering it at page 101.
 */
export const RAKUTEN_PRODUCT_MAX_REACHABLE_PER_KEY =
  RAKUTEN_PRODUCT_MAX_HITS * RAKUTEN_PRODUCT_MAX_PAGE;

/**
 * Exactly one of these four is required by the API. `productCode` (JAN) is
 * documented as not combinable with the other search parameters, and
 * sending two keys is the kind of mistake that comes back as a confusing
 * empty/error response rather than a clear rejection - so this module
 * rejects it locally, before any request is built (same discipline as
 * COUPANG_MAX_SEARCH_LIMIT in adapters/coupang.ts).
 */
export interface RakutenProductSearchParams {
  applicationId: string;
  accessKey: string;
  /** free-text search */
  keyword?: string;
  /** 商品価格ナビ genre - the key to sweep for bulk catalog discovery */
  genreId?: string | number;
  /** Rakuten's own product id */
  productId?: string;
  /** JAN code. Documented as not usable together with the other keys. */
  productCode?: string;
  /** 1..30, API default 30 */
  hits?: number;
  /** 1..100 */
  page?: number;
  /**
   * Documented sort values include "standard", "-releaseDate", "+itemCount"
   * etc. Passed through verbatim and NOT validated here: the 2026-03-25
   * announcement is reported to have deprecated "-releaseDate" and
   * "-seller", and hard-coding a value list this module cannot verify
   * would turn a Rakuten-side change into a local crash.
   */
  sort?: string;
  /** Restrict returned fields (documented `elements` param), e.g. ["productId","productNo"]. */
  elements?: string[];
}

/**
 * One product row. EVERY optional-value field is `| null` rather than
 * optional-and-trusted, because the documentation itself states unavailable
 * values come back as null, and because of the emptied-fields report in the
 * module header. Absent and null are collapsed to null by the parser so
 * callers have one case to handle, not two.
 */
export interface RakutenProduct {
  productId: string | null;
  productName: string | null;
  /** 型番 - manufacturer model number. THE field this adapter exists for. */
  productNo: string | null;
  /** maker/company name, used as the brand side of the KR match key */
  makerName: string | null;
  /** JAN, when the response carries it back */
  productCode: string | null;
  genreId: string | null;
  /** lowest price among purchasable listings */
  salesMinPrice: number | null;
  salesMaxPrice: number | null;
  /** reported emptied as of 2026-03-25 (unconfirmed) - never assume present */
  minPrice: number | null;
  maxPrice: number | null;
  averagePrice: number | null;
  /** reported emptied as of 2026-03-25 (unconfirmed) - never assume present */
  itemCount: number | null;
  /** count of purchasable listings; NOT documented as emptied, but still nullable */
  salesItemCount: number | null;
  productUrlPC: string | null;
  mediumImageUrl: string | null;
}

export interface RakutenProductSearchResult {
  requestUrl: string;
  rawResponse: unknown;
  products: RakutenProduct[];
  /** pagination envelope, each null when the response omitted it */
  count: number | null;
  page: number | null;
  pageCount: number | null;
  hits: number | null;
}

export class RakutenProductApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "RakutenProductApiError";
  }
}

const SEARCH_KEYS = ["keyword", "genreId", "productId", "productCode"] as const;

/**
 * Pure URL builder - separated from the fetch so the whole parameter
 * contract is unit-testable without a network call (this repo has no HTTP
 * mocking layer, and adding one just for this is not worth it).
 *
 * Throws RakutenProductApiError with status 0 ("no HTTP response involved")
 * for caller/programmer errors, so a bad call never reaches Rakuten and
 * never looks like a Rakuten-side failure.
 */
export function buildProductSearchUrl(params: RakutenProductSearchParams): string {
  const present = SEARCH_KEYS.filter((k) => {
    const v = params[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });

  if (present.length === 0) {
    throw new RakutenProductApiError(
      `buildProductSearchUrl: exactly one search key required, got none (one of: ${SEARCH_KEYS.join(", ")})`,
      0,
      null,
    );
  }
  if (present.length > 1) {
    throw new RakutenProductApiError(
      `buildProductSearchUrl: exactly one search key allowed, got ${present.length} (${present.join(" + ")}) - productCode (JAN) in particular is documented as not combinable`,
      0,
      null,
    );
  }

  const hits = params.hits ?? RAKUTEN_PRODUCT_MAX_HITS;
  if (!Number.isInteger(hits) || hits < 1 || hits > RAKUTEN_PRODUCT_MAX_HITS) {
    throw new RakutenProductApiError(
      `buildProductSearchUrl: hits=${hits} out of documented range 1..${RAKUTEN_PRODUCT_MAX_HITS}`,
      0,
      null,
    );
  }

  const page = params.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > RAKUTEN_PRODUCT_MAX_PAGE) {
    throw new RakutenProductApiError(
      `buildProductSearchUrl: page=${page} out of documented range 1..${RAKUTEN_PRODUCT_MAX_PAGE} (a sweep needs more search keys, not more pages - see RAKUTEN_PRODUCT_MAX_REACHABLE_PER_KEY)`,
      0,
      null,
    );
  }

  const url = new URL(RAKUTEN_PRODUCT_SEARCH_ENDPOINT);
  url.searchParams.set("applicationId", params.applicationId);
  url.searchParams.set("accessKey", params.accessKey);
  url.searchParams.set("format", "json");
  // Same flattened array shape adapters/rakuten.ts already relies on.
  url.searchParams.set("formatVersion", "2");
  url.searchParams.set("hits", String(hits));
  url.searchParams.set("page", String(page));

  const key = present[0];
  url.searchParams.set(key, String(params[key]));

  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.elements?.length) url.searchParams.set("elements", params.elements.join(","));

  return url.toString();
}

/** undefined, null, "" and whitespace all collapse to null. Never guesses. */
function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Numeric coercion that refuses to turn "unknown" into a number. "" -> null
 * (the exact shape the reported 2026-03-25 emptying would produce), and a
 * non-finite/unparseable value -> null rather than NaN or 0. A 0 that
 * Rakuten actually sent is preserved as 0, because "zero purchasable
 * listings" is real information and must not be flattened into "unknown".
 */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Pure response parser. Tolerates both formatVersion=2 (`Products` is an
 * array of product objects) and the older nested shape
 * (`Products: [{ Product: {...} }]`), because this module's field knowledge
 * is unverified and getting the envelope wrong would otherwise look like
 * "the API returned nothing".
 */
export function parseProductSearchResponse(body: unknown): Omit<RakutenProductSearchResult, "requestUrl" | "rawResponse"> {
  const root = (body ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(root.Products) ? root.Products : [];

  const products: RakutenProduct[] = rawList.map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    // formatVersion=1 nests each row under a "Product" key; v2 does not.
    const p = (e.Product && typeof e.Product === "object" ? e.Product : e) as Record<string, unknown>;
    return {
      productId: str(p.productId),
      productName: str(p.productName),
      productNo: str(p.productNo),
      makerName: str(p.makerName),
      productCode: str(p.productCode),
      genreId: str(p.genreId),
      salesMinPrice: num(p.salesMinPrice),
      salesMaxPrice: num(p.salesMaxPrice),
      minPrice: num(p.minPrice),
      maxPrice: num(p.maxPrice),
      averagePrice: num(p.averagePrice),
      itemCount: num(p.itemCount),
      salesItemCount: num(p.salesItemCount),
      productUrlPC: str(p.productUrlPC) ?? str(p.productUrl),
      mediumImageUrl: str(p.mediumImageUrl),
    };
  });

  return {
    products,
    count: num(root.count),
    page: num(root.page),
    pageCount: num(root.pageCount),
    hits: num(root.hits),
  };
}

/**
 * The brand+型番 pair this product can contribute to KR<->JP matching, or
 * null when it cannot contribute one. Deliberately strict: a product with
 * no `productNo` is NOT usable as a match key, and this returns null rather
 * than falling back to the product NAME - name-based identity is exactly
 * what docs/phase1-design.md §0 rules out as an automatic decision.
 */
export function extractMatchKey(
  product: RakutenProduct,
): { brand: string; modelNo: string; jan: string | null } | null {
  if (!product.productNo || !product.makerName) return null;
  return { brand: product.makerName, modelNo: product.productNo, jan: product.productCode };
}

/**
 * What this product lets us honestly say about Japanese offers.
 *
 * `sellerCount` is `salesItemCount` and is NOT a seller count in the strict
 * sense - it counts purchasable LISTINGS, and one shop can list the same
 * product more than once. It is surfaced under `purchasableListingCount`
 * with that name on purpose, so no caller can quietly render it as
 * "N곳에서 판매중". When the field is null (the reported emptying, or simply
 * unavailable), this returns null for it instead of 0 or 1 - "unknown" and
 * "one seller" must never collapse, because the whole product promise is
 * comparing multiple sellers.
 */
export function summarizeJpOffers(product: RakutenProduct): {
  minPrice: number | null;
  purchasableListingCount: number | null;
  /** true only when BOTH a price and a listing count are actually known */
  comparable: boolean;
} {
  const minPrice = product.salesMinPrice;
  const purchasableListingCount = product.salesItemCount;
  return {
    minPrice,
    purchasableListingCount,
    comparable: minPrice !== null && purchasableListingCount !== null && purchasableListingCount > 0,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Live call. Same 429-backoff and transport-failure normalization contract
 * as searchRakutenItem() in adapters/rakuten.ts - see that function's
 * comments; the reasoning is identical and deliberately not re-argued here.
 * The documentation warns that many rapid requests to the SAME request URL
 * can get the app temporarily blocked, so callers sweeping genres must pace
 * themselves (Rakuten apps are registered at 1 QPS).
 */
export async function searchRakutenProduct(
  params: RakutenProductSearchParams,
  maxRetries = 3,
): Promise<RakutenProductSearchResult> {
  const requestUrl = buildProductSearchUrl(params);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(requestUrl);
    } catch (err) {
      throw new RakutenProductApiError(
        `Rakuten Product Search fetch transport failure: ${err instanceof Error ? err.message : String(err)}`,
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
      throw new RakutenProductApiError(
        `Rakuten Product Search API responded ${res.status}`,
        res.status,
        body,
      );
    }

    return { requestUrl, rawResponse: body, ...parseProductSearchResponse(body) };
  }

  throw new RakutenProductApiError(
    "Rakuten Product Search API rate limit retries exhausted",
    429,
    null,
  );
}
