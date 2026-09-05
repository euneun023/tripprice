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

export async function searchCoupangProduct(
  credentials: CoupangCredentials,
  keyword: string,
  limit = 10,
): Promise<CoupangSearchResult> {
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

  const parsed = body as CoupangSearchResponse;
  return {
    requestUrl: BASE_URL + pathWithQuery,
    status: res.status,
    rateLimitHeaders,
    rawResponse: body,
    items: parsed.data?.productData ?? [],
  };
}
