#!/usr/bin/env node
/**
 * Offline experiment runner for the multi-provider intake pipeline
 * (services/listingIntakeService.ts). NO network, NO provider API, NO DB,
 * NO writes except the optional --out report file.
 *
 *   npx tsx src/scripts/run-listing-intake.ts [--synthetic-models=400] [--big-models=3000] [--out=docs/listing-intake-experiment-results.md]
 *
 * Three clearly separated experiments (their numbers must never be added up
 * or reported as one "product count"):
 *
 *   E1  REAL repo data  - the catalog/candidate product identities that exist
 *       in Git (matching-baseline, seed, pilot, CSV, products.ts,
 *       mainstreamBatch1, approved-mappings). These rows carry NO provider
 *       price/stock/listing text (the raw review.json listing results live
 *       outside Git), so E1 can measure identity-level behaviour (dedupe,
 *       model identification, catalog self-consistency, approved-state
 *       preservation) but NOT listing-level precision.
 *   E2  SYNTHETIC listings over the REAL catalog identities - templated
 *       provider titles with ground truth, incl. adversarial siblings
 *       (e.g. real "Nikon Z5" vs "Nikon Z5II" neighbours). Wrong matches are
 *       counted here against ground truth.
 *   E3  FULLY SYNTHETIC scale test (fabricated brands/models, thousands of
 *       listings): throughput + re-run/incremental determinism only.
 *
 * Only aggregate counts are printed/written. No external price value from any
 * repo file (approved-mappings lastKnownPrice etc.) is read into the report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UNKNOWN, mapGenericRow, listingKey, type ProviderBatch, type ProviderListing } from "../domain/providerListing";
import { PRODUCT_TYPE_ALIASES, isProductType, type ProductType } from "../domain/searchAliases";
import { runIntake, type ApprovedListingRef, type CatalogEntry, type IntakeResult } from "../services/listingIntakeService";
import { divingBatch1 } from "../products";
import { mainstreamBatch1 } from "../mainstreamBatch1";
import { fabricateCatalog, generateListings, mulberry32, type Truth } from "./lib/syntheticListings";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(ROOT + rel, "utf8")) as T;
const arg = (name: string, dflt: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;

// ---------------------------------------------------------------------
// E1: real candidate identities in the repo
// ---------------------------------------------------------------------
export interface Row { source: string; id: string; title: string; brand: string | null; model: string | null; productType: ProductType | null; humanCategory?: string }

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const skuLike = (s: string): string | null => {
  const m = /^([A-Za-z0-9-]{3,14})(?:[\s(].*)?$/.exec(s.trim());
  return m && /\d/.test(m[1]) && !/계열/.test(s) ? m[1] : null;
};
const typeFromKorean = (cat: string): ProductType | null => {
  for (const [k, v] of Object.entries(PRODUCT_TYPE_ALIASES)) if (cat.replace(/\s/g, "").includes(k.replace(/\s/g, ""))) return v[0];
  return null;
};

export function loadRealRows(): Row[] {
  const rows: Row[] = [];
  const baseline = readJson<Array<{ file: string; index: number; productType: string; productName: string; category: string }>>("src/scripts/candidate-data/matching-baseline.json");
  for (const b of baseline) rows.push({ source: "baseline", id: `${b.file}#${b.index}`, title: b.productName, brand: null, model: null, productType: isProductType(b.productType) ? b.productType : null, humanCategory: b.category });
  const seed = readJson<Array<{ productName: string; brand?: string; productType: string; modelSkuHint?: string | null }>>("src/scripts/candidate-data/camera-candidates.seed.json");
  seed.forEach((s, i) => rows.push({ source: "seed", id: String(i), title: s.productName, brand: s.brand ?? null, model: s.modelSkuHint && skuLike(s.modelSkuHint) ? s.modelSkuHint : null, productType: isProductType(s.productType) ? s.productType : null }));
  const pilot = readJson<{ entries: Array<{ productName: string; variantId: string; productType: string }> }>("docs/pilot-camera-lens-2026-09.json").entries;
  for (const p of pilot) rows.push({ source: "pilot", id: p.variantId, title: p.productName, brand: null, model: null, productType: isProductType(p.productType) ? p.productType : null });
  const csv = parseCsv(readFileSync(ROOT + "poc_products_10.csv", "utf8").replace(/^﻿/, ""));
  csv.slice(1).filter((r) => r.length >= 5 && r[0]).forEach((r, i) => rows.push({ source: "csv", id: String(i), title: r[3], brand: r[2] || null, model: skuLike(r[4] ?? ""), productType: typeFromKorean(r[1]) }));
  for (const p of divingBatch1) rows.push({ source: "code", id: p.product.id, title: p.product.officialName, brand: p.product.brand, model: p.product.modelSku && skuLike(p.product.modelSku) ? p.product.modelSku : null, productType: null });
  for (const p of mainstreamBatch1) rows.push({ source: "code", id: p.product.id, title: p.product.officialName, brand: p.product.brand, model: p.product.modelSku && skuLike(p.product.modelSku) ? p.product.modelSku : null, productType: null });
  return rows;
}

const normTitle = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const rowToListing = (r: Row): ProviderListing => {
  const m = mapGenericRow("repo-catalog", { id: `${r.source}:${r.id}`, title: r.title, brand: r.brand ?? undefined, model: r.model ?? undefined, productType: r.productType ?? undefined }, { usageRights: "granted" });
  if (!m.ok) throw new Error(m.error);
  return m.listing;
};
const asBatch = (provider: string, listings: ProviderListing[]): ProviderBatch => ({ provider, ok: true, listings, malformed: 0 });

interface E1Report {
  rows: number; bySource: Record<string, number>; duplicatesRemoved: number; unique: number;
  noCatalog: { explicit: number; titleCode: number; none: number; rate: number };
  selfCatalog: { linkedToOwn: number; linkedToOther: number; ambiguousCatalogMatch: number; notLinked: number; byLink: Record<string, number> };
  ambiguousNames: string[]; wrongLinks: string[]; codeCollisions: string[];
  approved: { refs: number; unresolvedIds: string[]; resolvedToCatalog: number; autoRefresh: number; review: number; other: number };
  humanLabels: Record<string, number>; actions: Record<string, number>;
}

export function runE1(): { report: E1Report; catalog: CatalogEntry[] } {
  const rows = loadRealRows();
  const bySource: Record<string, number> = {};
  rows.forEach((r) => (bySource[r.source] = (bySource[r.source] ?? 0) + 1));
  const listings = rows.map(rowToListing);

  // Pass A - no catalog: what can be identified from the candidate's own data?
  const a = runIntake([asBatch("repo-catalog", listings)], { catalog: [] });
  const survivorsA = a.outcomes.filter((o) => o.action !== "AUTO_DROP");
  const unique = survivorsA.length;
  const explicit = survivorsA.filter((o) => o.modelSource === "explicit_code").length;
  const titleCode = survivorsA.filter((o) => o.modelSource === "title_code").length;
  // collisions: distinct normalised titles that resolve to the same (brand-or-first-token, code)
  const groups = new Map<string, Set<string>>();
  for (const o of survivorsA) {
    if (!o.modelCode) continue;
    const brand = o.listing.manufacturer !== UNKNOWN ? o.listing.manufacturer.toLowerCase() : o.listing.title.split(/\s+/)[0].toLowerCase();
    const k = `${brand}|${o.modelCode.toUpperCase().replace(/[-\s]/g, "")}`;
    (groups.get(k) ?? groups.set(k, new Set()).get(k)!).add(normTitle(o.listing.title));
  }
  const codeCollisions = [...groups.entries()].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}: ${[...v].join(" || ")}`);

  // Pass B - catalog = de-duplicated real identities (first occurrence per title). Brand = first token (heuristic, catalog-side only).
  const seen = new Map<string, CatalogEntry>();
  const ownVariant = new Map<string, string>();
  rows.forEach((r, i) => {
    const k = normTitle(r.title);
    if (!seen.has(k)) {
      const brand = r.brand ?? r.title.split(/\s+/)[0];
      seen.set(k, { variantId: `real:${r.source}:${r.id}`, productType: r.productType ?? UNKNOWN, brand, name: r.title, modelSku: r.model });
    }
    ownVariant.set(listings[i].externalId, seen.get(k)!.variantId);
  });
  const catalog = [...seen.values()];
  const b = runIntake([asBatch("repo-catalog", listings)], { catalog });
  let own = 0, other = 0, amb = 0, none = 0;
  const wrong: string[] = [], ambiguous: string[] = [];
  const byLink: Record<string, number> = {};
  for (const o of b.outcomes.filter((x) => x.action !== "AUTO_DROP")) {
    const expected = ownVariant.get(o.listing.externalId);
    byLink[o.modelSource] = (byLink[o.modelSource] ?? 0) + 1;
    if (o.reasons[0] === "ambiguous_catalog_match") { amb++; ambiguous.push(o.listing.title); }
    else if (o.variantId === null) none++;
    else if (o.variantId === expected) own++;
    else { other++; wrong.push(`${o.listing.title} -> ${catalog.find((c) => c.variantId === o.variantId)?.name}`); }
  }

  // Approved mappings: structure check - do real approvals resolve to catalog entries and survive as AUTO_REFRESH?
  const mappings = readJson<Array<{ productId: string; source: string; externalId: string }>>("data/approved-mappings.json");
  const codeIds = new Map(catalog.filter((c) => c.variantId.startsWith("real:code:")).map((c) => [c.variantId.slice("real:code:".length), c]));
  const approved: ApprovedListingRef[] = [];
  const approvedListings: ProviderListing[] = [];
  let resolved = 0;
  for (const m of mappings) {
    const entry = codeIds.get(m.productId);
    if (entry) resolved++;
    approved.push({ provider: m.source, externalId: m.externalId, variantId: entry?.variantId ?? `unresolved:${m.productId}`, region: m.source === "rakuten" ? "JP" : m.source === "coupang" ? "KR" : UNKNOWN });
    // structure check only: a placeholder price stands in for the refresh value (the real lastKnownPrice is deliberately never read)
    const r = mapGenericRow(m.source, { id: m.externalId, title: entry?.name ?? m.productId, price: 1, currency: m.source === "rakuten" ? "JPY" : m.source === "coupang" ? "KRW" : undefined }, { usageRights: "granted", priceBasis: "seller_listing" });
    if (r.ok) approvedListings.push(r.listing);
  }
  const ap = runIntake([asBatch("approvals", approvedListings)], { catalog, approved });
  const humanLabels: Record<string, number> = {};
  rows.filter((r) => r.source === "baseline").forEach((r) => (humanLabels[r.humanCategory!] = (humanLabels[r.humanCategory!] ?? 0) + 1));

  return {
    catalog,
    report: {
      rows: rows.length, bySource, duplicatesRemoved: a.stats.duplicateExact + a.stats.duplicateIdChange, unique,
      noCatalog: { explicit, titleCode, none: unique - explicit - titleCode, rate: (explicit + titleCode) / unique },
      selfCatalog: { linkedToOwn: own, linkedToOther: other, ambiguousCatalogMatch: amb, notLinked: none, byLink },
      ambiguousNames: ambiguous, wrongLinks: wrong, codeCollisions,
      approved: { refs: mappings.length, unresolvedIds: mappings.filter((m) => !codeIds.has(m.productId)).map((m) => m.productId), resolvedToCatalog: resolved, autoRefresh: ap.stats.actions.AUTO_REFRESH, review: ap.stats.actions.REVIEW, other: ap.stats.actions.HOLD + ap.stats.actions.AUTO_DROP },
      humanLabels, actions: a.stats.actions,
    },
  };
}

// ---------------------------------------------------------------------
// E2/E3: evaluation against synthetic ground truth
// ---------------------------------------------------------------------
interface Eval {
  listings: number; collapsedDuplicates: number; malformedItems: number; trueMatchTotal: number;
  correct: number; successRate: number;
  wrongMatches: { trueMatchWrongVariant: number; siblingLinked: number; accessoryOrUsedReviewed: number; rightsUnknownReviewed: number; total: number };
  falseRejects: number; missedTrueMatch: number; missedReasons: Record<string, number>;
  trueMatchRecall: number; strongBatches: number; weakBatches: number;
  actions: Record<string, number>; reviewHoldRatio: string; reviewBatches: number; reviewListings: number; humanDecisionReduction: string;
  newProductBatchesFromSiblings: number;
}

function evaluate(res: IntakeResult, truth: Map<string, Truth>, collapsed: number): Eval {
  let correct = 0, tmTotal = 0, tmOk = 0, wrongVar = 0, sibLink = 0, accReview = 0, rightsReview = 0, falseRej = 0, missed = 0, scored = 0;
  const missedReasons: Record<string, number> = {};
  for (const o of res.outcomes) {
    const t = truth.get(o.key);
    if (!t) continue;
    scored++;
    const reviewed = o.action === "REVIEW";
    switch (t.kind) {
      case "true_match":
        tmTotal++;
        if (reviewed && o.variantId === t.variantId) { tmOk++; correct++; }
        else if (reviewed && o.variantId !== t.variantId) wrongVar++;
        else if (o.action === "AUTO_DROP") falseRej++;
        else { missed++; const r = o.reasons[0].split(":")[0]; missedReasons[r] = (missedReasons[r] ?? 0) + 1; }
        break;
      case "accessory": case "used": if (o.action === "AUTO_DROP") correct++; else if (reviewed) accReview++; break;
      case "dup": if (o.action === "AUTO_DROP") correct++; break;
      case "sibling": if (o.variantId === null) correct++; else sibLink++; break;
      case "rights_unknown": if (o.action === "HOLD" && o.reasons[0] === "rights_unverified") correct++; else if (reviewed) rightsReview++; break;
      case "out_of_stock": if (o.action !== "AUTO_DROP" && o.variantId === t.variantId) correct++; break;
    }
  }
  const sibBatches = res.reviewBatches.filter((b) => b.kind === "new_product").length;
  const { actions } = res.stats;
  const human = actions.REVIEW;
  return {
    listings: res.outcomes.length, collapsedDuplicates: collapsed, malformedItems: res.stats.malformedItems, trueMatchTotal: tmTotal,
    correct, successRate: correct / scored,
    wrongMatches: { trueMatchWrongVariant: wrongVar, siblingLinked: sibLink, accessoryOrUsedReviewed: accReview, rightsUnknownReviewed: rightsReview, total: wrongVar + sibLink + accReview + rightsReview },
    falseRejects: falseRej, missedTrueMatch: missed, missedReasons, trueMatchRecall: tmTotal ? tmOk / tmTotal : 0,
    strongBatches: res.reviewBatches.filter((b) => b.evidence === "strong").length, weakBatches: res.reviewBatches.filter((b) => b.evidence === "weak").length,
    actions, reviewHoldRatio: `${actions.REVIEW}:${actions.HOLD}`, reviewBatches: res.reviewBatches.length, reviewListings: human,
    humanDecisionReduction: human ? `${human} one-by-one decisions -> ${res.reviewBatches.length} batch decisions (${(human / Math.max(1, res.reviewBatches.length)).toFixed(2)}x)` : "n/a",
    newProductBatchesFromSiblings: sibBatches,
  };
}

function runSynthetic(catalog: CatalogEntry[], seed: number) {
  const data = generateListings(catalog, { seed });
  const providers = ["jp-feed", "kr-feed", "intl-feed", "mystery-feed"];
  // injected unreadable payload items go through the real mapper and must all be rejected (counted as malformed, never ingested)
  const rejectedMalformed = data.malformedRaw.filter((r) => !mapGenericRow("jp-feed", r).ok).length;
  const batches: ProviderBatch[] = providers.map((p) => ({ ...asBatch(p, data.listings.filter((l) => l.provider === p)), malformed: p === "jp-feed" ? rejectedMalformed : 0 }) as ProviderBatch);
  const ctx = { catalog, providerRights: data.providerRights };
  const t0 = process.hrtime.bigint();
  const res = runIntake(batches, ctx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const incoming = data.listings.length;
  const ev = evaluate(res, data.truth, res.stats.duplicateExact + res.stats.duplicateIdChange);
  // determinism: re-run with its own snapshot -> identical; incremental: halves in 2 runs == one run
  const sig = (r: IntakeResult) => JSON.stringify([r.outcomes.map((o) => [o.key, o.action, o.reasons, o.variantId]), r.reviewBatches.map((b) => [b.id, b.listingKeys, b.evidence])]);
  const again = runIntake([], { ...ctx, previousSnapshot: res.snapshot });
  const half = Math.floor(data.listings.length / 2);
  const h1 = runIntake(providers.map((p) => asBatch(p, data.listings.slice(0, half).filter((l) => l.provider === p))), ctx);
  const h2 = runIntake(providers.map((p) => asBatch(p, data.listings.slice(half).filter((l) => l.provider === p))), { ...ctx, previousSnapshot: h1.snapshot });
  // failure injection: every provider fails on a later run -> state fully preserved
  const failedRun = runIntake(providers.map((p) => ({ provider: p, ok: false as const, error: "http_503" })), { ...ctx, previousSnapshot: res.snapshot });
  // unreadable raw payloads are rejected, not ingested
  const bad = data.malformedRaw.length;
  return {
    incoming, ms, perSecond: Math.round(incoming / (ms / 1000)), ev, malformedInjected: bad, malformedRejected: rejectedMalformed,
    rerunIdentical: sig(again) === sig(res), incrementalEqualsSingleRun: sig(h2) === sig(res), failureRunPreservesAll: sig(failedRun) === sig(res),
  };
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
function main() {
  const e1 = runE1();
  const e2 = runSynthetic(e1.catalog, 20261103);
  const nSmall = Number(arg("synthetic-models", "400"));
  const nBig = Number(arg("big-models", "3000"));
  const e3a = runSynthetic(fabricateCatalog(nSmall, mulberry32(7)), 11);
  const e3b = runSynthetic(fabricateCatalog(nBig, mulberry32(8)), 12);

  const out = { e1: e1.report, e2: { catalogEntries: e1.catalog.length, ...e2 }, e3a: { models: nSmall, ...e3a }, e3b: { models: nBig, ...e3b } };
  const json = JSON.stringify(out, null, 2);
  console.log(json);
  const outPath = arg("out", "");
  if (outPath) writeFileSync(ROOT + outPath, json + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("run-listing-intake.ts")) main();
void listingKey;
