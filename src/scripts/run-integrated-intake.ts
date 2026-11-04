#!/usr/bin/env node
/**
 * Integration experiment: supplier rows (data-sources branch adapter/seed code)
 * -> candidate listings (bridge) -> normalisation + matching + review triage
 * (multi-source intake pipeline). OFFLINE: no network, no provider API, no DB,
 * no .env/secret read, no writes except the optional --out report.
 *
 *   npx tsx src/scripts/run-integrated-intake.ts [--big-models=3000] [--out=docs/integrated-intake-results.json]
 *
 * Sections are reported separately and must never be added up:
 *   REAL       the product identities that exist in Git (run-listing-intake's E1).
 *              They carry no supplier price/stock rows, so this proves identity
 *              handling only - it is NOT a count of purchasable products.
 *   SYNTHETIC  fabricated supplier rows for those REAL identities (templated
 *              Rakuten Product Search responses + Coupang items, with ground
 *              truth incl. adversarial siblings) -> exercises the whole A->B flow.
 *   SYNTHETIC-SCALE  fully fabricated brands/models: throughput + determinism.
 *
 * What is REAL code here: A's parseProductSearchResponse / buildSeedBatch, the
 * bridge mapRakutenProduct, B's mapCoupangProduct / runIntake. What is not
 * real: the supplier payloads (fabricated, "example.invalid" URLs, arbitrary
 * prices) and the "granted" usage rights, which only declares a test fixture.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listingKey, mapCoupangProduct, buildProviderBatch, type ProviderBatch } from "../domain/providerListing";
import { parseProductSearchResponse, type RakutenProduct } from "../adapters/rakutenProduct";
import { runIntake, BRAND_SYNONYMS, type CatalogEntry, type IntakeResult } from "../services/listingIntakeService";
import { buildRakutenProductBatch, RAKUTEN_PRODUCT_PROVIDER } from "../services/rakutenProductIntake";
import { buildSeedBatch } from "./seed-catalog-from-rakuten";
import { fabricateCatalog, mulberry32 } from "./lib/syntheticListings";
import { runE1 } from "./run-listing-intake";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name: string, dflt: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;

type Kind = "true_match" | "accessory" | "used" | "sibling" | "no_price" | "out_of_stock" | "title_only";
interface Truth { kind: Kind; variantId: string | null }

const localBrand = (brand: string, lang: "ja" | "ko"): string => {
  const syn = BRAND_SYNONYMS[brand.toLowerCase()];
  if (!syn) return brand;
  return (lang === "ja" ? syn.find((s) => /[぀-ヿ一-鿿]/.test(s)) : syn.find((s) => /[가-힣]/.test(s))) ?? brand;
};

interface Supplier {
  /** Product Search response pages in the documented formatVersion=2 shape (raw, un-parsed) */
  rakutenPages: Array<Record<string, unknown>>;
  coupangRaw: Array<Record<string, unknown>>;
  truth: Map<string, Truth>;
  typeByProductId: Map<string, string>;
  skuLessEntries: number;
  malformedInjected: number;
}

/** Fabricated supplier payloads for `catalog`. Only entries that have a model number can be matched by code; the rest are counted, not faked. */
function fabricateSupplier(catalog: CatalogEntry[], seed: number, noise = 0.35): Supplier {
  const rand = mulberry32(seed);
  const rows: Array<Record<string, unknown>> = [];
  const coupangRaw: Array<Record<string, unknown>> = [];
  const truth = new Map<string, Truth>();
  const typeByProductId = new Map<string, string>();
  let krId = 1_000_000;
  let malformed = 0;
  let skuLess = 0;
  const jp = (id: string, e: CatalogEntry, over: Record<string, unknown>, t: Truth) => {
    rows.push({ productId: id, productName: `${localBrand(e.brand, "ja")} ${e.name} ボディ`, productNo: e.modelSku, makerName: localBrand(e.brand, "ja"), salesMinPrice: 100000 + id.length * 13, salesItemCount: 1 + (id.length % 7), productUrlPC: `https://example.invalid/${id}`, ...over });
    truth.set(`${RAKUTEN_PRODUCT_PROVIDER}|${id}`, t);
    typeByProductId.set(id, e.productType === "UNKNOWN" ? "camera" : e.productType);
  };
  const kr = (e: CatalogEntry, name: string, t: Truth) => {
    const id = krId++;
    coupangRaw.push({ productId: id, productName: name, productPrice: 1_000_000 + (id % 997), productUrl: `https://example.invalid/c${id}`, isRocket: false, isFreeShipping: false, productImage: "", rank: 1, keyword: "x" });
    truth.set(`coupang|${id}`, t);
  };
  catalog.forEach((e, i) => {
    const sku = e.modelSku;
    if (!sku) { skuLess++; return; }
    const tm: Truth = { kind: "true_match", variantId: e.variantId };
    jp(`jp-${i}`, e, {}, tm);
    kr(e, `${localBrand(e.brand, "ko")} ${e.name} 바디`, tm);
    if (rand() < noise) jp(`jp-acc-${i}`, e, { productName: `${localBrand(e.brand, "ja")} ${e.name} 専用 ケース カバー` }, { kind: "accessory", variantId: null });
    if (rand() < noise) jp(`jp-used-${i}`, e, { productName: `【中古】${localBrand(e.brand, "ja")} ${e.name} ボディ` }, { kind: "used", variantId: null });
    if (rand() < noise) {
      const sib = `${sku}W`;
      const sibName = e.name.includes(sku) ? e.name.replace(sku, sib) : `${e.name} ${sib}`;
      jp(`jp-sib-${i}`, e, { productNo: sib, productName: `${localBrand(e.brand, "ja")} ${sibName} ボディ` }, { kind: "sibling", variantId: null });
      kr(e, `${localBrand(e.brand, "ko")} ${sibName} 바디`, { kind: "sibling", variantId: null });
    }
    if (rand() < noise) jp(`jp-np-${i}`, e, { productId: `jp-np-${i}`, salesMinPrice: "" }, { kind: "no_price", variantId: null });
    if (rand() < noise / 2) jp(`jp-oos-${i}`, e, { salesItemCount: 0 }, { kind: "out_of_stock", variantId: e.variantId });
    if (rand() < noise / 2) jp(`jp-to-${i}`, e, { productNo: null, makerName: null, productName: `${e.name} ${sku}` }, { kind: "title_only", variantId: e.variantId });
    if (rand() < noise / 4) { rows.push(rand() < 0.5 ? { productName: `no-id-${i}` } : { productId: `no-name-${i}` }); malformed++; }
  });
  // pages of at most 30 rows, as the real API would return them
  const rakutenPages: Array<Record<string, unknown>> = [];
  for (let p = 0; p * 30 < rows.length; p++) rakutenPages.push({ Products: rows.slice(p * 30, p * 30 + 30), count: rows.length, page: p + 1, pageCount: Math.ceil(rows.length / 30), hits: 30 });
  return { rakutenPages, coupangRaw, truth, typeByProductId, skuLessEntries: skuLess, malformedInjected: malformed };
}

function evaluate(res: IntakeResult, truth: Map<string, Truth>) {
  const c = { scored: 0, correct: 0, trueMatch: 0, trueMatchReviewedRight: 0, trueMatchWrongVariant: 0, trueMatchHeld: 0, trueMatchDropped: 0, siblingLinked: 0, junkReviewed: 0, noPriceNotHeld: 0, oosDropped: 0, titleOnlyWrong: 0, titleOnlyReview: 0 };
  const heldReasons: Record<string, number> = {};
  for (const o of res.outcomes) {
    const t = truth.get(o.key);
    if (!t) continue;
    c.scored++;
    const review = o.action === "REVIEW";
    if (t.kind === "true_match") {
      c.trueMatch++;
      if (review && o.variantId === t.variantId) { c.trueMatchReviewedRight++; c.correct++; }
      else if (review) c.trueMatchWrongVariant++;
      else if (o.action === "AUTO_DROP") c.trueMatchDropped++;
      else { c.trueMatchHeld++; heldReasons[o.reasons[0].split(":")[0]] = (heldReasons[o.reasons[0].split(":")[0]] ?? 0) + 1; }
    } else if (t.kind === "accessory" || t.kind === "used") { if (o.action === "AUTO_DROP") c.correct++; else if (review) c.junkReviewed++; }
    else if (t.kind === "sibling") { if (o.variantId === null) c.correct++; else c.siblingLinked++; }
    else if (t.kind === "no_price") { if (o.action === "HOLD" && o.reasons[0] === "no_price") c.correct++; else c.noPriceNotHeld++; }
    else if (t.kind === "out_of_stock") { if (o.action === "AUTO_DROP") c.oosDropped++; else c.correct++; }
    else if (t.kind === "title_only") { if (review) { c.titleOnlyReview++; if (o.variantId !== null && o.variantId !== t.variantId) c.titleOnlyWrong++; } c.correct += review && o.variantId !== null && o.variantId !== t.variantId ? 0 : 1; }
  }
  const wrong = c.trueMatchWrongVariant + c.siblingLinked + c.junkReviewed + c.noPriceNotHeld + c.titleOnlyWrong + c.oosDropped;
  return { ...c, wrongOutcomes: wrong, trueMatchRecallPct: c.trueMatch ? Math.round((c.trueMatchReviewedRight / c.trueMatch) * 1000) / 10 : 0, heldReasonsForTrueMatches: heldReasons };
}

function runFlow(catalog: CatalogEntry[], seed: number) {
  const s = fabricateSupplier(catalog, seed);

  // --- supplier -> candidates (A's real parser) ---
  const parsed: RakutenProduct[] = s.rakutenPages.flatMap((page) => parseProductSearchResponse(page).products);
  const rawRows = s.rakutenPages.reduce((n, p) => n + (p.Products as unknown[]).length, 0);

  // --- A's seed builder over the same rows, per product type (what A would hand to evaluate-candidates) ---
  const byType = new Map<string, RakutenProduct[]>();
  for (const p of parsed) (byType.get(s.typeByProductId.get(p.productId ?? "") ?? "camera") ?? byType.set(s.typeByProductId.get(p.productId ?? "") ?? "camera", []).get(s.typeByProductId.get(p.productId ?? "") ?? "camera")!).push(p);
  let seeds = 0, seedsKnownInCatalog = 0, seedRejected = 0;
  const knownSku = new Set(catalog.map((c) => (c.modelSku ?? "").toUpperCase()).filter(Boolean));
  for (const [type, rows] of byType) {
    const b = buildSeedBatch(rows, type);
    seeds += b.seeds.length; seedRejected += b.rejected.length;
    seedsKnownInCatalog += b.seeds.filter((x) => knownSku.has((x.modelSkuHint ?? "").toUpperCase())).length;
  }

  // --- bridge + B's pipeline ---
  const GRANTED = { usageRights: "granted" as const, fetchedAt: "2026-11-04T00:00:00Z" };
  const jpBatch = buildRakutenProductBatch(parsed, GRANTED);
  const krBatch: ProviderBatch = buildProviderBatch("coupang", s.coupangRaw, (x) => mapCoupangProduct(x, GRANTED));
  const batches = [jpBatch, krBatch];
  const ctx = { catalog };
  const t0 = process.hrtime.bigint();
  const res = runIntake(batches, ctx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const sig = (r: IntakeResult) => JSON.stringify([r.outcomes.map((o) => [o.key, o.action, o.reasons, o.variantId]), r.reviewBatches.map((b) => [b.id, b.listingKeys, b.evidence])]);
  const again = runIntake([], { ...ctx, previousSnapshot: res.snapshot });
  // safety: rights not declared -> nothing may reach REVIEW
  const noRightsBatches = [buildRakutenProductBatch(parsed), buildProviderBatch("coupang", s.coupangRaw, (x) => mapCoupangProduct(x))];
  const noRights = runIntake(noRightsBatches, ctx);
  // safety: Rakuten page fetch fails entirely -> previous state kept, nothing dropped
  const jpFailed = runIntake([{ provider: RAKUTEN_PRODUCT_PROVIDER, ok: false, error: "http_503" }, krBatch], { ...ctx, previousSnapshot: res.snapshot });
  const keysOf = (r: IntakeResult, a: string) => r.outcomes.filter((o) => o.action === a).length;

  return {
    funnel: {
      catalogEntries: catalog.length,
      catalogEntriesWithoutModelNumber: s.skuLessEntries,
      supplierRowsRakuten: rawRows,
      supplierRowsCoupang: s.coupangRaw.length,
      malformedInjected: s.malformedInjected,
      rakutenParsedByAdapter: parsed.length,
      rakutenMalformedRejectedByBridge: jpBatch.ok ? jpBatch.malformed : -1,
      aSeedsBuilt: seeds, aSeedsRejected: seedRejected, aSeedsAlreadyInCatalog: seedsKnownInCatalog,
      listingsIntoPipeline: res.stats.input,
      uniqueAfterDedupe: res.stats.unique,
    },
    actions: res.stats.actions,
    modelSource: res.stats.modelSource,
    reviewBatches: { total: res.stats.reviewBatches, strong: res.reviewBatches.filter((b) => b.evidence === "strong").length, weak: res.reviewBatches.filter((b) => b.evidence === "weak").length, comparableGroups: res.stats.comparableGroups, reviewListings: res.stats.reviewListings },
    evaluation: evaluate(res, s.truth),
    safety: {
      autoApprovedOrRefreshedWithoutHumanApproval: keysOf(res, "AUTO_REFRESH"),
      rightsUndeclared_reviewListings: noRights.stats.actions.REVIEW,
      rightsUndeclared_hold: noRights.stats.actions.HOLD,
      rakutenFailure_carriedOver: jpFailed.outcomes.filter((o) => o.carriedOver).length,
      rakutenFailure_stateIdentical: sig(jpFailed) === sig(res),
      rerunIdentical: sig(again) === sig(res),
    },
    perf: { ms: Math.round(ms), listingsPerSecond: Math.round(res.stats.input / (ms / 1000)) },
  };
}

function main() {
  const e1 = runE1();
  const real = {
    note: "identities only (no supplier price/stock in Git); NOT a purchasable-product count",
    rows: e1.report.rows, bySource: e1.report.bySource, uniqueIdentities: e1.report.unique,
    identifiedWithoutCatalog: e1.report.noCatalog, selfCatalog: { ...e1.report.selfCatalog, byLink: e1.report.selfCatalog.byLink },
    approvedMappings: e1.report.approved,
  };
  const synthetic = { note: "fabricated Rakuten Product Search + Coupang payloads over the REAL catalog identities", ...runFlow(e1.catalog, 20261104) };
  const nBig = Number(arg("big-models", "3000"));
  const scale = { note: "fully fabricated brands/models", models: nBig, ...runFlow(fabricateCatalog(nBig, mulberry32(8)), 31) };
  const out = { real, synthetic, syntheticScale: scale };
  const json = JSON.stringify(out, null, 2);
  console.log(json);
  const outPath = arg("out", "");
  if (outPath) writeFileSync(ROOT + outPath, json + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("run-integrated-intake.ts")) main();
void listingKey;
