/**
 * Generic Rakuten Ichiba Item Search API client.
 * Category-agnostic: caller supplies keyword/itemCode/shopCode, nothing here
 * is diving-specific. Reused for beauty/fashion/electronics/etc later.
 *
 * Docs: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
 */
import type { ShippingStatus } from "../domain/types";

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
  /**
   * 0 = 送料込み(the SELLER's own listing includes their postage), 1 = 送料別
   * (seller charges postage separately), per Rakuten docs - optional because
   * not every historical/edge-case response is confirmed to carry it.
   *
   * IMPORTANT - what this field does NOT mean: this describes ONLY the
   * seller's own JP-domestic postage display. It says nothing about whether
   * or how much it costs to ship the item internationally to a Korean buyer
   * - Rakuten's Item Search API has no field for that at all. postageFlag=0
   * must NEVER be read as "총 배송비가 한국까지 포함됨"("total shipping,
   * including to Korea, is included") - see deriveRakutenShippingStatus()'s
   * own doc comment, and candidateEvaluationService.ts's shipping gate,
   * which deliberately never lets this value alone unblock an ADD decision.
   */
  postageFlag?: number;
  /**
   * Whether the seller ships overseas at all (1 = yes, 0 = no), and to which
   * areas, per Rakuten docs - straight passthrough, same convention as
   * mediumImageUrls/smallImageUrls above. Preserved end-to-end into
   * SafeRakutenResult for a human reviewer's benefit; deliberately NOT used
   * to derive ShippingStatus or feed any evaluator scoring/gating - "ships
   * overseas" is not the same claim as "this listing's shown price already
   * covers Korea-bound shipping", and inferring the latter from the former
   * would be exactly the kind of guess this feature exists to avoid.
   */
  shipOverseasFlag?: number;
  /** Free-text overseas shipping area description, per Rakuten docs - same passthrough/no-inference policy as shipOverseasFlag above. */
  shipOverseasArea?: string;
}

/**
 * Derives ONLY the seller's own JP-domestic postage display - included
 * (송료 포함) or separate (송료 별도) - never a shipping amount, and never a
 * signal about the cost of shipping to Korea (see RakutenItem.postageFlag's
 * own doc comment for why "included" here must not be read that way). Any
 * value other than the two documented ones (0/1), including the field being
 * entirely absent, becomes "unknown" rather than assumed either way.
 */
export function deriveRakutenShippingStatus(postageFlag: number | undefined): ShippingStatus {
  if (postageFlag === 0) return "included";
  if (postageFlag === 1) return "separate";
  return "unknown";
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
 * defined, so both callers 400-fallback identically. Rakuten's Ichiba Item
 * Search API rejects (400) keywords containing certain lone 1-character
 * tokens - not just bare letters (e.g. the "V" in "Sony α7 V"), as originally
 * found: the earbuds candidate-search batch (2026-09-12, 12/20 candidates)
 * showed a standalone 1-digit token ("Jabra Elite 10 Gen 2") or a standalone
 * "&" ("Bang & Olufsen Beoplay Eleven") 400s the exact same way, disproving
 * this function's original assumption that digits were always safe. Three
 * trigger kinds, each handled differently:
 *
 * - standalone letter (/^[A-Za-z]$/, e.g. "V", "S"): merged into an adjacent
 *   token, in left-to-right order over the already-merged output so far (so
 *   an earlier merge is visible as the "previous" token to a later one):
 *     1. if the previous token contains a digit, append to it - "F2.8 L" ->
 *        "F2.8L" (digit-bearing tokens are aperture/model numbers; fusing an
 *        adjacent letter is the same shape Rakuten already accepts
 *        elsewhere, e.g. naturally-written "R50V").
 *     2. else if there is a next token and it starts with a digit, prepend
 *        to it - "Z 24-70mm" -> "Z24-70mm".
 *     3. else if there is a next token, prepend to it - "S PRO" -> "SPRO".
 *     4. else (last token, previous token has no digit or there is no
 *        previous) - drop it rather than force-merge into the previous
 *        token. A blind "merge into previous" here would fuse two
 *        independently meaningful all-letter words - e.g. "VR S" -> "VRS" -
 *        corrupting the query's meaning (VR = Vibration Reduction). Leaving
 *        it standalone instead doesn't help either: it's still a lone
 *        1-character word, so Rakuten 400s on the fallback exactly like it
 *        did on the raw query - confirmed live against Rakuten's Item
 *        Search API (2026-09-10): "NIKKOR Z 70-200mm f/2.8 VR S" still 400s
 *        if "S" is left standalone, but succeeds with real results once "S"
 *        is dropped. Only case 1 is safe to force-merge, because a
 *        digit-bearing token is already a model/spec fragment, not a
 *        standalone word; a trailing word like "VR" that isn't is better
 *        silently dropped from this search-only fallback keyword than left
 *        to guarantee a repeat 400 - the search is a discovery aid, not the
 *        identity check (that happens later in candidate review), so losing
 *        "VR" from the keyword costs nothing there.
 * - standalone digit (/^[0-9]$/, e.g. the "2" in "Jabra Elite 10 Gen 2" -
 *   multi-digit tokens like "10" are untouched, only a LONE digit character
 *   triggers this): always appended to the previous token - "Gen 2" ->
 *   "Gen2" - or, with no previous token, prepended to the next one. Unlike
 *   the letter case there is no "drop" ambiguity to worry about: a bare
 *   digit carries no independent word meaning to corrupt by fusing it onto
 *   its neighbor (contrast "VR"/"S" above, which are each a real word).
 * - standalone "&" (literal token, e.g. in "Bang & Olufsen"): dropped
 *   entirely, never merged into a neighbor - fusing it either side would
 *   produce a nonsense token ("Bang&" / "&Olufsen") instead of just
 *   removing the connector word, which is what actually fixes the query
 *   ("Bang & Olufsen Beoplay Eleven" -> "Bang Olufsen Beoplay Eleven").
 *
 * Returns null when the keyword has no standalone trigger token, or when the
 * transform (merges and drops together) leaves the string identical to the
 * original - i.e. there is nothing to retry with.
 */
export function buildRakutenFallbackKeyword(keyword: string): string | null {
  const isStandaloneLetter = (token: string) => /^[A-Za-z]$/.test(token);
  const isStandaloneDigit = (token: string) => /^[0-9]$/.test(token);
  const isStandaloneAmpersand = (token: string) => token === "&";
  const hasDigit = (token: string) => /\d/.test(token);

  const tokens = keyword.split(" ");
  if (!tokens.some((t) => isStandaloneLetter(t) || isStandaloneDigit(t) || isStandaloneAmpersand(t))) return null;

  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (isStandaloneAmpersand(token)) {
      continue; // drop entirely - see the "&" case above
    }

    if (isStandaloneDigit(token)) {
      const prevIndex = merged.length - 1;
      const next = tokens[i + 1];
      if (prevIndex >= 0) {
        merged[prevIndex] = merged[prevIndex] + token;
      } else if (next !== undefined) {
        merged.push(token + next);
        i++; // next has been fused into this entry - don't push it again
      }
      // else: single-token keyword, nothing to merge into - drop
      continue;
    }

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
