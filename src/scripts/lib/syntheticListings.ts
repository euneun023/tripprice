/**
 * SYNTHETIC provider-listing generator for intake experiments. Everything it
 * produces is fabricated: titles are templated from catalog entries (real or
 * fabricated), prices are arbitrary, and no external API/page is involved.
 * Results measured on this data are processing/safety results - they say
 * NOTHING about how many real, comparable products exist.
 *
 * Deterministic (seeded PRNG) so a run is reproducible. Every generated
 * listing carries a ground-truth label so wrong matches can be counted.
 */
import { mapGenericRow, type ProviderListing } from "../../domain/providerListing";
import { PRODUCT_TYPES } from "../../domain/searchAliases";
import { BRAND_SYNONYMS, type CatalogEntry } from "../../services/listingIntakeService";
import { listingKey } from "../../domain/providerListing";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the correct outcome for a generated listing is. */
export type TruthKind =
  | "true_match" // same product as `variantId`: must end up in a REVIEW batch of that variant
  | "accessory" // compatibility accessory naming the model: must NOT be matched
  | "used" // used / refurbished: must NOT be matched
  | "sibling" // a different model that merely resembles the catalog one: must NOT link to it
  | "dup" // exact or id-changed duplicate of a true_match: must not become a second review item
  | "rights_unknown" // from a provider whose data-usage rights are unverified: must stay HOLD
  | "out_of_stock"; // true product, explicitly sold out

export interface Truth {
  kind: TruthKind;
  variantId: string | null;
}

export interface SyntheticOptions {
  seed: number;
  /** probability a catalog entry also gets each kind of noise listing */
  noiseRate?: number;
}

export interface SyntheticData {
  listings: ProviderListing[];
  truth: Map<string, Truth>;
  /** raw provider payload items that are deliberately unparseable (counted, never ingested) */
  malformedRaw: unknown[];
  providerRights: Record<string, "granted" | "denied" | "UNKNOWN">;
}

const GRANTED = { usageRights: "granted" as const, priceBasis: "seller_listing" as const, fetchedAt: "2026-11-01T00:00:00Z" };
const FAKE_BRANDS = ["Aquora", "Brevik", "Caldera", "Dorvane", "Eskel", "Fjordis", "Gantry", "Helion", "Ivora", "Jetsun", "Kaldor", "Lumeris", "Mondra", "Norvik", "Orbix", "Pelagic"];

/** Fabricated catalog of `count` models (unique codes), cycling through every productType. Fake brands only - nothing here is a real product. */
export function fabricateCatalog(count: number, rand: () => number): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (let i = 0; i < count; i++) {
    const brand = FAKE_BRANDS[Math.floor(rand() * FAKE_BRANDS.length)];
    const type = PRODUCT_TYPES[i % PRODUCT_TYPES.length];
    const code = `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}-${1000 + i}`;
    const hasSku = rand() < 0.85; // ~15% of products have no confirmed model number
    out.push({
      variantId: `syn-${i}`,
      productType: type,
      brand,
      name: `${brand} ${type.replace("_", " ")} ${code}${hasSku ? "" : " Edition"}`,
      modelSku: hasSku ? code : null,
      attributes: type === "camera_lens" ? { mount: "sony_e" } : undefined,
    });
  }
  return out;
}

const localBrand = (brand: string, lang: "ja" | "ko"): string => {
  const syn = BRAND_SYNONYMS[brand.toLowerCase()];
  if (!syn) return brand;
  return (lang === "ja" ? syn.find((s) => /[぀-ヿ一-鿿]/.test(s)) : syn.find((s) => /[가-힣]/.test(s))) ?? brand;
};

function mk(provider: string, id: string, title: string, region: "KR" | "JP" | "INTL", extra: Record<string, unknown> = {}): ProviderListing {
  // mystery-feed models a provider whose data-usage rights were never confirmed (the mapper default: UNKNOWN)
  const opts = provider === "mystery-feed" ? { fetchedAt: GRANTED.fetchedAt, priceBasis: GRANTED.priceBasis } : GRANTED;
  const r = mapGenericRow(provider, { id, title, price: 10000 + id.length * 7, currency: region === "KR" ? "KRW" : region === "JP" ? "JPY" : "USD", region, seller: `seller-${id.length % 5}`, availability: "in_stock", ...extra }, opts);
  if (!r.ok) throw new Error(`synthetic listing invalid: ${r.error}`);
  return r.listing;
}

/** Generates listings (and ground truth) for every catalog entry. Providers: jp-feed (JP), kr-feed (KR), intl-feed (INTL), mystery-feed (rights unverified). */
export function generateListings(catalog: CatalogEntry[], opts: SyntheticOptions): SyntheticData {
  const rand = mulberry32(opts.seed);
  const noise = opts.noiseRate ?? 0.35;
  const listings: ProviderListing[] = [];
  const truth = new Map<string, Truth>();
  const malformedRaw: unknown[] = [];
  const add = (l: ProviderListing, t: Truth) => {
    listings.push(l);
    truth.set(listingKey(l), t);
  };
  const body = (e: CatalogEntry, lang: "ja" | "ko") => (e.productType === "camera" ? (lang === "ja" ? "ボディ" : "바디") : lang === "ja" ? "正規品" : "정품");

  catalog.forEach((e, i) => {
    const code = e.modelSku ?? "";
    const base = e.name;
    const ja = `${localBrand(e.brand, "ja")} ${base} ${code} ${body(e, "ja")}`.replace(/\s+/g, " ").trim();
    const ko = `${localBrand(e.brand, "ko")} ${base} ${code} ${body(e, "ko")}`.replace(/\s+/g, " ").trim();
    const tm: Truth = { kind: "true_match", variantId: e.variantId };
    add(mk("jp-feed", `jp-${i}`, ja, "JP"), tm);
    add(mk("kr-feed", `kr-${i}`, ko, "KR"), tm);
    if (rand() < 0.3) add(mk("intl-feed", `intl-${i}`, `${e.brand} ${base} ${code} Genuine`.replace(/\s+/g, " ").trim(), "INTL"), tm);

    if (rand() < noise) add(mk("jp-feed", `jp-acc-${i}`, `${localBrand(e.brand, "ja")} ${base} ${code} 専用 ケース カバー`.replace(/\s+/g, " "), "JP"), { kind: "accessory", variantId: null });
    if (rand() < noise) add(mk("kr-feed", `kr-acc-${i}`, `${base} ${code} 호환 스트랩 케이스`.replace(/\s+/g, " "), "KR"), { kind: "accessory", variantId: null });
    if (rand() < noise) add(mk("jp-feed", `jp-used-${i}`, `【中古】${ja}`, "JP"), { kind: "used", variantId: null });
    if (rand() < noise) add(mk("kr-feed", `kr-ref-${i}`, `${ko} 리퍼비시`, "KR"), { kind: "used", variantId: null });
    if (rand() < noise) {
      // a different model resembling this one: suffix-extended code (sku+"W") or a later generation of the name
      const sibCode = code ? `${code}W` : "";
      // replace (not append) the real code so the base code never appears as its own token in the sibling title
      const sibName = code ? (base.includes(code) ? base.replace(code, sibCode) : `${base} ${sibCode}`) : `${base} Mark II`;
      add(mk("jp-feed", `jp-sib-${i}`, `${localBrand(e.brand, "ja")} ${sibName} ${body(e, "ja")}`.replace(/\s+/g, " "), "JP"), { kind: "sibling", variantId: null });
      add(mk("kr-feed", `kr-sib-${i}`, `${localBrand(e.brand, "ko")} ${sibName} ${body(e, "ko")}`.replace(/\s+/g, " "), "KR"), { kind: "sibling", variantId: null });
    }
    if (rand() < noise) {
      // exact duplicate of the JP listing (same provider+id) and an id-changed copy (same seller+title, new id)
      const jpL = listings.find((l) => l.provider === "jp-feed" && l.externalId === `jp-${i}`)!;
      listings.push({ ...jpL, fetchedAt: "2026-11-02T00:00:00Z" });
      add({ ...jpL, externalId: `jp-moved-${i}` }, { kind: "dup", variantId: e.variantId });
    }
    if (rand() < noise) add(mk("mystery-feed", `my-${i}`, `${e.brand} ${base} ${code}`.replace(/\s+/g, " "), "INTL"), { kind: "rights_unknown", variantId: null });
    if (rand() < noise / 2) add(mk("jp-feed", `jp-oos-${i}`, `${ja} 取寄`, "JP", { availability: "out_of_stock", seller: "oos-shop" }), { kind: "out_of_stock", variantId: e.variantId });
    if (rand() < noise / 4) malformedRaw.push(rand() < 0.5 ? { id: `bad-${i}` } : `garbage-${i}`);
  });
  return { listings, truth, malformedRaw, providerRights: { "jp-feed": "granted", "kr-feed": "granted", "intl-feed": "granted" } };
}
