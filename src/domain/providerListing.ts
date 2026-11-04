/**
 * Provider-agnostic listing format for multi-source candidate intake.
 *
 * Every data provider (Rakuten, Coupang, a future feed/CSV/affiliate API)
 * is mapped into ProviderListing at the very edge by one small mapper; from
 * there on the matching pipeline (services/listingIntakeService.ts) never
 * sees a provider-specific response shape. This is deliberately NOT a new
 * source-of-truth model: it is a pre-registration staging shape that sits
 * in front of the existing Product/Variant/SourceListing tables (a human
 * approval turns an approved ProviderListing into a SourceListing via the
 * existing approveListing()).
 *
 * Rule for every field: a value the provider did not state is the literal
 * "UNKNOWN" - never a guessed default (e.g. a Coupang item is NOT assumed
 * in stock, a Rakuten item is NOT assumed to have a known manufacturer).
 */
import type { Region } from "./types";
import { isHttpUrl } from "./url";
import { isProductType, type ProductType } from "./searchAliases";

export const UNKNOWN = "UNKNOWN" as const;
export type Unknown = typeof UNKNOWN;
export type OrUnknown<T> = T | Unknown;

export type ListingCondition = "new" | "used" | "refurbished" | Unknown;
export type ListingAvailability = "in_stock" | "out_of_stock" | Unknown;
/** Whether we may store/display this provider's data. Anything not explicitly "granted" is treated as unusable. */
export type UsageRights = "granted" | "denied" | Unknown;

/**
 * What a `price` actually is. Only a "seller_listing" price (one seller's/market's purchasable
 * listing) may be compared across regions. A "product_aggregate" price is a roll-up over many
 * sellers (e.g. Rakuten Product Search salesMinPrice): it is product DISCOVERY data and must
 * never be presented or counted as a seller's purchasable price. UNKNOWN = the provider's
 * granularity was never declared, which is treated as not comparable.
 */
export type PriceBasis = "seller_listing" | "product_aggregate" | Unknown;

export type ListingMount = "sony_e" | "canon_rf" | "nikon_z" | "leica_l";
export type ListingFitting = "din" | "yoke";
export type ListingBundle = "body" | "kit";

export interface ListingAttributes {
  mount: OrUnknown<ListingMount>;
  fitting: OrUnknown<ListingFitting>;
  bundle: OrUnknown<ListingBundle>;
  /** canonical lowercase English colour; UNKNOWN when absent OR when the title names more than one colour */
  color: OrUnknown<string>;
}

export interface ProviderListing {
  provider: string;
  externalId: string;
  externalIdType: string;
  manufacturer: OrUnknown<string>;
  /** manufacturer model number exactly as the provider states it in a structured field (never parsed from the title here) */
  modelNumber: OrUnknown<string>;
  title: string;
  productType: OrUnknown<ProductType>;
  attributes: ListingAttributes;
  condition: ListingCondition;
  price: number | null;
  currency: OrUnknown<string>;
  seller: OrUnknown<string>;
  region: OrUnknown<Region>;
  availability: ListingAvailability;
  /** granularity of `price` - see PriceBasis. Absent on snapshots written before this field existed = UNKNOWN. */
  priceBasis: PriceBasis;
  /** ISO timestamp of when the provider data was read */
  fetchedAt: OrUnknown<string>;
  usageRights: UsageRights;
  sourceUrl: string | null;
}

export const listingKey = (l: Pick<ProviderListing, "provider" | "externalId">): string => `${l.provider}|${l.externalId}`;

// ---------------------------------------------------------------------
// Attribute / condition extraction from free text. These are used ONLY to
// detect conflicts and gaps (a mount/colour/bundle mismatch blocks a match,
// an unstated one forces human review) - never to confirm identity, in line
// with candidateEvaluationService's "never infer mount from title" rule.
// ---------------------------------------------------------------------

function uniqueOrUnknown<T extends string>(found: T[]): OrUnknown<T> {
  const set = new Set(found);
  return set.size === 1 ? [...set][0] : UNKNOWN;
}

const MOUNT_PATTERNS: Array<[ListingMount, RegExp]> = [
  ["sony_e", /(?:sony|ソニー|소니)?\s*\bE[-\s]?mount|\bE\s?マウント|E\s?마운트|\bFE\s?\d|\bSEL\d{4}/i],
  ["canon_rf", /\bRF[-\s]?mount|\bRF\s?マウント|RF\s?마운트|\bRF\s?\d{2}/i],
  ["nikon_z", /NIKKOR\s*Z|\bZ[-\s]?mount|\bZ\s?マウント|Z\s?마운트/i],
  ["leica_l", /\bL[-\s]?mount|\bL\s?マウント|L\s?마운트/i],
];
const COLOR_PATTERNS: Array<[string, RegExp]> = [
  ["black", /\bblack\b|ブラック|블랙|黒/i],
  ["white", /\bwhite\b|ホワイト|화이트|白/i],
  ["silver", /\bsilver\b|シルバー|실버/i],
  ["red", /\bred\b|レッド|레드|赤/i],
  ["blue", /\bblue\b|ブルー|블루|青/i],
  ["gray", /\bgr[ae]y\b|グレー|그레이|그레이/i],
  ["green", /\bgreen\b|グリーン|그린|緑/i],
  ["pink", /\bpink\b|ピンク|핑크/i],
];
const KIT_RE = /キット|セット|\bkit\b|키트|세트|ダブルズーム|with\s+\d+-\d+\s?mm/i;
const BODY_RE = /ボディ単体|ボディのみ|body\s*only|\bBODY\b|바디|本体のみ/i;
const DIN_RE = /\bDIN\b/i;
const YOKE_RE = /\byoke\b|ヨーク|요크|\bINT\b/i;

export function extractAttributes(text: string): ListingAttributes {
  const t = text.normalize("NFKC");
  const bundleFound: ListingBundle[] = [];
  if (KIT_RE.test(t)) bundleFound.push("kit");
  if (BODY_RE.test(t)) bundleFound.push("body");
  const fittingFound: ListingFitting[] = [];
  if (DIN_RE.test(t)) fittingFound.push("din");
  if (YOKE_RE.test(t)) fittingFound.push("yoke");
  return {
    mount: uniqueOrUnknown(MOUNT_PATTERNS.filter(([, re]) => re.test(t)).map(([v]) => v)),
    color: uniqueOrUnknown(COLOR_PATTERNS.filter(([, re]) => re.test(t)).map(([v]) => v)),
    bundle: uniqueOrUnknown(bundleFound),
    fitting: uniqueOrUnknown(fittingFound),
  };
}

export function extractCondition(text: string): ListingCondition {
  const t = text.normalize("NFKC");
  if (/リファービッシュ|리퍼|refurb|renewed|再生品/i.test(t)) return "refurbished";
  if (/中古|중고|\bused\b|訳あり|ジャンク/i.test(t)) return "used";
  return UNKNOWN;
}

// ---------------------------------------------------------------------
// Provider mappers: raw unknown -> ProviderListing | error. Never throws on
// a bad item; a malformed item is reported, not propagated.
// ---------------------------------------------------------------------

export type MapResult = { ok: true; listing: ProviderListing } | { ok: false; error: string };

export interface MapOptions {
  /** defaults to UNKNOWN - rights must be explicitly granted per provider, never assumed */
  usageRights?: UsageRights;
  fetchedAt?: string;
  /** the product type the search was run for, when the caller knows it */
  productType?: ProductType;
  /** defaults to UNKNOWN for generic rows - like usageRights, granularity must be declared per provider, never assumed */
  priceBasis?: PriceBasis;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function build(
  provider: string,
  externalId: string,
  externalIdType: string,
  title: string,
  rest: Partial<Omit<ProviderListing, "provider" | "externalId" | "externalIdType" | "title">>,
  opts: MapOptions,
): ProviderListing {
  const attrs = extractAttributes(title);
  return {
    provider,
    externalId,
    externalIdType,
    title: title.trim(),
    manufacturer: UNKNOWN,
    modelNumber: UNKNOWN,
    productType: opts.productType ?? UNKNOWN,
    attributes: attrs,
    condition: extractCondition(title),
    price: null,
    currency: UNKNOWN,
    seller: UNKNOWN,
    region: UNKNOWN,
    availability: UNKNOWN,
    priceBasis: opts.priceBasis ?? UNKNOWN,
    fetchedAt: opts.fetchedAt ?? UNKNOWN,
    usageRights: opts.usageRights ?? UNKNOWN,
    sourceUrl: null,
    ...rest,
  };
}

function priceOf(v: unknown): number | null | "bad" {
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : "bad";
}

/** RakutenItem (src/adapters/rakuten.ts) -> ProviderListing. Rakuten has no manufacturer/model field and states availability as 1/0. */
export function mapRakutenItem(raw: unknown, opts: MapOptions = {}): MapResult {
  if (!isRecord(raw)) return { ok: false, error: "item is not an object" };
  if (!nonEmptyString(raw.itemCode)) return { ok: false, error: "missing itemCode" };
  if (!nonEmptyString(raw.itemName)) return { ok: false, error: "missing itemName" };
  const price = priceOf(raw.itemPrice);
  if (price === "bad" || price === null) return { ok: false, error: "invalid itemPrice" };
  return {
    ok: true,
    listing: build(
      "rakuten",
      raw.itemCode,
      "rakuten_item_code",
      raw.itemName,
      {
        price,
        currency: "JPY",
        seller: nonEmptyString(raw.shopName) ? raw.shopName : UNKNOWN,
        region: "JP",
        availability: raw.availability === 1 ? "in_stock" : raw.availability === 0 ? "out_of_stock" : UNKNOWN,
        sourceUrl: typeof raw.itemUrl === "string" && isHttpUrl(raw.itemUrl) ? raw.itemUrl : null,
      },
      { ...opts, priceBasis: opts.priceBasis ?? "seller_listing" },
    ),
  };
}

/** CoupangProduct (src/adapters/coupang.ts) -> ProviderListing. The Partners API exposes no stock or seller field: both stay UNKNOWN. */
export function mapCoupangProduct(raw: unknown, opts: MapOptions = {}): MapResult {
  if (!isRecord(raw)) return { ok: false, error: "item is not an object" };
  const id = typeof raw.productId === "number" || nonEmptyString(raw.productId) ? String(raw.productId) : null;
  if (!id) return { ok: false, error: "missing productId" };
  if (!nonEmptyString(raw.productName)) return { ok: false, error: "missing productName" };
  const price = priceOf(raw.productPrice);
  if (price === "bad" || price === null) return { ok: false, error: "invalid productPrice" };
  return {
    ok: true,
    listing: build(
      "coupang",
      id,
      "coupang_product_id",
      raw.productName,
      { price, currency: "KRW", region: "KR", sourceUrl: typeof raw.productUrl === "string" && isHttpUrl(raw.productUrl) ? raw.productUrl : null },
      { ...opts, priceBasis: opts.priceBasis ?? "seller_listing" },
    ),
  };
}

const REGIONS: readonly string[] = ["KR", "JP", "INTL"];

/**
 * Generic feed/CSV/affiliate row. Expected keys: id, title, brand?, model?,
 * price?, currency?, seller?, region?, availability? ("in_stock"|"out_of_stock"),
 * condition? ("new"|"used"|"refurbished"), url?, productType?. Anything absent
 * stays UNKNOWN; a null price is allowed here (a feed may list a product with
 * no price - the pipeline holds it, it does not invent one).
 */
export function mapGenericRow(provider: string, raw: unknown, opts: MapOptions = {}): MapResult {
  if (!isRecord(raw)) return { ok: false, error: "row is not an object" };
  const id = typeof raw.id === "number" || nonEmptyString(raw.id) ? String(raw.id) : null;
  if (!id) return { ok: false, error: "missing id" };
  if (!nonEmptyString(raw.title)) return { ok: false, error: "missing title" };
  const price = priceOf(raw.price);
  if (price === "bad") return { ok: false, error: "invalid price" };
  const pt = typeof raw.productType === "string" && isProductType(raw.productType) ? raw.productType : opts.productType;
  const condition = raw.condition === "new" || raw.condition === "used" || raw.condition === "refurbished" ? raw.condition : null;
  const listing = build(
    provider,
    id,
    "feed_id",
    raw.title,
    {
      manufacturer: nonEmptyString(raw.brand) ? raw.brand.trim() : UNKNOWN,
      modelNumber: nonEmptyString(raw.model) ? raw.model.trim() : UNKNOWN,
      price,
      currency: nonEmptyString(raw.currency) ? raw.currency.trim().toUpperCase() : UNKNOWN,
      seller: nonEmptyString(raw.seller) ? raw.seller.trim() : UNKNOWN,
      region: typeof raw.region === "string" && REGIONS.includes(raw.region) ? (raw.region as Region) : UNKNOWN,
      availability: raw.availability === "in_stock" || raw.availability === "out_of_stock" ? raw.availability : UNKNOWN,
      sourceUrl: typeof raw.url === "string" && isHttpUrl(raw.url) ? raw.url : null,
    },
    { ...opts, productType: pt },
  );
  if (condition) listing.condition = condition;
  return { ok: true, listing };
}

// ---------------------------------------------------------------------
// Provider batch: the result of ONE provider call, already mapped. A failed
// call or an unreadable response is `ok:false` - which the pipeline must
// treat as "no information" (previous state kept), never as "sold out" or
// "listing gone".
// ---------------------------------------------------------------------

export type ProviderBatch =
  | { provider: string; ok: true; listings: ProviderListing[]; malformed: number }
  | { provider: string; ok: false; error: string };

/**
 * Wraps a raw provider response. Not an array -> failed batch. A non-empty
 * response where EVERY item is malformed is also a failed batch (the response
 * format most likely changed; treating it as "0 results" would be wrong).
 * An empty array is a legitimate "no results" (ok, zero listings).
 */
export function buildProviderBatch(provider: string, rawItems: unknown, mapper: (raw: unknown) => MapResult): ProviderBatch {
  if (!Array.isArray(rawItems)) return { provider, ok: false, error: "malformed_response: not an array" };
  const listings: ProviderListing[] = [];
  let malformed = 0;
  for (const raw of rawItems) {
    const r = mapper(raw);
    if (r.ok) listings.push(r.listing);
    else malformed++;
  }
  if (rawItems.length > 0 && listings.length === 0) return { provider, ok: false, error: "malformed_response: no item could be parsed" };
  return { provider, ok: true, listings, malformed };
}
