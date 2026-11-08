/**
 * 11st Open API (openapi.11st.co.kr) ProductSearch client.
 *
 * Confirmed from a real ProductSearch call (not guessed): HTTP 200, body
 * is EUC-KR-encoded XML, CDATA-wrapped ProductName/DetailPageUrl, and a
 * <Product> block carrying ProductCode/ProductName/ProductPrice/SalePrice/
 * Seller/SellerNick/DetailPageUrl. 11st's own result/error-code envelope
 * shape is still NOT confirmed (the 11st developer portal sits behind a
 * login) - see `resultCode`/`resultMessage` below, which stay best-effort
 * until a real error/non-zero-result response is seen.
 *
 * SECURITY: 11st echoes the request (key included) back inside its own
 * response body - confirmed live, it is not just a theoretical query-
 * string leak. Every string this module returns, throws, or could end up
 * logged by a caller MUST go through `redactSecret()` first. Do not add a
 * new return/throw path without it.
 */
import { XMLParser } from "fast-xml-parser";

const BASE_URL = "https://openapi.11st.co.kr/openapi/OpenApiService.tmall";
const PRODUCT_SEARCH_API_CODE = "ProductSearch";

export interface ElevenstCredentials {
  apiKey: string;
}

export interface ElevenstProduct {
  productCode?: string;
  productName?: string;
  productPrice?: string;
  salePrice?: string;
  seller?: string;
  sellerNick?: string;
  detailPageUrl?: string;
}

export class ElevenstApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Already redacted - safe to log/print as-is. */
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ElevenstApiError";
  }
}

export interface ElevenstSearchResult {
  /** Request URL with the key redacted - safe to log. */
  requestUrlRedacted: string;
  status: number;
  /** Decoded response body with every occurrence of the API key stripped -
   * safe to log/print. Parsing above uses the unredacted text internally;
   * this field is for display only. */
  rawResponseTextRedacted: string;
  /** 11st's own TotalCount for the search, if present - distinct from
   * `products.length`, which is only how many came back on this page. */
  totalCount?: number;
  resultCode?: string;
  resultMessage?: string;
  products: ElevenstProduct[];
}

/**
 * Strips every literal occurrence of the API key from arbitrary text.
 * Required because 11st echoes the key back inside the response body
 * itself (confirmed live, inside what looks like a Request/Arguments
 * echo) - redacting only the outgoing request URL is not enough.
 */
function redactSecret(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>");
}

function buildRequestUrl(apiKey: string, keyword: string, pageSize: number): string {
  const query = new URLSearchParams({
    key: apiKey,
    apiCode: PRODUCT_SEARCH_API_CODE,
    keyword,
    pageNum: "1",
    pageSize: String(pageSize),
  }).toString();
  return `${BASE_URL}?${query}`;
}

const DEFAULT_CHARSET = "euc-kr";

function detectCharset(contentTypeHeader: string | null): string {
  const match = contentTypeHeader?.match(/charset=([^;]+)/i);
  const raw = match?.[1]?.trim().toLowerCase();
  if (!raw) return DEFAULT_CHARSET;
  // ks_c_5601 / ksc5601 are the same Korean charset family as euc-kr and
  // Node's TextDecoder only recognizes the euc-kr spelling.
  if (raw === "ks_c_5601-1987" || raw === "ksc5601" || raw === "ks_c_5601") return "euc-kr";
  return raw;
}

function decodeBody(buf: ArrayBuffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    // Unknown/unsupported charset label - fall back rather than throw, so
    // a single unexpected Content-Type never turns into a hard crash.
    return new TextDecoder("utf-8").decode(buf);
  }
}

/** Recursively collects every object found under a tag of this name
 * (case-sensitive, matching 11st's own casing), regardless of nesting
 * depth - deliberately not hardcoded to one exact path since 11st's full
 * envelope shape isn't confirmed. */
function findNodesByTag(node: unknown, tagName: string, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node === null || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const item of node) findNodesByTag(item, tagName, acc);
    return acc;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === tagName) {
      if (Array.isArray(value)) acc.push(...(value as Record<string, unknown>[]));
      else if (value !== null && typeof value === "object") acc.push(value as Record<string, unknown>);
    } else {
      findNodesByTag(value, tagName, acc);
    }
  }
  return acc;
}

/** Same search as findNodesByTag, but for a single text/number leaf value
 * rather than an object - used for TotalCount and the result-code probe. */
function findFirstLeafByTags(node: unknown, tagNames: string[]): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstLeafByTags(item, tagNames);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (tagNames.includes(key) && (typeof value === "string" || typeof value === "number")) {
      return String(value);
    }
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findFirstLeafByTags(value, tagNames);
    if (found !== undefined) return found;
  }
  return undefined;
}

function toElevenstProduct(node: Record<string, unknown>): ElevenstProduct {
  const text = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
  return {
    productCode: text(node.ProductCode),
    productName: text(node.ProductName),
    productPrice: text(node.ProductPrice),
    salePrice: text(node.SalePrice),
    seller: text(node.Seller),
    sellerNick: text(node.SellerNick),
    detailPageUrl: text(node.DetailPageUrl),
  };
}

/** Candidate tag names for 11st's own result/error envelope - shape not
 * confirmed from an official spec, so kept narrow and reported as data for
 * a human to read rather than used to auto-classify success/failure. */
const RESULT_CODE_KEYS = ["resultCode", "ResultCode", "Code", "code", "ErrorCode"];
const RESULT_MESSAGE_KEYS = ["resultMsg", "ResultMsg", "Message", "message", "ErrorMessage"];
const TOTAL_COUNT_KEYS = ["TotalCount", "totalCount"];

export function parseElevenstResponse(xmlText: string): {
  totalCount?: number;
  resultCode?: string;
  resultMessage?: string;
  products: ElevenstProduct[];
} {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false });
  const parsed = parser.parse(xmlText);

  const productNodes = findNodesByTag(parsed, "Product");
  const totalCountRaw = findFirstLeafByTags(parsed, TOTAL_COUNT_KEYS);

  return {
    totalCount: totalCountRaw !== undefined ? Number(totalCountRaw) : undefined,
    resultCode: findFirstLeafByTags(parsed, RESULT_CODE_KEYS),
    resultMessage: findFirstLeafByTags(parsed, RESULT_MESSAGE_KEYS),
    products: productNodes.map(toElevenstProduct),
  };
}

export async function searchElevenstProduct(
  credentials: ElevenstCredentials,
  keyword: string,
  pageSize = 1,
): Promise<ElevenstSearchResult> {
  const requestUrl = buildRequestUrl(credentials.apiKey, keyword, pageSize);

  let res: Response;
  try {
    res = await fetch(requestUrl, { method: "GET" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ElevenstApiError(
      `11st fetch transport failure: ${redactSecret(message, credentials.apiKey)}`,
      0,
      null,
    );
  }

  const buf = await res.arrayBuffer();
  const charset = detectCharset(res.headers.get("content-type"));
  const text = decodeBody(buf, charset);
  const redactedText = redactSecret(text, credentials.apiKey);

  if (!res.ok) {
    throw new ElevenstApiError(`11st API responded HTTP ${res.status}`, res.status, redactedText);
  }

  const parsed = parseElevenstResponse(text);

  return {
    requestUrlRedacted: redactSecret(requestUrl, credentials.apiKey),
    status: res.status,
    rawResponseTextRedacted: redactedText,
    totalCount: parsed.totalCount,
    resultCode: parsed.resultCode,
    resultMessage: parsed.resultMessage,
    products: parsed.products,
  };
}
