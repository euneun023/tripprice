/**
 * Coupang Partners (affiliate) Open API client. NOT the WING seller API
 * (developers.coupang.com) - this hits api-gateway.coupang.com's
 * affiliate_open_api surface, for publishers searching OTHER sellers'
 * products.
 *
 * Endpoint/signature spec is not from Coupang's official docs (those sit
 * behind a partner login we don't have programmatic access to) - it's
 * reverse-engineered from a real, runnable open-source SDK
 * (github.com/mooooburg-dev/coupang-partners-sdk-standalone). Confirmed or
 * refuted by the live call this script makes, not assumed.
 */
import crypto from "node:crypto";
import type { ShippingStatus } from "../domain/types";

const BASE_URL = "https://api-gateway.coupang.com";
const SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search";

export interface CoupangCredentials {
  accessKey: string;
  secretKey: string;
}

export interface CoupangProduct {
  keyword: string;
  rank: number;
  isRocket: boolean;
  isFreeShipping: boolean;
  productId: number;
  productImage: string;
  productName: string;
  productPrice: number;
  productUrl: string;
}

/**
 * Coupang's isFreeShipping is a boolean, never an amount - the Partners
 * Open API has no shipping-fee-in-currency field at all. `undefined` (the
 * field missing from a response) becomes "unknown", never assumed free.
 */
export function deriveCoupangShippingStatus(isFreeShipping: boolean | undefined): ShippingStatus {
  if (isFreeShipping === true) return "included";
  if (isFreeShipping === false) return "separate";
  return "unknown";
}

export interface CoupangSearchResponse {
  rCode: string;
  rMessage: string;
  data?: {
    landingUrl: string;
    productData: CoupangProduct[];
  };
}

export class CoupangApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "CoupangApiError";
  }
}

function generateAuthHeader(
  credentials: CoupangCredentials,
  method: string,
  pathWithQuery: string,
): string {
  const now = new Date();
  const yy = now.getUTCFullYear().toString().slice(-2);
  const MM = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const datetime = `${yy}${MM}${dd}T${hh}${mm}${ss}Z`;

  const [path, query = ""] = pathWithQuery.split("?");
  const message = datetime + method.toUpperCase() + path + query;

  const signature = crypto
    .createHmac("sha256", credentials.secretKey)
    .update(message)
    .digest("hex");

  return `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export interface CoupangSearchResult {
  requestUrl: string;
  status: number;
  rateLimitHeaders: Record<string, string>;
  rawResponse: unknown;
  items: CoupangProduct[];
}

/**
 * D18O: the affiliate_open_api products/search endpoint's documented max is
 * 10 (confirmed externally - this repo has no official spec access, see the
 * file header). D18L briefly widened the refresh call to limit=20 to fight
 * false NOT_FOUNDs; that silently violated this cap and the Coupang API
 * responded with a non-"0" rCode + empty productData for every call rather
 * than an HTTP error, which this adapter at the time did not check for -
 * every refresh call looked like a real "0 results found" instead of a
 * rejected request. Enforced here, once, so no caller (refresh, candidate
 * search, CLI, scripts) can repeat that mistake even by accident.
 */
export const COUPANG_MAX_SEARCH_LIMIT = 10;

/** Success rCode per the Coupang Partners response envelope (confirmed
 * externally, not from an official doc this repo has access to - see file
 * header). Any other rCode is a semantic API error, not "zero results". */
const COUPANG_SUCCESS_RCODE = "0";

export async function searchCoupangProduct(
  credentials: CoupangCredentials,
  keyword: string,
  limit = 10,
): Promise<CoupangSearchResult> {
  if (limit > COUPANG_MAX_SEARCH_LIMIT) {
    // Caller/programmer error, not a seller-API failure - thrown before any
    // request is built, so it is never mistaken for a seller-side problem
    // (same convention as the bad-credentials case below: not a
    // CoupangApiError, so callers that only catch CoupangApiError still see
    // this loudly instead of it being silently swallowed or truncated).
    throw new Error(
      `searchCoupangProduct: limit=${limit} exceeds Coupang's documented max of ${COUPANG_MAX_SEARCH_LIMIT} (see COUPANG_MAX_SEARCH_LIMIT - widening this previously caused the D18L production NOT_FOUND regression)`,
    );
  }

  const query = new URLSearchParams({
    keyword,
    limit: String(limit),
    // 600x600 confirmed live: the API resizes correctly up to this size
    // (an oversized request degrades to the API's own default rather than
    // erroring), well above the 230x230 this used to request.
    imageSize: "600x600",
  }).toString();
  const pathWithQuery = `${SEARCH_PATH}?${query}`;
  const authHeader = generateAuthHeader(credentials, "GET", pathWithQuery);

  let res: Response;
  try {
    res = await fetch(BASE_URL + pathWithQuery, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    // Network/transport failure (DNS, connection refused, TLS, etc.) -
    // Node/undici throws a generic TypeError here with no HTTP status of
    // its own. Normalized into the same CoupangApiError shape as a real
    // non-2xx response (status 0 = "no HTTP response received") so callers
    // have exactly one error class to recognize a seller-reachability
    // failure by, instead of also needing to catch a bare TypeError -
    // narrowly scoped to this fetch() call only, so a bug anywhere else in
    // this function (e.g. generateAuthHeader() above) is NOT caught here
    // and keeps its own error type.
    throw new CoupangApiError(
      `Coupang fetch transport failure: ${err instanceof Error ? err.message : String(err)}`,
      0,
      err,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  const rateLimitHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (/rate|limit|remain|retry/i.test(key)) rateLimitHeaders[key] = value;
  });

  if (!res.ok) {
    throw new CoupangApiError(
      `Coupang API responded ${res.status}`,
      res.status,
      body,
    );
  }

  // D18O: HTTP 200 is not enough - Coupang's own envelope carries its real
  // success/error signal in rCode/rMessage (e.g. a rejected limit param
  // comes back as HTTP 200 with a non-"0" rCode and empty productData).
  // Treating that as "0 results found" is exactly how the D18L regression
  // was misread as NOT_FOUND for every listing instead of an API failure -
  // so any non-success rCode, or a response missing rCode entirely
  // (malformed/unexpected shape), is raised as a CoupangApiError and must
  // never reach the "empty productData" return below. message/body never
  // include credentials - rMessage is Coupang's own non-secret status text.
  const parsed = body as Partial<CoupangSearchResponse> | null;
  if (typeof parsed !== "object" || parsed === null || typeof parsed.rCode !== "string") {
    throw new CoupangApiError(
      `Coupang API returned a malformed response body (missing rCode)`,
      res.status,
      body,
    );
  }
  if (parsed.rCode !== COUPANG_SUCCESS_RCODE) {
    throw new CoupangApiError(
      `Coupang API returned a non-success rCode=${parsed.rCode}${parsed.rMessage ? `: ${parsed.rMessage}` : ""}`,
      res.status,
      body,
    );
  }

  return {
    requestUrl: BASE_URL + pathWithQuery,
    status: res.status,
    rateLimitHeaders,
    rawResponse: body,
    items: parsed.data?.productData ?? [],
  };
}
