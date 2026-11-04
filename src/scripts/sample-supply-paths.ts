#!/usr/bin/env node
/**
 * Picks ~25 distinct REAL products from this repo and records, per product, what is ALREADY KNOWN
 * (identifier readiness, prior human-review outcome, existing approved listings, existing KR/JP seller
 * URLs in the PoC CSV) and which acquisition path each market would use. OFFLINE: no network, no API,
 * no DB, no .env. It measures NOTHING about current prices or availability - every "measured" field is
 * the literal "NOT_MEASURED" until someone runs the listed CLI probes with real keys.
 *
 *   npx tsx src/scripts/sample-supply-paths.ts [--out=docs/supply-sample-products.json]
 *
 * Evidence classes kept apart on every row (never merged into one number):
 *   repo_data       identity/labels that exist in Git (REAL, but old human review - not today's prices)
 *   prior_review    scripts/candidate-data/matching-baseline.json: a human found an exact listing on EITHER
 *                   Rakuten OR Coupang ("exact") - it does NOT mean a KR+JP pair exists
 *   doc_derived     path chosen from the supplier research docs (grade B/U), not from a response
 *   NOT_MEASURED    live seller-level price/stock coverage
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRealRows, parseCsv, type Row } from "./run-listing-intake";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name: string, dflt: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;

/** quota per product type (sums to 26). Types are the repo's own; "beauty"/"diving" come from the code batches. */
export const QUOTA: Record<string, number> = {
  camera: 3, camera_lens: 3, earbuds: 2, headphones: 2, smartwatch: 2, dive_computer: 3, regulator: 2, bcd: 2, fins: 2, diving_mask: 1, dive_light: 1, wetsuit: 1, beauty: 2,
};

type Label = "exact" | "missing_source" | "ambiguous" | "accessory" | "wrong_category" | "variant_mismatch" | "bundle_condition_mismatch" | "none";
export interface Unified {
  key: string; title: string; type: string; brand: string | null; model: string | null; sources: string[];
  priorReview: Label; csvKrUrl: boolean; csvJpUrl: boolean; approvedJp: boolean; approvedKr: boolean;
}

const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const fnv = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

export function unify(rows: Row[], csvEvidence: Map<string, { kr: boolean; jp: boolean }>, approved: Array<{ productId: string; source: string }>): Unified[] {
  const by = new Map<string, Unified>();
  for (const r of rows) {
    const k = norm(r.title);
    const u = by.get(k) ?? { key: k, title: r.title, type: r.productType ?? "unknown", brand: null, model: null, sources: [], priorReview: "none" as Label, csvKrUrl: false, csvJpUrl: false, approvedJp: false, approvedKr: false };
    if (u.type === "unknown" && r.productType) u.type = r.productType;
    u.brand = u.brand ?? r.brand;
    u.model = u.model ?? r.model;
    if (!u.sources.includes(r.source)) u.sources.push(r.source);
    if (r.humanCategory) u.priorReview = r.humanCategory as Label;
    const ev = csvEvidence.get(k);
    if (ev) { u.csvKrUrl = ev.kr; u.csvJpUrl = ev.jp; }
    if (r.source === "code") {
      const id = r.id;
      u.approvedJp = approved.some((a) => a.productId === id && a.source === "rakuten");
      u.approvedKr = approved.some((a) => a.productId === id && a.source === "coupang");
      if (/^(skii|biore)/i.test(id)) u.type = "beauty";
    }
    by.set(k, u);
  }
  return [...by.values()];
}

/** Deterministic: within each type prefer products with a known model number (identity-capable), then a stable hash. */
export function select(all: Unified[], quota: Record<string, number>): Unified[] {
  const out: Unified[] = [];
  for (const [type, n] of Object.entries(quota)) {
    const pool = all.filter((u) => u.type === type).sort((a, b) => (Number(!!b.model) - Number(!!a.model)) || fnv(a.key) - fnv(b.key));
    // keep one without a model number when the type has any, so the sample is not only the easy cases
    const withModel = pool.filter((u) => u.model), without = pool.filter((u) => !u.model);
    const picked = [...withModel.slice(0, Math.max(1, n - (without.length ? 1 : 0))), ...without.slice(0, 1)].slice(0, n);
    for (const u of pool) if (picked.length < n && !picked.includes(u)) picked.push(u);
    out.push(...picked);
  }
  return out;
}

const DIVING = new Set(["dive_computer", "regulator", "bcd", "fins", "diving_mask", "dive_light", "wetsuit"]);
export function pathsFor(u: Unified): { jpDiscovery: string; jpSellerPrice: string; krSellerPrices: string; join: string; apiViability: string } {
  const niche = DIVING.has(u.type);
  return {
    jpDiscovery: "Rakuten Product Search (productNo/maker; roll-up price = discovery only, never a seller price)",
    jpSellerPrice: "Rakuten Ichiba Item Search (shop-level itemPrice/shopName/itemUrl/availability; existing adapter, grade A) | Yahoo Shopping v3 itemSearch [UNKNOWN: needs JP ID + commercial-use approval]",
    krSellerPrices: niche
      ? "Coupang Partners search (10 results, 1 marketplace listing) | 11st ProductSearch [UNKNOWN rights] | specialty KR shops seen in the PoC CSV have NO API -> merchant feed / manual only"
      : "Coupang Partners search (10 results) | 11st ProductSearch (multi-seller) [UNKNOWN rights]",
    join: u.model ? "brand + model number token (identity-capable); first mapping still a human decision" : "NO model number in repo: name-only link = weak evidence, always human review",
    apiViability: niche ? "doubtful: prior review shows many missing_source and KR/JP sellers are niche shops" : "plausible: mainstream electronics sold on Rakuten/Coupang/11st",
  };
}

function main() {
  const rows = loadRealRows();
  const csv = parseCsv(readFileSync(ROOT + "poc_products_10.csv", "utf8").replace(/^﻿/, ""));
  const csvEvidence = new Map<string, { kr: boolean; jp: boolean }>();
  for (const r of csv.slice(1)) if (r.length >= 8 && r[0]) csvEvidence.set(norm(r[3]), { kr: /^https?:/.test(r[5] ?? ""), jp: /^https?:/.test(r[6] ?? "") });
  const approved = JSON.parse(readFileSync(ROOT + "data/approved-mappings.json", "utf8")) as Array<{ productId: string; source: string }>;
  const all = unify(rows, csvEvidence, approved);
  const sample = select(all, QUOTA);

  const baselineByType: Record<string, { total: number; exact: number; missing: number }> = {};
  for (const u of all) {
    if (u.priorReview === "none") continue;
    const b = (baselineByType[u.type] ??= { total: 0, exact: 0, missing: 0 });
    b.total++; if (u.priorReview === "exact") b.exact++; if (u.priorReview === "missing_source") b.missing++;
  }
  const items = sample.map((u, i) => ({
    n: i + 1, type: u.type, title: u.title, brand: u.brand, modelNumber: u.model, realSources: u.sources,
    identifierReadiness: u.model ? "MODEL_KNOWN" : "NAME_ONLY",
    priorHumanReview_eitherSide: u.priorReview,
    csvSellerUrls: { kr: u.csvKrUrl, jp: u.csvJpUrl },
    approvedListingInRepo: { jp: u.approvedJp, kr: u.approvedKr },
    plannedPaths: pathsFor(u),
    liveProbe: { rakuten: `npx tsx src/cli/index.ts search-rakuten --keyword="${u.title}"`, coupang: `npx tsx src/cli/index.ts search-coupang --keyword="${u.title}"` },
    measured: { jpSellerLevelPrice: "NOT_MEASURED", krSellerLevelPrice: "NOT_MEASURED", sameProductKrJpPair: "NOT_MEASURED" },
  }));
  const summary = {
    note: "offline: what the repo already knows + chosen paths. NO live price/stock coverage was measured.",
    poolUniqueRealProducts: all.length, sampleSize: items.length,
    sampleByType: Object.fromEntries(Object.keys(QUOTA).map((t) => [t, items.filter((i) => i.type === t).length])),
    modelKnown: items.filter((i) => i.identifierReadiness === "MODEL_KNOWN").length,
    nameOnly: items.filter((i) => i.identifierReadiness === "NAME_ONLY").length,
    withPriorExactEitherSide: items.filter((i) => i.priorHumanReview_eitherSide === "exact").length,
    withKrAndJpSellerUrlInCsv: items.filter((i) => i.csvSellerUrls.kr && i.csvSellerUrls.jp).length,
    withApprovedListingInRepo: items.filter((i) => i.approvedListingInRepo.jp || i.approvedListingInRepo.kr).length,
    priorReviewByTypeAcrossWholePool_eitherSide: baselineByType,
  };
  const json = JSON.stringify({ summary, items }, null, 2);
  console.log(json);
  const out = arg("out", "");
  if (out) writeFileSync(ROOT + out, json + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("sample-supply-paths.ts")) main();
