/**
 * 11st Open API (openapi.11st.co.kr) ProductSearch client - first-ever
 * integration attempt in this repo, no prior code or confirmed response
 * schema to build on. Unlike adapters/coupang.ts and adapters/rakuten.ts,
 * the exact XML field names for product name/code/seller/price/discount
 * price/URL are NOT confirmed from an official spec this repo has access
 * to (the 11st developer portal sits behind a login). This client
 * therefore does NOT assume specific field names: it does a generic,
 * flat-XML leaf extraction (tag -> text) per <Product> so the real field
 * names can be read off the live response instead of guessed. Callers
 * that need firm field names should confirm them against a real response
 * first (see src/scripts/verify-11st.ts), then extend `Elevenst11stProduct`
 * accordingly - deliberately not done here to avoid silently returning
 * wrong/undefined values under plausible-looking field names.
 */

const BASE_URL = "https://openapi.11st.co.kr/openapi/OpenApiService.tmall";
const PRODUCT_SEARCH_API_CODE = "ProductSearch";

export interface ElevenstCredentials {
  apiKey: string;
}

/** Generic tag -> text map for one <Product> block. Leaf-only (no nested
 * elements) by design - see file header. */
export type ElevenstProductFields = Record<string, string>;

export class ElevenstApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Never includes the API key - body/text is 11st's own response. */
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
  rawResponseText: string;
  /** Present when the envelope carries an explicit 11st error/result code
   * (shape unconfirmed - whichever leaf tags look like a code/message are
   * surfaced here; both undefined if none were found). */
  resultCode?: string;
  resultMessage?: string;
  products: ElevenstProductFields[];
}

function redactKey(url: string): string {
  return url.replace(/([?&]key=)[^&]*/i, "$1<redacted>");
}

/** Extracts all flat tag->text pairs within a block of XML text (no nested
 * elements - matches this file's documented scope). */
function extractLeafFields(xmlFragment: string): ElevenstProductFields {
  const fields: ElevenstProductFields = {};
  const re = /<(\w+)>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlFragment)) !== null) {
    fields[m[1]] = m[2];
  }
  return fields;
}

/** Candidate tag names for 11st's own result/error code envelope - not
 * confirmed, kept narrow on purpose so an unrelated numeric field is never
 * mistaken for an error code. */
const RESULT_CODE_KEYS = ["resultCode", "ResultCode", "code", "Code"];
const RESULT_MESSAGE_KEYS = ["resultMsg", "ResultMsg", "message", "Message", "resultMessage"];

export async function searchElevenstProduct(
  credentials: ElevenstCredentials,
  keyword: string,
  pageSize = 1,
): Promise<ElevenstSearchResult> {
  const query = new URLSearchParams({
    key: credentials.apiKey,
    apiCode: PRODUCT_SEARCH_API_CODE,
    keyword,
    pageNum: "1",
    pageSize: String(pageSize),
  }).toString();
  const requestUrl = `${BASE_URL}?${query}`;

  let res: Response;
  try {
    res = await fetch(requestUrl, { method: "GET" });
  } catch (err) {
    throw new ElevenstApiError(
      `11st fetch transport failure: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
    );
  }

  const text = await res.text();

  if (!res.ok) {
    throw new ElevenstApiError(`11st API responded HTTP ${res.status}`, res.status, text);
  }

  const topLevelFields = extractLeafFields(text);
  const resultCode = RESULT_CODE_KEYS.map((k) => topLevelFields[k]).find((v) => v !== undefined);
  const resultMessage = RESULT_MESSAGE_KEYS.map((k) => topLevelFields[k]).find((v) => v !== undefined);

  const productBlocks = text.match(/<Product>[\s\S]*?<\/Product>/g) ?? [];
  const products = productBlocks.map(extractLeafFields);

  return {
    requestUrlRedacted: redactKey(requestUrl),
    status: res.status,
    rawResponseText: text,
    resultCode,
    resultMessage,
    products,
  };
}
