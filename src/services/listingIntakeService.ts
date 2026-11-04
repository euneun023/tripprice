/**
 * Multi-provider candidate intake (pre-registration, in-memory, pure).
 *
 *   ProviderBatch[] -> dedupe -> model identification -> same-product
 *   grouping -> comparability -> triage (AUTO_DROP / AUTO_REFRESH / REVIEW / HOLD)
 *
 * This is a dry-run staging step in front of the existing registration flow.
 * It never touches the DB, never calls approveListing(), never calls a
 * provider API. Its output is a worklist: what can be dropped/refreshed
 * automatically (A), and a small number of group-level review batches that a
 * human approves in one decision each (B).
 *
 * Safety rules (each one has a test in listingIntakeService.test.ts):
 *  - The FIRST mapping of a listing to a variant is never auto-approved: a
 *    new listing can only end in REVIEW, never in an approved state. Only a
 *    listing the caller already passes in as `approved` gets AUTO_REFRESH.
 *  - Identity comes from a model-code token that matches on a token boundary
 *    (reusing identifierMatch.matchesModelToken, plus a guard against
 *    hyphen-extended codes). Name-only matches and newly discovered codes are
 *    always "weak" evidence.
 *  - A known attribute that conflicts (mount/colour/bundle/fitting) blocks the
 *    match; an unstated attribute the catalog cares about downgrades to weak.
 *  - Used/refurbished/accessory/wrong-category are dropped via the existing
 *    negativeFilter - the same rules the Phase 1 evaluator uses.
 *  - A provider failure or unreadable response is "no information": the
 *    previous snapshot is carried over untouched. Absence from a result is
 *    never interpreted as out-of-stock; only an explicit provider value is.
 *  - usageRights other than "granted" -> never leaves HOLD (UNKNOWN) / is
 *    dropped (denied).
 *  - Comparability reuses marketQuoteService.evaluateOfferEligibility and its
 *    "one market per region" semantics: a group needs eligible offers in >= 2
 *    distinct regions (counting already-approved listings of the variant).
 */
import type { Region } from "../domain/types";
import { UNKNOWN, listingKey, type ListingAttributes, type OrUnknown, type ProviderBatch, type ProviderListing, type UsageRights } from "../domain/providerListing";
import { BRAND_ALIASES, type ProductType } from "../domain/searchAliases";
import { matchesModelToken } from "../scripts/lib/identifierMatch";
import { classifyListingText } from "../scripts/lib/negativeFilter";
import { evaluateOfferEligibility, type Offer } from "./marketQuoteService";

// ---------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------

/** One registered (or about-to-be-registered) variant the intake can link listings to. Mirrors CanonicalProduct+ProductVariant. */
export interface CatalogEntry {
  variantId: string;
  productType: OrUnknown<ProductType>;
  brand: string;
  name: string;
  /** manufacturer model number, if known (ProductVariant.modelSku) */
  modelSku: string | null;
  /** authoritative variant attributes (ProductVariant.variantAttributes); absent key = unknown */
  attributes?: Partial<ListingAttributes>;
}

/** A listing a human already approved (a source_listings row). Used for AUTO_REFRESH and as a comparability anchor. */
export interface ApprovedListingRef {
  provider: string;
  externalId: string;
  variantId: string;
  region: OrUnknown<Region>;
}

export interface IntakeContext {
  catalog: CatalogEntry[];
  approved?: ApprovedListingRef[];
  /** listingKey()s a human already rejected - never re-queued */
  rejected?: string[];
  /** snapshot returned by the previous run; carried over for providers that failed / listings not seen this run */
  previousSnapshot?: ProviderListing[];
  /** explicit per-provider data-usage policy; overrides the mapper's value (default UNKNOWN) */
  providerRights?: Record<string, UsageRights>;
}

export type IntakeAction = "AUTO_DROP" | "AUTO_REFRESH" | "REVIEW" | "HOLD";
export type ModelSource = "catalog_code" | "explicit_code" | "title_code" | "name_link" | "none";
export type Evidence = "strong" | "weak";

export interface ListingOutcome {
  key: string;
  listing: ProviderListing;
  action: IntakeAction;
  reasons: string[];
  groupKey: string | null;
  variantId: string | null;
  modelCode: string | null;
  modelSource: ModelSource;
  evidence: Evidence | null;
  /** true when this listing came from the previous snapshot, not from this run's provider data */
  carriedOver: boolean;
}

export interface ReviewBatch {
  id: string;
  kind: "catalog_variant" | "new_product" | "id_change_remap" | "approved_changed";
  variantId: string | null;
  label: string;
  evidence: Evidence;
  listingKeys: string[];
  regions: Region[];
  /** regions where THIS run saw an explicit in_stock offer. regions \ stockConfirmedRegions = price candidates whose stock nobody confirmed. */
  stockConfirmedRegions: Region[];
  reasons: string[];
}

export interface IntakeStats {
  input: number;
  duplicateExact: number;
  duplicateIdChange: number;
  carriedOver: number;
  unique: number;
  actions: Record<IntakeAction, number>;
  reasons: Record<string, number>;
  modelSource: Record<ModelSource, number>;
  groups: number;
  comparableGroups: number;
  /** subset of comparableGroups with an explicit in_stock offer in >= 2 regions. A "comparable" group is a price candidate (state 3), NOT a confirmed-purchasable one (state 4). */
  comparableGroupsStockConfirmed: number;
  reviewBatches: number;
  reviewListings: number;
  providerFailures: number;
  malformedItems: number;
}

export interface IntakeResult {
  outcomes: ListingOutcome[];
  reviewBatches: ReviewBatch[];
  /** persist this and pass it back as ctx.previousSnapshot on the next run */
  snapshot: ProviderListing[];
  providerStatus: Array<{ provider: string; ok: boolean; listings: number; malformed: number; error?: string }>;
  stats: IntakeStats;
}

// ---------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------

const nfkc = (s: string): string => s.normalize("NFKC");
const normTitle = (s: string): string => nfkc(s).toLowerCase().replace(/[【】\[\]()（）]/g, " ").replace(/\s+/g, " ").trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const BRAND_SYNONYMS: Record<string, string[]> = {
  sony: ["ソニー", "소니"],
  canon: ["キヤノン", "キャノン", "캐논"],
  nikon: ["ニコン", "니콘"],
  panasonic: ["パナソニック", "파나소닉"],
  fujifilm: ["富士フイルム", "후지필름", "フジフイルム"],
  garmin: ["ガーミン", "가민"],
  tamron: ["タムロン", "탐론"],
  sigma: ["シグマ", "시그마"],
  suunto: ["スント", "순토"],
  mares: ["マレス", "마레스"],
  scubapro: ["スキューバプロ", "스쿠바프로"],
  gull: ["ガル", "걸"],
  "om system": ["OMシステム", "オーエムシステム"],
};
for (const [ko, canonical] of Object.entries(BRAND_ALIASES)) {
  const k = canonical.toLowerCase();
  (BRAND_SYNONYMS[k] ??= []).push(ko);
}

/** ASCII tokens of a title: alnum runs, hyphen allowed inside ("ILCE-7M5"). Katakana/Hangul/space all split. */
function asciiTokens(text: string): string[] {
  return nfkc(text).match(/[A-Za-zα0-9]+(?:-[A-Za-zα0-9]+)*/g) ?? [];
}

// Units/spec words that look like codes. Multi-letter units are noise at any length; single-letter units
// (W/V/K/X/M/G/L) only up to 4 digits - "20942W" is a model code, "500W"/"4K" are specs.
const NOISE_TOKEN = /mm|^\d+(?:-\d+)?(?:cm|gb|tb|mah|hz|fps|mp|kg|ml|ft|bar|lb|inch|in)$|^\d{1,4}[gklmvwx]$|^f\d+$|^ip[x]?\d+$|^t\d+$|^\d+(?:st|nd|rd|th)$/i;

/** Model-code-looking tokens (letters AND digits), ordered longest first. */
export function extractModelCodes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of asciiTokens(text)) {
    if (tok.length < 2 || tok.length > 20) continue;
    if (!/[A-Za-z]/.test(tok) || !/\d/.test(tok)) continue;
    if (NOISE_TOKEN.test(tok)) continue;
    const u = tok.toUpperCase();
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(tok);
  }
  return out.sort((a, b) => b.length - a.length);
}

const isStrongCodeShape = (code: string): boolean => code.length >= 6 && /[A-Za-z]/.test(code) && /\d/.test(code);
const codeKey = (code: string): string => code.toUpperCase().replace(/[-\s]/g, "");

/** matchesModelToken plus: the code must not be the prefix of a longer hyphenated code (e.g. "ILCE-7M5-B"). */
function matchesCodeStrict(text: string, code: string): boolean {
  if (!matchesModelToken(text, code)) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(code)}-[A-Za-z0-9]`, "i");
  return !re.test(text);
}

// ---------------------------------------------------------------------
// Catalog index
// ---------------------------------------------------------------------

interface IndexedEntry {
  entry: CatalogEntry;
  brandKey: string;
  modelTokens: string[];
}

const GENERIC_NAME_TOKENS = new Set(["body", "ボディ", "본체"]);
const nameTokens = (s: string): string[] => nfkc(s).toLowerCase().split(/[\s,/[\]()（）【】｜|:：・+&]+/).filter(Boolean);
/** tokens that, appearing right after a catalog model name, mean "a different/later model" (R5 vs R5 Mark II, α7 vs α7 V) */
const VARIANT_NEXT = /^(?:ii|iii|iv|v|vi|vii|viii|mark|mk\d?|mkii|plus|\+|pro|max|ultra|lite|s|se|x|xl|gt|ex|mini|air|elite|r|\d{1,2})$/;

/** Tokens right after `code` in the title when they are later-model markers ("II", "Mark II", "Pro", ...); [] when none. */
function generationSuffix(title: string, code: string): string[] {
  const tt = nameTokens(title);
  const i = tt.indexOf(code.toLowerCase());
  if (i < 0) return [];
  const out: string[] = [];
  let j = i + 1;
  while (GENERIC_NAME_TOKENS.has(tt[j])) j++;
  for (; j < tt.length && out.length < 2 && VARIANT_NEXT.test(tt[j]); j++) out.push(tt[j]);
  return out;
}

class CatalogIndex {
  readonly byCode = new Map<string, IndexedEntry[]>();
  readonly byBrand = new Map<string, IndexedEntry[]>();
  readonly brandRes: Array<{ key: string; re: RegExp; synonyms: string[] }> = [];

  constructor(catalog: CatalogEntry[]) {
    const brands = new Set<string>();
    for (const entry of catalog) {
      const brandKey = entry.brand.toLowerCase().trim();
      brands.add(brandKey);
      const brandTok = new Set(nameTokens(entry.brand));
      const modelTokens = nameTokens(entry.name).filter((t) => !brandTok.has(t) && !GENERIC_NAME_TOKENS.has(t));
      const ie: IndexedEntry = { entry, brandKey, modelTokens };
      (this.byBrand.get(brandKey) ?? this.byBrand.set(brandKey, []).get(brandKey)!).push(ie);
      if (entry.modelSku && /^[A-Za-z0-9-]{2,20}$/.test(entry.modelSku) && !/mm/i.test(entry.modelSku)) {
        const k = entry.modelSku.toUpperCase();
        (this.byCode.get(k) ?? this.byCode.set(k, []).get(k)!).push(ie);
      }
    }
    for (const key of brands) {
      const syn = BRAND_SYNONYMS[key] ?? [];
      this.brandRes.push({ key, re: new RegExp(`(?<![a-z0-9])${escapeRe(key)}(?![a-z0-9])`, "i"), synonyms: syn });
    }
  }

  detectBrands(title: string, manufacturer: string): Set<string> {
    const text = nfkc(title);
    const found = new Set<string>();
    const mf = manufacturer === UNKNOWN ? "" : nfkc(manufacturer).toLowerCase().trim();
    for (const { key, re, synonyms } of this.brandRes) {
      if (mf && (mf === key || synonyms.some((s) => s.toLowerCase() === mf))) found.add(key);
      else if (re.test(text) || synonyms.some((s) => text.includes(s))) found.add(key);
    }
    return found;
  }
}

// ---------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------

interface Identification {
  entry: CatalogEntry | null;
  link: "code" | "name" | null;
  code: string | null;
  source: ModelSource;
  brandKey: string | null;
  brandEvidence: boolean;
  conflicts: string[];
  gaps: string[];
  ambiguous: boolean;
}

const ATTRS: Array<keyof ListingAttributes> = ["mount", "fitting", "bundle", "color"];
const REQUIRED_ATTR: Partial<Record<string, keyof ListingAttributes>> = { camera_lens: "mount", regulator: "fitting" };

function compareAttributes(entry: CatalogEntry, l: ProviderListing): { conflicts: string[]; gaps: string[] } {
  const conflicts: string[] = [];
  const gaps: string[] = [];
  const required = REQUIRED_ATTR[entry.productType];
  for (const a of ATTRS) {
    const c = entry.attributes?.[a];
    const lv = l.attributes[a];
    if (c && c !== UNKNOWN) {
      if (lv === UNKNOWN) gaps.push(`${a}_unconfirmed`);
      else if (lv !== c) conflicts.push(`${a}: catalog=${c} listing=${lv}`);
    } else if (a === required) {
      gaps.push(`${a}_unknown_in_catalog`);
      if (lv === UNKNOWN) gaps.push(`${a}_unconfirmed`);
    } else if (a === "bundle" && lv === "kit") {
      gaps.push("bundle_kit_vs_unspecified");
    }
  }
  return { conflicts, gaps: [...new Set(gaps)] };
}

function identify(l: ProviderListing, index: CatalogIndex): Identification {
  const none: Identification = { entry: null, link: null, code: null, source: "none", brandKey: null, brandEvidence: false, conflicts: [], gaps: [], ambiguous: false };
  const brands = index.detectBrands(l.title, l.manufacturer);
  const brandKey = brands.size === 1 ? [...brands][0] : null;

  // --- 1. catalog model-code link (strongest) ---
  const tokens = new Map<string, "title" | "explicit">();
  for (const t of asciiTokens(l.title)) tokens.set(t.toUpperCase(), "title");
  if (l.modelNumber !== UNKNOWN) tokens.set(l.modelNumber.toUpperCase().replace(/\s+/g, ""), "explicit");
  let hits: Array<{ ie: IndexedEntry; code: string; via: "title" | "explicit" }> = [];
  for (const [k, via] of tokens) {
    for (const ie of index.byCode.get(k) ?? []) {
      const sku = ie.entry.modelSku!;
      if (via === "title" && !matchesCodeStrict(nfkc(l.title), sku)) continue;
      // "ZV-E10 II" is not catalog "ZV-E10": a later-generation marker right after the code means a different model
      if (via === "title" && generationSuffix(l.title, sku).length > 0) continue;
      const brandOk = brands.has(ie.brandKey);
      if (!brandOk && !(brands.size === 0 && isStrongCodeShape(sku))) continue; // short codes ("Z8") need brand evidence
      hits.push({ ie, code: sku, via });
    }
  }
  if (hits.length > 0) {
    const distinct = new Map(hits.map((h) => [h.ie.entry.variantId, h]));
    let candidates = [...distinct.values()];
    if (candidates.length > 1) candidates = candidates.filter((h) => compareAttributes(h.ie.entry, l).conflicts.length === 0);
    if (candidates.length !== 1) {
      return { ...none, brandKey, code: hits[0].code, source: "catalog_code", ambiguous: candidates.length > 1, conflicts: candidates.length === 0 ? ["all code-matched variants conflict on attributes"] : [] };
    }
    const h = candidates[0];
    const { conflicts, gaps } = compareAttributes(h.ie.entry, l);
    const brandEvidence = brands.has(h.ie.brandKey);
    return {
      entry: conflicts.length ? null : h.ie.entry,
      link: conflicts.length ? null : "code",
      code: h.code,
      source: "catalog_code",
      brandKey: h.ie.brandKey,
      brandEvidence,
      conflicts,
      gaps,
      ambiguous: false,
    };
  }

  // --- 2. catalog name link (weak): contiguous model-name tokens, not followed by a later-model marker ---
  if (brands.size >= 1) {
    const tt = nameTokens(l.title);
    let best: IndexedEntry[] = [];
    let bestLen = 0;
    for (const bk of brands) {
      for (const ie of index.byBrand.get(bk) ?? []) {
        const mt = ie.modelTokens;
        if (mt.length === 0 || !(mt.length >= 2 || /\d/.test(mt[0]))) continue;
        if (mt.length < bestLen) continue;
        for (let i = 0; i + mt.length <= tt.length; i++) {
          if (!mt.every((t, j) => tt[i + j] === t)) continue;
          let nx = i + mt.length;
          while (GENERIC_NAME_TOKENS.has(tt[nx])) nx++; // "Z5 BODY Mark II": skip the generic word, then look for the marker
          const next = tt[nx];
          if (next !== undefined && VARIANT_NEXT.test(next)) continue;
          if (mt.length > bestLen) { best = []; bestLen = mt.length; }
          best.push(ie);
          break;
        }
      }
    }
    const variants = new Set(best.map((b) => b.entry.variantId));
    if (variants.size === 1) {
      const ie = best[0];
      const { conflicts, gaps } = compareAttributes(ie.entry, l);
      // a model code in the title that the catalog entry does not own must not be ignored
      const own = new Set(ie.modelTokens);
      const foreign = extractModelCodes(l.title).filter((c) => (isStrongCodeShape(c) || c.includes("-")) && !own.has(c.toLowerCase()) && c.toUpperCase() !== (ie.entry.modelSku ?? "").toUpperCase());
      if (foreign.length > 0) {
        if (ie.entry.modelSku) conflicts.push(`code: catalog=${ie.entry.modelSku} title=${foreign[0]}`);
        else gaps.push(`unverified_code_in_title:${foreign[0]}`);
      }
      return { entry: conflicts.length ? null : ie.entry, link: conflicts.length ? null : "name", code: null, source: "name_link", brandKey: ie.brandKey, brandEvidence: true, conflicts, gaps, ambiguous: false };
    }
    if (variants.size > 1) return { ...none, brandKey, source: "name_link", ambiguous: true };
  }

  // --- 3. not in catalog: a newly discovered code (weak) ---
  let code: string | null = null;
  let source: ModelSource = "none";
  if (l.modelNumber !== UNKNOWN) {
    code = l.modelNumber;
    source = "explicit_code";
  } else {
    const codes = extractModelCodes(l.title);
    if (codes.length > 0 && (codes.length === 1 || codeKey(codes[0]) !== codeKey(codes[1]) && codes[0].length > codes[1].length)) {
      const suffix = generationSuffix(l.title, codes[0]);
      code = suffix.length ? `${codes[0]} ${suffix.join(" ")}` : codes[0];
      source = "title_code";
    }
  }
  if (code) {
    const mf = brandKey ?? (l.manufacturer !== UNKNOWN ? l.manufacturer.toLowerCase().trim() : null);
    if (!mf && !isStrongCodeShape(code)) code = null; // a short code with no brand is not an identity
    else return { ...none, code, source, brandKey: mf, brandEvidence: mf !== null };
  }
  return { ...none, brandKey };
}

// ---------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------

interface Pending {
  l: ProviderListing;
  key: string;
  carried: boolean;
  idChangeOf: string | null;
}

const newerFirst = (a: ProviderListing, b: ProviderListing): ProviderListing =>
  b.fetchedAt !== UNKNOWN && (a.fetchedAt === UNKNOWN || b.fetchedAt > a.fetchedAt) ? b : a;

/** When two records of the same listing collapse, the survivor keeps any structured identity field the dropped one knew (never overwrites a known value). */
function fillKnown(into: ProviderListing, from: ProviderListing): ProviderListing {
  return {
    ...into,
    manufacturer: into.manufacturer === UNKNOWN ? from.manufacturer : into.manufacturer,
    modelNumber: into.modelNumber === UNKNOWN ? from.modelNumber : into.modelNumber,
    productType: into.productType === UNKNOWN ? from.productType : into.productType,
  };
}

export function runIntake(batches: ProviderBatch[], ctx: IntakeContext): IntakeResult {
  const index = new CatalogIndex(ctx.catalog);
  const approvedByKey = new Map((ctx.approved ?? []).map((a) => [`${a.provider}|${a.externalId}`, a]));
  const rejected = new Set(ctx.rejected ?? []);

  // ---- 1. collect, exact-dedupe, carry over ----
  const providerStatus: IntakeResult["providerStatus"] = [];
  const merged = new Map<string, ProviderListing>();
  let input = 0;
  let duplicateExact = 0;
  let malformedItems = 0;
  let providerFailures = 0;
  const withRights = (l: ProviderListing): ProviderListing => ({ ...l, usageRights: ctx.providerRights?.[l.provider] ?? l.usageRights });
  // ctx.providerRights is a POLICY applied at decision time. It must never be baked into the snapshot: otherwise a
  // grant outlives its policy entry (removing the entry would keep carried-over rows "granted" forever). The snapshot
  // therefore keeps what the mapper itself declared; the policy is re-applied on every run.
  const declaredRights = new Map<string, UsageRights>();
  for (const b of batches) {
    if (!b.ok) {
      providerFailures++;
      providerStatus.push({ provider: b.provider, ok: false, listings: 0, malformed: 0, error: b.error });
      continue;
    }
    providerStatus.push({ provider: b.provider, ok: true, listings: b.listings.length, malformed: b.malformed });
    malformedItems += b.malformed;
    for (const raw of b.listings) {
      input++;
      const l = withRights(raw);
      const k = listingKey(l);
      const prev = merged.get(k);
      if (prev) {
        duplicateExact++;
        const winner = newerFirst(prev, l);
        if (winner === l) declaredRights.set(k, raw.usageRights);
        merged.set(k, fillKnown(winner, winner === prev ? l : prev));
      } else { merged.set(k, l); declaredRights.set(k, raw.usageRights); }
    }
  }
  const freshKeys = new Set(merged.keys());
  for (const p of ctx.previousSnapshot ?? []) {
    const k = listingKey(p);
    if (!merged.has(k)) { merged.set(k, withRights(p)); declaredRights.set(k, p.usageRights); }
  }

  // ---- 2. id-change dedupe: same provider+seller+title (+price when seller unknown) under a new externalId ----
  const clusters = new Map<string, string[]>();
  for (const [k, l] of merged) {
    const ck = `${l.provider}|${l.seller}|${normTitle(l.title)}|${l.seller === UNKNOWN ? (l.price ?? "-") : ""}`;
    (clusters.get(ck) ?? clusters.set(ck, []).get(ck)!).push(k);
  }
  const pending: Pending[] = [];
  const outcomes: ListingOutcome[] = [];
  let duplicateIdChange = 0;
  const mkOutcome = (l: ProviderListing, o: Partial<ListingOutcome> & Pick<ListingOutcome, "action" | "reasons">, carried: boolean): ListingOutcome => ({
    key: listingKey(l), listing: l, groupKey: null, variantId: null, modelCode: null, modelSource: "none", evidence: null, carriedOver: carried, ...o,
  });
  for (const keys of clusters.values()) {
    if (keys.length === 1) {
      pending.push({ l: merged.get(keys[0])!, key: keys[0], carried: !freshKeys.has(keys[0]), idChangeOf: null });
      continue;
    }
    const approvedKeys = keys.filter((k) => approvedByKey.has(k));
    if (approvedKeys.length > 1) {
      for (const k of keys) pending.push({ l: merged.get(k)!, key: k, carried: !freshKeys.has(k), idChangeOf: null });
      continue;
    }
    const ts = (k: string): string => (merged.get(k)!.fetchedAt === UNKNOWN ? "" : merged.get(k)!.fetchedAt);
    const primary =
      approvedKeys[0] ??
      [...keys].sort((a, b) => {
        const fa = freshKeys.has(a) ? 0 : 1, fb = freshKeys.has(b) ? 0 : 1;
        if (fa !== fb) return fa - fb; // this run's data beats carried-over data
        if (ts(a) !== ts(b)) return ts(a) > ts(b) ? -1 : 1; // then the newer read
        return a < b ? -1 : 1;
      })[0];
    if (approvedKeys.length === 0) for (const k of keys) if (k !== primary) merged.set(primary, fillKnown(merged.get(primary)!, merged.get(k)!));
    for (const k of keys) {
      const l = merged.get(k)!;
      if (k === primary) pending.push({ l, key: k, carried: !freshKeys.has(k), idChangeOf: null });
      else if (approvedKeys.length === 1) pending.push({ l, key: k, carried: !freshKeys.has(k), idChangeOf: primary });
      else {
        duplicateIdChange++;
        outcomes.push(mkOutcome(l, { action: "AUTO_DROP", reasons: [`duplicate_id_change: same seller/title as ${primary}`] }, !freshKeys.has(k)));
      }
    }
  }

  // ---- 3. per-listing evaluation (pre-grouping) ----
  interface Cand { p: Pending; id: Identification; groupBase: string; evidence: Evidence; gaps: string[] }
  const cands: Cand[] = [];
  const reviewBatches: ReviewBatch[] = [];
  const hold = (p: Pending, reasons: string[], extra: Partial<ListingOutcome> = {}) => outcomes.push(mkOutcome(p.l, { action: "HOLD", reasons, ...extra }, p.carried));

  for (const p of pending) {
    const { l, key } = p;
    const id = identify(l, index);
    const base = { modelCode: id.code, modelSource: id.source, variantId: id.entry?.variantId ?? null };
    const approved = approvedByKey.get(key);

    if (l.usageRights === "denied") { outcomes.push(mkOutcome(l, { action: "AUTO_DROP", reasons: ["rights_denied"], ...base }, p.carried)); continue; }
    if (l.usageRights !== "granted") { hold(p, ["rights_unverified"], base); continue; }
    if (rejected.has(key)) { outcomes.push(mkOutcome(l, { action: "AUTO_DROP", reasons: ["human_rejected"], ...base }, p.carried)); continue; }

    const pt = l.productType !== UNKNOWN ? l.productType : id.entry?.productType !== UNKNOWN && id.entry ? id.entry.productType : "";
    const neg = classifyListingText(l.title, pt);
    const conditionBad = l.condition === "used" || l.condition === "refurbished";
    const negative = neg.negative || conditionBad;
    const negReason = neg.negative ? `${neg.reason}:${neg.matchedKeyword}` : `condition:${l.condition}`;

    // A roll-up price over many sellers is discovery data: never an approvable/refreshable/comparable listing
    // (junk is still dropped first, so used/accessory rows are not left on hold).
    if (l.priceBasis === "product_aggregate") {
      if (negative) outcomes.push(mkOutcome(l, { action: "AUTO_DROP", reasons: [negReason], ...base }, p.carried));
      else hold(p, ["product_level_price_only: no seller-level price/URL; discovery only"], base);
      continue;
    }

    if (approved) {
      const drift = negative ? negReason : id.entry && id.entry.variantId !== approved.variantId ? `now matches variant ${id.entry.variantId}` : null;
      if (drift) {
        reviewBatches.push({ id: `approved:${key}`, kind: "approved_changed", variantId: approved.variantId, label: l.title, evidence: "weak", listingKeys: [key], regions: l.region === UNKNOWN ? [] : [l.region], stockConfirmedRegions: [], reasons: [`approved_listing_changed: ${drift}`] });
        outcomes.push(mkOutcome(l, { action: "REVIEW", reasons: [`approved_listing_changed: ${drift}`], groupKey: `approved:${key}`, ...base, variantId: approved.variantId }, p.carried));
      } else if (l.price === null || !(l.price > 0)) {
        // no price came back for an approved listing: that is "no information", never a refresh value
        hold(p, ["approved_refresh_no_price: previous state kept"], { ...base, variantId: approved.variantId, groupKey: `v:${approved.variantId}` });
      } else if (l.priceBasis !== "seller_listing") {
        // the approval stays; but a price whose granularity the provider never declared is not a refresh value
        hold(p, ["approved_refresh_price_basis_unverified: previous state kept"], { ...base, variantId: approved.variantId, groupKey: `v:${approved.variantId}` });
      } else if (l.currency === UNKNOWN) {
        hold(p, ["approved_refresh_no_currency: previous state kept"], { ...base, variantId: approved.variantId, groupKey: `v:${approved.variantId}` });
      } else {
        // availability UNKNOWN means "provider said nothing": the consumer must keep the previous availability, not write null/false
        const reason = l.availability === UNKNOWN ? "approved_listing: price refresh only; availability unstated -> keep previous availability" : "approved_listing: price/availability refresh only";
        outcomes.push(mkOutcome(l, { action: "AUTO_REFRESH", reasons: [reason], groupKey: `v:${approved.variantId}`, ...base, variantId: approved.variantId }, p.carried));
      }
      continue;
    }
    if (negative) { outcomes.push(mkOutcome(l, { action: "AUTO_DROP", reasons: [negReason], ...base }, p.carried)); continue; }
    if (l.price === null || !(l.price > 0)) { hold(p, ["no_price"], base); continue; }
    if (l.region === UNKNOWN) { hold(p, ["region_unknown"], base); continue; }
    if (l.priceBasis !== "seller_listing") { hold(p, ["price_basis_unverified: provider never declared seller-level pricing"], base); continue; }
    if (id.conflicts.length) { hold(p, ["variant_conflict", ...id.conflicts], base); continue; }
    if (id.ambiguous) { hold(p, ["ambiguous_catalog_match"], base); continue; }
    if (p.idChangeOf) {
      const reason = `id_changed_remap: same seller/title as approved ${p.idChangeOf}`;
      reviewBatches.push({ id: `remap:${p.key}`, kind: "id_change_remap", variantId: approvedByKey.get(p.idChangeOf)!.variantId, label: l.title, evidence: "weak", listingKeys: [key], regions: [l.region], stockConfirmedRegions: [], reasons: [reason] });
      outcomes.push(mkOutcome(l, { action: "REVIEW", reasons: [reason], groupKey: `remap:${key}`, ...base, variantId: approvedByKey.get(p.idChangeOf)!.variantId, evidence: "weak" }, p.carried));
      continue;
    }

    let groupBase: string;
    let evidence: Evidence = "weak";
    if (id.entry) {
      groupBase = `v:${id.entry.variantId}`;
      if (id.link === "code" && id.gaps.length === 0 && (id.brandEvidence || isStrongCodeShape(id.code ?? ""))) evidence = "strong";
    } else if (id.code) {
      groupBase = `d:${id.brandKey ?? "?"}|${codeKey(id.code)}`;
    } else { hold(p, ["model_unknown"], base); continue; }
    cands.push({ p, id, groupBase, evidence, gaps: id.gaps });
  }

  // ---- 4. group, split on conflicting known attributes, check comparability ----
  const byBase = new Map<string, Cand[]>();
  for (const c of cands) (byBase.get(c.groupBase) ?? byBase.set(c.groupBase, []).get(c.groupBase)!).push(c);
  const anchorsByVariant = new Map<string, Array<OrUnknown<Region>>>();
  for (const a of approvedByKey.values()) (anchorsByVariant.get(a.variantId) ?? anchorsByVariant.set(a.variantId, []).get(a.variantId)!).push(a.region);

  let groups = 0;
  let comparableGroups = 0;
  let comparableGroupsStockConfirmed = 0;
  for (const [base, members] of byBase) {
    const splitAttrs = ATTRS.filter((a) => new Set(members.map((m) => m.p.l.attributes[a]).filter((v) => v !== UNKNOWN)).size > 1);
    const subs = new Map<string, Cand[]>();
    for (const m of members) {
      if (splitAttrs.some((a) => m.p.l.attributes[a] === UNKNOWN)) {
        hold(m.p, ["attr_ambiguous", `group mixes known ${splitAttrs.join("/")} values; this listing states none`], { groupKey: base, variantId: m.id.entry?.variantId ?? null, modelCode: m.id.code, modelSource: m.id.source });
        continue;
      }
      const sk = splitAttrs.length ? `${base}#${splitAttrs.map((a) => `${a}=${m.p.l.attributes[a]}`).join("&")}` : base;
      (subs.get(sk) ?? subs.set(sk, []).get(sk)!).push(m);
    }
    for (const [gk, ms] of subs) {
      groups++;
      const variantId = ms[0].id.entry?.variantId ?? null;
      const anchors = splitAttrs.length === 0 && variantId ? anchorsByVariant.get(variantId) ?? [] : [];
      const anchorRegions = new Set(anchors.filter((r): r is Region => r !== UNKNOWN));
      const offers: Offer[] = ms.map((m) => ({
        sourceListingId: m.p.key, sourceId: m.p.l.provider, region: m.p.l.region as Region, price: m.p.l.price, currency: m.p.l.currency === UNKNOWN ? null : m.p.l.currency,
        availability: m.p.l.availability === "in_stock" ? true : m.p.l.availability === "out_of_stock" ? false : null,
        reviewRequired: false, confidence: "estimated", shippingStatus: "unknown", sourceUrl: m.p.l.sourceUrl,
      }));
      const eligibleRegions = new Set(offers.filter((o) => evaluateOfferEligibility(o).eligible).map((o) => o.region));
      // state 4 evidence: an eligible offer whose provider EXPLICITLY said in_stock. Approved anchors carry no stock info here, so they never count.
      const stockConfirmed = new Set(offers.filter((o) => evaluateOfferEligibility(o).eligible && o.availability === true).map((o) => o.region));
      const allRegions = new Set<Region>([...eligibleRegions, ...anchorRegions]);
      const meta = (m: Cand) => ({ groupKey: gk, variantId, modelCode: m.id.code, modelSource: m.id.source });
      if (allRegions.size < 2) {
        const why = eligibleRegions.size === 0 ? "no_available_offer" : `single_region:${[...allRegions].join(",")}`;
        for (const m of ms) hold(m.p, [why], meta(m));
        continue;
      }
      comparableGroups++;
      if (stockConfirmed.size >= 2) comparableGroupsStockConfirmed++;
      const dupMarket = new Set<string>();
      const regionCount = new Map<string, number>();
      for (const m of ms) regionCount.set(`${m.p.l.provider}|${m.p.l.region}`, (regionCount.get(`${m.p.l.provider}|${m.p.l.region}`) ?? 0) + 1);
      let evidence: Evidence = "strong";
      const batchReasons = new Set<string>();
      const keys: string[] = [];
      for (const m of ms) {
        const reasons: string[] = [];
        let ev = m.evidence;
        if (m.id.link !== "code") reasons.push(m.id.link === "name" ? "name_match_only" : "new_product_code_not_in_catalog");
        for (const g of m.gaps) reasons.push(g);
        if (anchorRegions.has(m.p.l.region as Region)) { reasons.push("duplicate_market_offer: approved listing already exists in this region"); ev = "weak"; }
        if ((regionCount.get(`${m.p.l.provider}|${m.p.l.region}`) ?? 0) > 1) dupMarket.add(`${m.p.l.provider}|${m.p.l.region}`);
        if (m.p.l.availability === "out_of_stock") reasons.push("out_of_stock: approve mapping, excluded from price comparison");
        if (m.p.l.availability === UNKNOWN) reasons.push("availability_unconfirmed: provider stated no stock info; do not present as in stock");
        if (m.p.l.condition === UNKNOWN) reasons.push("condition_unstated(no used/refurb marker found)");
        if (ev === "weak") evidence = "weak";
        reasons.forEach((r) => batchReasons.add(r));
        keys.push(m.p.key);
        outcomes.push(mkOutcome(m.p.l, { action: "REVIEW", reasons: reasons.length ? reasons : ["strong_code_match"], evidence: ev, ...meta(m) }, m.p.carried));
      }
      if (dupMarket.size) batchReasons.add("multiple_offers_same_provider_region: choose/keep per market");
      reviewBatches.push({
        id: gk,
        kind: variantId ? "catalog_variant" : "new_product",
        variantId,
        label: variantId ? ctx.catalog.find((c) => c.variantId === variantId)!.name : `NEW ${ms[0].id.brandKey ?? "?"} ${ms[0].id.code}`,
        evidence,
        listingKeys: keys.sort(),
        regions: [...allRegions].sort(),
        stockConfirmedRegions: [...stockConfirmed].sort(),
        reasons: [...batchReasons].sort(),
      });
    }
  }

  // ---- 5. stats / deterministic output ----
  outcomes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  reviewBatches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const actions: Record<IntakeAction, number> = { AUTO_DROP: 0, AUTO_REFRESH: 0, REVIEW: 0, HOLD: 0 };
  const reasons: Record<string, number> = {};
  const modelSource: Record<ModelSource, number> = { catalog_code: 0, explicit_code: 0, title_code: 0, name_link: 0, none: 0 };
  for (const o of outcomes) {
    actions[o.action]++;
    modelSource[o.modelSource]++;
    const r = o.reasons[0].split(":")[0];
    reasons[`${o.action}/${r}`] = (reasons[`${o.action}/${r}`] ?? 0) + 1;
  }
  const snapshot = [...merged.entries()].map(([k, l]) => ({ ...l, usageRights: declaredRights.get(k) ?? l.usageRights })).sort((a, b) => (listingKey(a) < listingKey(b) ? -1 : 1));
  return {
    outcomes,
    reviewBatches,
    snapshot,
    providerStatus,
    stats: {
      input, duplicateExact, duplicateIdChange, carriedOver: merged.size - freshKeys.size, unique: outcomes.length - duplicateIdChange,
      actions, reasons, modelSource, groups, comparableGroups, comparableGroupsStockConfirmed,
      reviewBatches: reviewBatches.length, reviewListings: actions.REVIEW, providerFailures, malformedItems,
    },
  };
}

/**
 * Human-readable batch-review worklist (markdown). One section per ReviewBatch so a reviewer makes ONE
 * decision per same-product group instead of one per listing. strong-evidence batches first, then by id.
 * Prices are omitted unless includePrices is set - the worklist is a runtime artifact, not something to commit.
 */
export function renderReviewWorklist(result: IntakeResult, opts: { includePrices?: boolean } = {}): string {
  const byKey = new Map(result.outcomes.map((o) => [o.key, o]));
  const batches = [...result.reviewBatches].sort((a, b) => (a.evidence === b.evidence ? (a.id < b.id ? -1 : 1) : a.evidence === "strong" ? -1 : 1));
  const lines = [`# Review worklist: ${batches.length} batch decisions covering ${result.stats.reviewListings} listings`, ""];
  for (const b of batches) {
    lines.push(`## [${b.evidence.toUpperCase()}] ${b.label}  (${b.kind}, regions ${b.regions.join("/") || "-"})`);
    if (b.reasons.length) lines.push(`- check: ${b.reasons.join("; ")}`);
    for (const k of b.listingKeys) {
      const o = byKey.get(k);
      if (!o) continue;
      const price = opts.includePrices && o.listing.price !== null ? ` ${o.listing.price} ${o.listing.currency}` : "";
      lines.push(`- ${k} | ${o.listing.region} | ${o.listing.title}${price}`);
    }
    lines.push("- decision: [ ] approve group  [ ] reject group  [ ] split", "");
  }
  return lines.join("\n");
}

