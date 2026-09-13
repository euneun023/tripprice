export function formatKrw(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/**
 * brand + product name, without repeating the brand when officialName
 * already starts with it (e.g. brand "Suunto" + officialName "Suunto D5
 * Dive Computer" would otherwise read "Suunto Suunto D5..."). Presentation
 * only - never rewrites the underlying canonical_products data.
 */
export function productDisplayName(brand: string, officialName: string): string {
  const trimmedBrand = brand.trim();
  const trimmedName = officialName.trim();
  const lowerName = trimmedName.toLowerCase();
  const lowerBrand = trimmedBrand.toLowerCase();
  const boundary = trimmedName.charAt(trimmedBrand.length);
  const alreadyPrefixed = lowerBrand.length > 0 && lowerName.startsWith(lowerBrand) && (boundary === "" || /\s/.test(boundary));
  return alreadyPrefixed ? trimmedName : `${trimmedBrand} ${trimmedName}`.trim();
}

export function formatPrice(n: number, currency: string): string {
  if (currency === "KRW") return formatKrw(n);
  if (currency === "JPY") return `¥${n.toLocaleString("ja-JP")}`;
  if (currency === "USD") return `$${n.toLocaleString("en-US")}`;
  return `${n.toLocaleString()} ${currency}`;
}

/**
 * "9월 4일" in KST (Asia/Seoul), from a UTC timestamptz ISO string. All
 * timestamps stored in the DB (last_checked_at, fxAsOf, etc.) are UTC, so
 * this always converts explicitly rather than relying on server-local TZ
 * (Cloud Run has no TZ env var set - its default isn't something we can
 * safely assume).
 */
function formatKstDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${month}월 ${day}일`;
}

/**
 * "오전 1:55" in KST - 12-hour clock, no leading zero on hour, minute always
 * 2 digits. Built from formatToParts() rather than toLocaleTimeString()
 * because this runtime's ICU data renders ko-KR's dayPeriod as English
 * "AM"/"PM" regardless of locale/options, so 오전/오후 is derived from the
 * numeric hour instead of trusting locale-provided day-period text.
 */
function formatKstTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).formatToParts(d);
  const hour24 = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = parts.find((p) => p.type === "minute")!.value;
  const period = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${period} ${hour12}:${minute}`;
}

/** "8월 19일 확인" style - never "오늘" (see docs/phase1-design.md 표현 원칙) */
export function formatCheckedDate(iso: string | null): string {
  if (!iso) return "확인 이력 없음";
  const d = new Date(iso);
  return `${formatKstDate(d)} 확인`;
}

export function formatCheckedDateTime(iso: string | null): string {
  if (!iso) return "확인 이력 없음";
  const d = new Date(iso);
  return `${formatKstDate(d)} ${formatKstTime(d)} 확인`;
}

export const REGION_LABEL: Record<string, string> = {
  KR: "한국",
  JP: "일본",
  INTL: "해외직구",
};

export const CONFIDENCE_LABEL: Record<string, string> = {
  verified: "SKU 확인됨",
  estimated: "이름 매칭 (SKU 미확인)",
};

/** ShippingStatus (src/domain/types.ts) -> human-readable label, for a
 * KR-domestic source (Coupang) where "included" IS a real total-cost signal
 * (no international leg involved). Never implies a known amount - "배송비
 * 포함/별도" only says which side of the price the shipping cost falls on,
 * "확인 필요" covers both "no data" and any unrecognized value. */
export const SHIPPING_STATUS_LABEL: Record<string, string> = {
  included: "배송비 포함",
  separate: "배송비 별도",
  unknown: "배송비 확인 필요",
};

/**
 * Rakuten-specific labels: deliberately different wording from
 * SHIPPING_STATUS_LABEL above, and always paired with
 * RAKUTEN_INTERNATIONAL_SHIPPING_NOTE below. This value only ever describes
 * the SELLER's own JP-domestic postage display (Rakuten's postageFlag - see
 * deriveRakutenShippingStatus()'s doc comment in src/adapters/rakuten.ts) -
 * it is NEVER a claim that the total cost of shipping to a Korean buyer is
 * known, which is exactly why "포함" reads as "판매처 배송비 포함 표시"
 * ("the seller's own listing shows postage as included") rather than the
 * unqualified "배송비 포함" a Coupang row can honestly show.
 */
export const RAKUTEN_SHIPPING_STATUS_LABEL: Record<string, string> = {
  included: "판매처 배송비 포함 표시",
  separate: "판매처 배송비 별도",
  unknown: "판매처 배송비 확인 필요",
};

/** Always shown alongside RAKUTEN_SHIPPING_STATUS_LABEL, regardless of its
 * value - no field either Rakuten or Coupang's API returns confirms the cost
 * of shipping a Japan-purchased item to a Korean buyer. */
export const RAKUTEN_INTERNATIONAL_SHIPPING_NOTE = "한국 국제배송비 확인 필요";

/** product_variants.variant_attributes.mount slug (see CanonicalMount in
 * src/services/candidateEvaluationService.ts) -> human-readable label.
 * Display only - never fed back into anything that writes to the DB. */
const MOUNT_LABEL: Record<string, string> = {
  sony_e: "Sony E",
  canon_rf: "Canon RF",
  nikon_z: "Nikon Z",
  leica_l: "Leica L",
};

/**
 * Display value for one variant_attributes entry. Only the "mount" key is
 * ever translated, and only when its value is a recognized canonical slug -
 * every other key, and any mount value not in MOUNT_LABEL (a legacy
 * pre-slug row like "Sony E", or a future/unrecognized value), passes
 * through unchanged. Never touches the stored value itself.
 */
export function formatVariantAttributeValue(key: string, value: string): string {
  if (key === "mount" && value in MOUNT_LABEL) return MOUNT_LABEL[value];
  return value;
}

/** variant_attributes as [key, displayValue] pairs - the single place every
 * variant-attribute render site should read from instead of iterating
 * Object.entries()/Object.values() on the raw record directly. */
export function formatVariantAttributeEntries(attrs: Record<string, string> | null | undefined): [string, string][] {
  return Object.entries(attrs ?? {}).map(([k, v]) => [k, formatVariantAttributeValue(k, v)]);
}

/** "8월 23일 오전 9:12 기준" - for the FX-rate-as-of line (no "확인" suffix, that's for prices). */
export function formatAsOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${formatKstDate(d)} ${formatKstTime(d)} 기준`;
}
