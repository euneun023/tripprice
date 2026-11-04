/**
 * Safety/behavior checks for the multi-provider intake pipeline
 * (listingIntakeService.ts + domain/providerListing.ts). No test runner is
 * configured in this repo - run directly:
 *   npx tsx src/services/listingIntakeService.test.ts
 * Exits non-zero on any failure. Pure in-memory tests, no network/DB/files.
 *
 * Titles are modelled on listing styles already quoted in the existing
 * negativeFilter/identifierMatch tests and docs (Rakuten JP / Coupang KR
 * wording); prices here are arbitrary test numbers.
 */
import {
  UNKNOWN,
  buildProviderBatch,
  extractAttributes,
  mapCoupangProduct,
  mapGenericRow,
  mapRakutenItem,
  type ProviderBatch,
  type ProviderListing,
} from "../domain/providerListing";
import { runIntake, extractModelCodes, renderReviewWorklist, type ApprovedListingRef, type CatalogEntry, type IntakeContext } from "./listingIntakeService";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const GRANTED = { usageRights: "granted" as const, priceBasis: "seller_listing" as const, fetchedAt: "2026-11-01T00:00:00Z" };

const catalog: CatalogEntry[] = [
  { variantId: "v-a1m2", productType: "camera", brand: "Sony", name: "Sony α1 II", modelSku: "ILCE-1M2" },
  { variantId: "v-z8", productType: "camera", brand: "Nikon", name: "Nikon Z8", modelSku: "Z8" },
  { variantId: "v-s5m2", productType: "camera", brand: "Panasonic", name: "Panasonic LUMIX S5II", modelSku: "DC-S5M2" },
  { variantId: "v-lens", productType: "camera_lens", brand: "Sony", name: "Sony FE 24-70mm F2.8 GM II", modelSku: "SEL2470GM2", attributes: { mount: "sony_e" } },
  { variantId: "v-tam-e", productType: "camera_lens", brand: "Tamron", name: "Tamron 17-50mm F4 (Sony E)", modelSku: "A068", attributes: { mount: "sony_e" } },
  { variantId: "v-nolens", productType: "camera_lens", brand: "Tamron", name: "Tamron 28-75mm F2.8 G2", modelSku: "A063" },
  { variantId: "v-xm5", productType: "earbuds", brand: "Sony", name: "Sony WF-1000XM5", modelSku: "WF-1000XM5" },
  { variantId: "v-zve10", productType: "camera", brand: "Sony", name: "Sony ZV-E10", modelSku: "ZV-E10" },
  { variantId: "v-a1", productType: "camera", brand: "Sony", name: "Sony α1 II", modelSku: null },
  { variantId: "v-r5", productType: "camera", brand: "Canon", name: "Canon EOS R5", modelSku: null },
  { variantId: "v-r5m2", productType: "camera", brand: "Canon", name: "Canon EOS R5 Mark II", modelSku: null },
];

let seq = 0;
function jp(title: string, extra: Record<string, unknown> = {}, price = 200000): ProviderListing {
  const r = mapGenericRow("jp-feed", { id: `jp-${++seq}`, title, price, currency: "JPY", region: "JP", seller: "shopA", availability: "in_stock", ...extra }, GRANTED);
  if (!r.ok) throw new Error(r.error);
  return r.listing;
}
function kr(title: string, extra: Record<string, unknown> = {}, price = 2000000): ProviderListing {
  const r = mapGenericRow("kr-feed", { id: `kr-${++seq}`, title, price, currency: "KRW", region: "KR", seller: "shopB", availability: "in_stock", ...extra }, GRANTED);
  if (!r.ok) throw new Error(r.error);
  return r.listing;
}
const batch = (provider: string, listings: ProviderListing[]): ProviderBatch => ({ provider, ok: true, listings, malformed: 0 });
const run = (listings: ProviderListing[], ctx: Partial<IntakeContext> = {}) => runIntake([batch("x", listings)], { catalog, ...ctx });
const actionOf = (r: ReturnType<typeof run>, l: ProviderListing) => r.outcomes.find((o) => o.key === `${l.provider}|${l.externalId}`)!;

// ---------------------------------------------------------------------
// 1. Provider mappers: common format, UNKNOWN for unstated values, malformed handling
// ---------------------------------------------------------------------
{
  const r = mapRakutenItem({ itemCode: "shop:1", itemName: "SONY ILCE-1M2 [ボディ単体]", itemPrice: 100, itemUrl: "https://x.example/1", shopName: "S", availability: 1 }, GRANTED);
  check("rakuten maps to JP/JPY/in_stock, manufacturer+model UNKNOWN", r.ok && [r.listing.region, r.listing.currency, r.listing.availability, r.listing.manufacturer, r.listing.modelNumber], ["JP", "JPY", "in_stock", UNKNOWN, UNKNOWN]);
  const c = mapCoupangProduct({ productId: 77, productName: "소니 ILCE-1M2", productPrice: 1000, productUrl: "https://c.example/77" }, GRANTED);
  check("coupang: stock + seller stay UNKNOWN (API has none), id stringified", c.ok && [c.listing.availability, c.listing.seller, c.listing.externalId], [UNKNOWN, UNKNOWN, "77"]);
  const noRights = mapRakutenItem({ itemCode: "a", itemName: "n", itemPrice: 1 });
  check("usageRights defaults to UNKNOWN (never assumed granted)", noRights.ok && noRights.listing.usageRights, UNKNOWN);
  check("javascript: URL is dropped", (mapCoupangProduct({ productId: 1, productName: "n", productPrice: 1, productUrl: "javascript:alert(1)" }) as { listing: ProviderListing }).listing.sourceUrl, null);
  check("malformed rakuten item (no price) rejected", mapRakutenItem({ itemCode: "a", itemName: "n", itemPrice: "abc" }).ok, false);
  check("malformed coupang item (negative price) rejected", mapCoupangProduct({ productId: 1, productName: "n", productPrice: -5 }).ok, false);
  const g = mapGenericRow("feed", { id: 1, title: "t" });
  check("generic row with only id+title: everything else UNKNOWN/null", g.ok && [g.listing.price, g.listing.currency, g.listing.region, g.listing.condition, g.listing.availability], [null, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  check("batch: non-array response -> failed batch", buildProviderBatch("p", { error: "x" }, mapRakutenItem).ok, false);
  check("batch: all items malformed -> failed batch (format change), not '0 results'", buildProviderBatch("p", [{ foo: 1 }, 7, null], mapRakutenItem).ok, false);
  const partial = buildProviderBatch("p", [{ itemCode: "a", itemName: "n", itemPrice: 5 }, { bad: true }], mapRakutenItem);
  check("batch: partial malformed -> ok with malformed count", partial.ok && [partial.listings.length, partial.malformed], [1, 1]);
  check("batch: empty array is a legitimate empty result", buildProviderBatch("p", [], mapRakutenItem).ok, true);
}

// ---------------------------------------------------------------------
// 2. attribute / code extraction
// ---------------------------------------------------------------------
check("mount: FE lens -> sony_e", extractAttributes("Sony FE 24-70mm F2.8 GM II").mount, "sony_e");
check("mount: two mounts in one title -> UNKNOWN", extractAttributes("Sigma 35mm for Sony E-mount / L-mount").mount, UNKNOWN);
check("colour: Black/White -> UNKNOWN (ambiguous)", extractAttributes("Mexico 66 Black/White").color, UNKNOWN);
check("bundle: レンズキット -> kit", extractAttributes("ミラーレス一眼 レンズキット").bundle, "kit");
check("model codes: units/aperture/mm ranges are not codes", extractModelCodes("Sony FE 24-70mm F2.8 GM II SEL2470GM2 256GB 4K 500W"), ["SEL2470GM2"]);
check("REGRESSION: a 5-digit code ending in a unit letter (20942W) IS a code, 500W is not", extractModelCodes("Tumbler 20942W 500W 10000mAh"), ["20942W"]);

// ---------------------------------------------------------------------
// 3. same-product linking across providers: ends in REVIEW, never auto-approved
// ---------------------------------------------------------------------
{
  const a = jp("SONY｜ソニー α1 II ミラーレス一眼カメラ ILCE-1M2 [ボディ単体]");
  const b = kr("소니 알파1 II 미러리스 카메라 ILCE-1M2 바디");
  const r = run([a, b]);
  check("two providers, same catalog code -> one REVIEW batch of 2", [r.reviewBatches.length, r.reviewBatches[0]?.listingKeys.length, r.reviewBatches[0]?.variantId], [1, 2, "v-a1m2"]);
  check("evidence is strong for exact code + brand + no attribute gap", r.reviewBatches[0].evidence, "strong");
  check("new (unapproved) listings are never AUTO_REFRESH/AUTO_DROP", [actionOf(r, a).action, actionOf(r, b).action], ["REVIEW", "REVIEW"]);
}
{
  const only = run([jp("SONY ILCE-1M2 ボディ")]);
  check("single region -> HOLD(single_region), not REVIEW", [only.outcomes[0].action, only.outcomes[0].reasons[0]], ["HOLD", "single_region:JP"]);
}
{
  const anchor: ApprovedListingRef = { provider: "jp-feed", externalId: "jp-approved", variantId: "v-a1m2", region: "JP" };
  const k = kr("소니 ILCE-1M2 바디");
  const r = run([k], { approved: [anchor] });
  check("new KR listing + already-approved JP listing -> comparable, 1-listing REVIEW batch", [r.reviewBatches.length, r.reviewBatches[0]?.regions], [1, ["JP", "KR"]]);
}

// ---------------------------------------------------------------------
// 4. wrong-model blocking
// ---------------------------------------------------------------------
{
  const w = jp("Panasonic LUMIX DC-S5M2W ズームレンズキット");
  const k = kr("파나소닉 LUMIX DC-S5M2W 렌즈 키트");
  const r = run([w, k]);
  const link = r.outcomes.map((o) => o.variantId);
  check("kit code DC-S5M2W is NOT linked to body DC-S5M2 (suffix = different SKU)", link, [null, null]);
  const base = run([jp("Panasonic LUMIX DC-S5M2 ボディ"), kr("파나소닉 DC-S5M2 바디")]);
  check("body DC-S5M2 itself still links", base.reviewBatches[0]?.variantId, "v-s5m2");
}
{
  const r = run([jp("Nikon ニコン Z8II ミラーレス"), kr("니콘 Z8II 바디")]);
  check("Z8II does not link to catalog Z8 (token boundary); becomes a NEW-product weak candidate", [r.reviewBatches[0]?.kind, r.reviewBatches[0]?.evidence, r.outcomes[0].variantId], ["new_product", "weak", null]);
  const ok = run([jp("Nikon ニコン Z8 ボディ"), kr("니콘 Z8 바디")]);
  check("Z8 with brand evidence links to Z8", ok.reviewBatches[0]?.variantId, "v-z8");
  const nobrand = run([jp("Z8 ケース 汎用品"), kr("Z8 보호 파우치")]);
  check("short code Z8 with NO brand evidence never links", nobrand.outcomes.every((o) => o.variantId === null), true);
  const hyph = run([jp("SONY ILCE-1M2-B 限定モデル"), kr("소니 ILCE-1M2-B 한정")]);
  check("hyphen-extended code ILCE-1M2-B is not the base ILCE-1M2", hyph.outcomes.every((o) => o.variantId !== "v-a1m2"), true);
}
{
  const r5 = run([jp("Canon キヤノン EOS R5 ボディ"), kr("캐논 EOS R5 바디")]);
  check("name-only link EOS R5 -> v-r5, evidence weak (name match is never strong)", [r5.reviewBatches[0]?.variantId, r5.reviewBatches[0]?.evidence], ["v-r5", "weak"]);
  const m2 = run([jp("Canon キヤノン EOS R5 Mark II ボディ"), kr("캐논 EOS R5 Mark II 바디")]);
  check("EOS R5 Mark II links to Mark II entry, not to EOS R5", m2.reviewBatches[0]?.variantId, "v-r5m2");
  const only = run([jp("Canon キヤノン EOS R5 Mark III ボディ"), kr("캐논 EOS R5 Mark III")]);
  check("unknown later generation (R5 Mark III) is NOT linked to R5 / R5 Mark II", only.outcomes.every((o) => o.variantId === null), true);
}

// regression: defects found by the synthetic experiment (E2) - each was a real wrong link before the fix
{
  const gen = run([jp("Sony ZV-E10 II ボディ"), kr("소니 ZV-E10 II 바디")]);
  check("REGRESSION: 'ZV-E10 II' is not catalog 'ZV-E10' (later-generation marker after the code)", gen.outcomes.every((o) => o.variantId !== "v-zve10"), true);
  check("...it forms its own new-product group keyed 'ZV-E10 II'", [gen.reviewBatches.length, gen.reviewBatches[0]?.kind, gen.reviewBatches[0]?.id.endsWith("ZVE10II")], [1, "new_product", true]);
  const base = run([jp("Sony ZV-E10 ボディ"), kr("소니 ZV-E10 바디")]);
  check("...while plain 'ZV-E10' still links", base.reviewBatches[0]?.variantId, "v-zve10");
  const mixed = run([jp("Acme QX-77 ボディ", { brand: "Acme" }), kr("Acme QX-77 II 바디", { brand: "Acme" })]);
  check("discovery: 'QX-77' and 'QX-77 II' never share a group (each single-region -> HOLD)", [mixed.reviewBatches.length, mixed.outcomes.map((o) => o.action)], [0, ["HOLD", "HOLD"]]);
}
{
  const withSku: CatalogEntry[] = [{ variantId: "v-n", productType: "camera", brand: "Sony", name: "Sony α1 II", modelSku: "ILCE-1M2" }];
  const sib = runIntake([batch("x", [jp("ソニー Sony α1 II ILCE-1M2W ボディ"), kr("소니 Sony α1 II ILCE-1M2W 바디")])], { catalog: withSku });
  check("REGRESSION: name match + a DIFFERENT code in the title (ILCE-1M2W vs catalog ILCE-1M2) -> HOLD variant_conflict", sib.outcomes.map((o) => [o.action, o.reasons[0], o.variantId]), [["HOLD", "variant_conflict", null], ["HOLD", "variant_conflict", null]]);
  const noSku = runIntake([batch("x", [jp("ソニー Sony α1 II ILCE-1M2 ボディ"), kr("소니 Sony α1 II ILCE-1M2 바디")])], { catalog: [{ ...withSku[0], modelSku: null }] });
  check("name match + code the catalog cannot verify -> weak REVIEW flagged unverified_code_in_title", [noSku.reviewBatches[0]?.evidence, noSku.reviewBatches[0]?.reasons.some((r) => r.startsWith("unverified_code_in_title"))], ["weak", true]);
  const exact = run([jp("Sony ILCE-1M2 α1 II ボディ"), kr("소니 ILCE-1M2 α1 II 바디")]);
  check("catalog code match is not disturbed by the name tokens in the same title", exact.reviewBatches[0]?.variantId, "v-a1m2");
}
{
  const withModel = jp("SONY ILCE-1M2 ボディ", { brand: "Sony", model: "ILCE-1M2" });
  const without = { ...withModel, externalId: "jp-dup-no-model", modelNumber: UNKNOWN, manufacturer: UNKNOWN };
  const r = runIntake([batch("x", [without, withModel])], { catalog: [] });
  check("REGRESSION: collapsing an id-changed duplicate keeps the structured model number of the dropped record", r.outcomes.filter((o) => o.action !== "AUTO_DROP").map((o) => o.modelCode), ["ILCE-1M2"]);
  const e1 = { ...withModel, externalId: "same", modelNumber: UNKNOWN };
  const e2 = { ...withModel, externalId: "same", fetchedAt: "2026-12-01T00:00:00Z" };
  check("exact duplicate: newer record wins but keeps known model number from the older", runIntake([batch("x", [e2, e1])], { catalog: [] }).snapshot[0].modelNumber, "ILCE-1M2");
}

{
  const cat: CatalogEntry[] = [{ variantId: "v-body", productType: "camera", brand: "Nikon", name: "Nikon Z5 BODY", modelSku: null }];
  const r = runIntake([batch("x", [jp("ニコン Nikon Z5 BODY Mark II ボディ"), kr("니콘 Nikon Z5 BODY Mark II 바디")])], { catalog: cat });
  check("REGRESSION: later-generation marker after a generic word ('Z5 BODY Mark II') is not the 'Z5 BODY' entry", r.outcomes.every((o) => o.variantId === null), true);
  const ok = runIntake([batch("x", [jp("ニコン Nikon Z5 BODY ボディ"), kr("니콘 Nikon Z5 BODY 바디")])], { catalog: cat });
  check("...and the plain 'Z5 BODY' still links by name (weak)", [ok.reviewBatches[0]?.variantId, ok.reviewBatches[0]?.evidence], ["v-body", "weak"]);
  const kinto: CatalogEntry[] = [{ variantId: "v-k", productType: UNKNOWN, brand: "KINTO", name: "KINTO TRAVEL TUMBLER 500ml White", modelSku: "20942" }];
  const k = runIntake([batch("x", [jp("KINTO TRAVEL TUMBLER 500ml White 20942W"), kr("킨토 KINTO TRAVEL TUMBLER 500ml White 20942W")])], { catalog: kinto });
  check("REGRESSION: catalog sku 20942 vs title code 20942W (different colour SKU) -> HOLD variant_conflict", k.outcomes.map((o) => [o.action, o.reasons[0]]), [["HOLD", "variant_conflict"], ["HOLD", "variant_conflict"]]);
}

// ---------------------------------------------------------------------
// 5. mount / colour / bundle mismatch
// ---------------------------------------------------------------------
{
  const r = run([jp("Sony SEL2470GM2 Eマウント用 レンズ"), kr("소니 SEL2470GM2 E마운트 렌즈")]);
  check("lens with matching stated mount: strong REVIEW", [r.reviewBatches[0]?.variantId, r.reviewBatches[0]?.evidence], ["v-lens", "strong"]);
  const mismatch = run([jp("Tamron タムロン A068 Nikon Z マウント 17-50mm"), kr("탐론 A068 니콘 Z마운트 렌즈")]);
  check("lens whose stated mount (Z) conflicts with catalog mount (sony_e) -> HOLD variant_conflict, not linked", mismatch.outcomes.map((o) => [o.action, o.reasons[0], o.variantId]), [["HOLD", "variant_conflict", null], ["HOLD", "variant_conflict", null]]);
  const contradictory = run([jp("Sony SEL2470GM2 Canon RF マウント"), kr("소니 SEL2470GM2 RF마운트")]);
  check("self-contradictory title (Sony E code + RF mount) -> mount UNKNOWN -> weak REVIEW, never strong", contradictory.reviewBatches.map((b) => b.evidence), ["weak"]);
  const tam = run([jp("Tamron タムロン A063 28-75mm F2.8 レンズ"), kr("탐론 A063 28-75mm 렌즈")]);
  check("lens with unknown mount (catalog+listing) is REVIEW but weak, mount gap recorded", [tam.reviewBatches[0]?.evidence, tam.reviewBatches[0]?.reasons.includes("mount_unknown_in_catalog")], ["weak", true]);
}
{
  const r = run([
    jp("Acme ZX-900 ワイヤレス ブラック", { brand: "Acme" }), kr("Acme ZX-900 블랙", { brand: "Acme" }),
    jp("Acme ZX-900 ワイヤレス シルバー", { brand: "Acme" }), kr("Acme ZX-900 실버", { brand: "Acme" }),
  ]);
  check("discovery group with two known colours splits into 2 separate review batches", [r.reviewBatches.length, r.reviewBatches.every((b) => b.listingKeys.length === 2)], [2, true]);
  const mixed = run([jp("Acme ZX-900 ブラック", { brand: "Acme" }), jp("Acme ZX-900 シルバー", { brand: "Acme" }), kr("Acme ZX-900", { brand: "Acme" })]);
  check("listing that states no colour inside a split group -> HOLD attr_ambiguous", mixed.outcomes.filter((o) => o.reasons[0] === "attr_ambiguous").length, 1);
  const kit = run([jp("SONY ILCE-1M2 ダブルズームセット"), kr("소니 ILCE-1M2")]);
  check("kit vs unspecified bundle: still REVIEW but weak with bundle gap", [kit.reviewBatches[0]?.evidence, kit.reviewBatches[0]?.reasons.includes("bundle_kit_vs_unspecified")], ["weak", true]);
  const lensKit = run([jp("SONY ILCE-1M2 レンズキット")]);
  check("(existing negativeFilter policy) camera 'レンズキット' listing is auto-dropped as accessory/bundle - kit variants are out of scope", lensKit.outcomes[0].action, "AUTO_DROP");
  const kitVsBody = run([jp("SONY ILCE-1M2 ダブルズームセット"), kr("소니 ILCE-1M2 바디")]);
  check("kit (JP) vs body-only (KR) are different bundles -> split, no cross-market review batch", [kitVsBody.reviewBatches.length, kitVsBody.outcomes.map((o) => o.action)], [0, ["HOLD", "HOLD"]]);
}

// ---------------------------------------------------------------------
// 6. used / refurb / accessory
// ---------------------------------------------------------------------
{
  const used = jp("SONY ILCE-1M2 【中古】 ボディ");
  const refurb = kr("소니 ILCE-1M2 리퍼비시 바디");
  const field = jp("SONY ILCE-1M2 ボディ", { condition: "used" });
  const acc = kr("소니 ILCE-1M2 호환 카메라 스트랩 케이스");
  const good = kr("소니 ILCE-1M2 바디");
  const r = run([used, refurb, field, acc, good]);
  check("used (title) / refurb / condition field / accessory dropped automatically", [used, refurb, field, acc].map((l) => actionOf(r, l).action), ["AUTO_DROP", "AUTO_DROP", "AUTO_DROP", "AUTO_DROP"]);
  check("the genuine new listing is not dropped", actionOf(r, good).action !== "AUTO_DROP", true);
}

// ---------------------------------------------------------------------
// 7. duplicates and seller ID change
// ---------------------------------------------------------------------
{
  const a = jp("SONY ILCE-1M2 ボディ");
  const dup = { ...a, price: 190000, fetchedAt: "2026-11-02T00:00:00Z" };
  const r = run([a, dup]);
  check("same provider+externalId twice -> collapsed to one (newer wins)", [r.stats.duplicateExact, r.outcomes.length, r.snapshot[0].price], [1, 1, 190000]);
}
{
  const a = jp("SONY ILCE-1M2 ボディ");
  const moved = { ...a, externalId: "jp-new-id" };
  const r = run([a, moved, kr("소니 ILCE-1M2 바디")]);
  check("seller changed externalId, nothing approved -> older id dropped as duplicate_id_change", [r.stats.duplicateIdChange, r.outcomes.filter((o) => o.action === "AUTO_DROP").length], [1, 1]);
}
{
  const a = jp("SONY ILCE-1M2 ボディ");
  const moved = { ...a, externalId: "jp-new-id" };
  const approved: ApprovedListingRef = { provider: a.provider, externalId: a.externalId, variantId: "v-a1m2", region: "JP" };
  const r = run([a, moved], { approved: [approved] });
  check("approved listing keeps AUTO_REFRESH; its new id goes to REVIEW as id_changed_remap (never auto-remapped)", [actionOf(r, a).action, actionOf(r, moved).action, r.reviewBatches.map((b) => b.kind)], ["AUTO_REFRESH", "REVIEW", ["id_change_remap"]]);
}
{
  const sellerA = kr("소니 ILCE-1M2 바디", { seller: "A" });
  const sellerB = kr("소니 ILCE-1M2 바디", { seller: "B" });
  const r = run([sellerA, sellerB]);
  check("same title from DIFFERENT sellers are different offers, not duplicates", r.stats.duplicateIdChange, 0);
}

// ---------------------------------------------------------------------
// 8. out-of-stock vs search failure / bad response / state carry-over
// ---------------------------------------------------------------------
{
  const oos = jp("SONY ILCE-1M2 ボディ", { availability: "out_of_stock" });
  const k = kr("소니 ILCE-1M2 바디");
  const r = run([oos, k]);
  check("explicit out_of_stock is kept (mapping reviewable), but excluded from comparability on its own", [actionOf(r, oos).action, r.reviewBatches.length], ["HOLD", 0]);
  const allOos = run([jp("SONY ILCE-1M2 ボディ", { availability: "out_of_stock" })]);
  check("only out-of-stock offers -> HOLD no_available_offer", allOos.outcomes[0].reasons[0], "no_available_offer");
}
{
  const first = run([jp("SONY ILCE-1M2 ボディ"), kr("소니 ILCE-1M2 바디")]);
  const failed = runIntake([{ provider: "jp-feed", ok: false, error: "http_503" }, { provider: "kr-feed", ok: false, error: "malformed_response" }], { catalog, previousSnapshot: first.snapshot });
  check("all providers failed: previous listings carried over untouched", [failed.stats.providerFailures, failed.stats.carriedOver, failed.snapshot.length], [2, 2, 2]);
  check("carried-over listings keep availability (failure is NOT 'sold out')", failed.snapshot.map((l) => l.availability), first.snapshot.map((l) => l.availability));
  check("carried-over outcome equals previous outcome (no regression)", failed.outcomes.map((o) => [o.key, o.action]), first.outcomes.map((o) => [o.key, o.action]));
  const emptyOk = runIntake([batch("jp-feed", [])], { catalog, previousSnapshot: first.snapshot });
  check("provider returned an empty OK result: listings not seen are kept, never turned into out_of_stock", emptyOk.snapshot.map((l) => l.availability), ["in_stock", "in_stock"]);
}

// ---------------------------------------------------------------------
// 9. data usage rights
// ---------------------------------------------------------------------
{
  const unk = mapGenericRow("nofeed", { id: "1", title: "SONY ILCE-1M2", price: 1, currency: "JPY", region: "JP" }, { priceBasis: "seller_listing" }); // rights not given (only rights vary)
  const kr1 = kr("소니 ILCE-1M2 바디");
  if (!unk.ok) throw new Error("setup");
  const r = run([unk.listing, kr1]);
  check("provider with unverified rights -> HOLD rights_unverified (never reviewed/displayed)", actionOf(r, unk.listing).reasons[0], "rights_unverified");
  check("...and therefore cannot contribute to comparability", r.reviewBatches.length, 0);
  const denied = run([unk.listing, kr1], { providerRights: { nofeed: "denied" } });
  check("explicit denied -> AUTO_DROP", actionOf(denied, unk.listing).reasons[0], "rights_denied");
  const granted = run([unk.listing, kr1], { providerRights: { nofeed: "granted" } });
  check("policy 'granted' lets the same listing proceed", granted.reviewBatches.length, 1);
}

// ---------------------------------------------------------------------
// 10. approval / rejection state preservation and idempotent re-run
// ---------------------------------------------------------------------
{
  const a = jp("SONY ILCE-1M2 ボディ");
  const k = kr("소니 ILCE-1M2 바디");
  const rej = kr("소니 ILCE-1M2 바디 한정판", { seller: "C" });
  const approved: ApprovedListingRef = { provider: a.provider, externalId: a.externalId, variantId: "v-a1m2", region: "JP" };
  const ctx: Partial<IntakeContext> = { approved: [approved], rejected: [`${rej.provider}|${rej.externalId}`] };
  const r1 = run([a, k, rej], ctx);
  check("approved listing -> AUTO_REFRESH only (price refresh), human-rejected -> AUTO_DROP", [actionOf(r1, a).action, actionOf(r1, rej).reasons[0]], ["AUTO_REFRESH", "human_rejected"]);
  const r2 = run([a, k, rej], { ...ctx, previousSnapshot: r1.snapshot });
  check("re-run with its own snapshot is idempotent (identical outcomes + batches)", JSON.stringify([r2.outcomes.map((o) => [o.key, o.action, o.reasons]), r2.reviewBatches]), JSON.stringify([r1.outcomes.map((o) => [o.key, o.action, o.reasons]), r1.reviewBatches]));
  const changed = { ...a, title: "SONY ILCE-1M2 【中古】ボディ" };
  const r3 = run([changed], { approved: [approved] });
  check("approved listing whose title now says 中古 is NOT silently refreshed or dropped -> REVIEW approved_listing_changed", [actionOf(r3, changed).action, r3.reviewBatches[0]?.kind], ["REVIEW", "approved_changed"]);
}

// ---------------------------------------------------------------------
// 11. multi-offer market + non-camera category + never-auto-approve invariant
// ---------------------------------------------------------------------
{
  const r = run([jp("Sony WF-1000XM5 完全ワイヤレスイヤホン ブラック"), kr("소니 WF-1000XM5 블랙"), kr("소니 WF-1000XM5 블랙 공식", { seller: "other" })]);
  check("earbuds (non-camera) link by code; 2 KR offers flagged for per-market choice", [r.reviewBatches[0]?.variantId, r.reviewBatches[0]?.reasons.some((x) => x.startsWith("multiple_offers_same_provider_region"))], ["v-xm5", true]);
  const dupMk = run([kr("소니 ILCE-1M2 바디"), jp("SONY ILCE-1M2 ボディ")], { approved: [{ provider: "x", externalId: "old", variantId: "v-a1m2", region: "KR" }] });
  check("new KR listing when KR is already approved -> weak + duplicate_market_offer", [dupMk.reviewBatches[0]?.evidence, dupMk.reviewBatches[0]?.reasons.some((x) => x.startsWith("duplicate_market_offer"))], ["weak", true]);
}
{
  // invariant over a mixed bag: without ctx.approved nothing can be AUTO_REFRESH
  const bag = [
    jp("SONY ILCE-1M2 ボディ"), kr("소니 ILCE-1M2 바디"), jp("Nikon Z8 ボディ"), kr("니콘 Z8 바디"), jp("中古 Canon EOS R5"), kr("캐논 EOS R5 케이스 호환"),
    jp("Sony WF-1000XM5"), jp("謎の商品"), kr("???"),
  ];
  const r = run(bag);
  check("INVARIANT: with no approvals, zero listings are AUTO_REFRESH", r.stats.actions.AUTO_REFRESH, 0);
  check("INVARIANT: every REVIEW outcome belongs to a review batch", r.outcomes.filter((o) => o.action === "REVIEW").every((o) => r.reviewBatches.some((b) => b.listingKeys.includes(o.key))), true);
}

{
  const r = run([jp("SONY ILCE-1M2 ボディ", {}, 123456), kr("소니 ILCE-1M2 바디", {}, 654321), jp("Acme ZX-900 ブラック", { brand: "Acme" }), kr("Acme ZX-900 블랙", { brand: "Acme" })]);
  const md = renderReviewWorklist(r);
  check("worklist: one section per batch, strong batch listed first", [(md.match(/^## /gm) ?? []).length, md.indexOf("[STRONG]") < md.indexOf("[WEAK]")], [2, true]);
  check("worklist: prices are omitted by default, shown only on request", [md.includes("123456"), renderReviewWorklist(r, { includePrices: true }).includes("123456")], [false, true]);
}

// ---------------------------------------------------------------------
// 12. price granularity, approved-refresh without a price, unconfirmed stock
// ---------------------------------------------------------------------
{
  // a roll-up (product_aggregate) price is never a seller price: it must not form a comparable group or reach REVIEW
  const aggr = mapGenericRow("agg-feed", { id: "a1", title: "SONY ILCE-1M2 ボディ", price: 100000, currency: "JPY", region: "JP" }, { ...GRANTED, priceBasis: "product_aggregate" });
  if (!aggr.ok) throw new Error("setup");
  const k = kr("소니 ILCE-1M2 바디");
  const r = run([aggr.listing, k]);
  check("product_aggregate row -> HOLD product_level_price_only, variant still identified for discovery", [actionOf(r, aggr.listing).action, actionOf(r, aggr.listing).reasons[0].split(":")[0], actionOf(r, aggr.listing).variantId], ["HOLD", "product_level_price_only", "v-a1m2"]);
  check("...so a roll-up + one seller price is NOT a comparable group", [r.stats.comparableGroups, r.reviewBatches.length], [0, 0]);
  const used = mapGenericRow("agg-feed", { id: "a2", title: "【中古】SONY ILCE-1M2 ボディ", price: 1, currency: "JPY", region: "JP" }, { ...GRANTED, priceBasis: "product_aggregate" });
  if (!used.ok) throw new Error("setup");
  check("used roll-up row is still dropped by the negative filter (not left on hold)", actionOf(run([used.listing]), used.listing).action, "AUTO_DROP");
  const apprAgg = run([aggr.listing], { approved: [{ provider: "agg-feed", externalId: "a1", variantId: "v-a1m2", region: "JP" }] });
  check("a roll-up row can never be AUTO_REFRESHed even if its key was approved", actionOf(apprAgg, aggr.listing).action, "HOLD");

  // undeclared granularity is not comparable either (declared per provider, like usage rights)
  const und = mapGenericRow("und-feed", { id: "u1", title: "SONY ILCE-1M2 ボディ", price: 100000, currency: "JPY", region: "JP" }, { usageRights: "granted" });
  if (!und.ok) throw new Error("setup");
  check("undeclared priceBasis -> HOLD price_basis_unverified", actionOf(run([und.listing, k]), und.listing).reasons[0].split(":")[0], "price_basis_unverified");
  check("rakuten item / coupang mappers declare seller_listing", [(mapRakutenItem({ itemCode: "a", itemName: "n", itemPrice: 1 }) as { listing: ProviderListing }).listing.priceBasis, (mapCoupangProduct({ productId: 1, productName: "n", productPrice: 1 }) as { listing: ProviderListing }).listing.priceBasis], ["seller_listing", "seller_listing"]);
  check("generic mapper defaults to UNKNOWN", (mapGenericRow("f", { id: 1, title: "t" }) as { listing: ProviderListing }).listing.priceBasis, UNKNOWN);

  // approved listing whose refresh returned no price: previous state must be kept, not refreshed with null
  const np = mapGenericRow("jp-feed", { id: "np1", title: "SONY ILCE-1M2 ボディ", price: null, currency: "JPY", region: "JP", seller: "shopA" }, GRANTED);
  if (!np.ok) throw new Error("setup");
  const rn = run([np.listing], { approved: [{ provider: "jp-feed", externalId: "np1", variantId: "v-a1m2", region: "JP" }] });
  check("approved listing with no price -> HOLD approved_refresh_no_price, never AUTO_REFRESH", [actionOf(rn, np.listing).action, actionOf(rn, np.listing).reasons[0].split(":")[0]], ["HOLD", "approved_refresh_no_price"]);

  // stock that the provider never stated must be flagged to the reviewer, not silently counted as available
  const cp = mapCoupangProduct({ productId: 4242, productName: "소니 ILCE-1M2 바디", productPrice: 2000000 }, { ...GRANTED });
  if (!cp.ok) throw new Error("setup");
  const rs = run([jp("SONY ILCE-1M2 ボディ"), cp.listing]);
  check("unstated stock (coupang) is flagged availability_unconfirmed", actionOf(rs, cp.listing).reasons.some((x) => x.startsWith("availability_unconfirmed")), true);
  check("stated stock is not flagged", actionOf(rs, rs.outcomes.find((o) => o.listing.provider === "jp-feed")!.listing).reasons.some((x) => x.startsWith("availability_unconfirmed")), false);
}

// ---------------------------------------------------------------------
// 13. the five states: discovered / review target / price candidate / stock-confirmed / displayable.
//     Approved records are preserved; only UNCONFIRMED data is blocked from promoting or overwriting.
// ---------------------------------------------------------------------
{
  const ROW = { id: "f1", title: "SONY ILCE-1M2 ボディ", price: 300000, currency: "JPY", region: "JP", seller: "s", availability: "in_stock" };
  const appr = [{ provider: "feedx", externalId: "f1", variantId: "v-a1m2", region: "JP" as const }];
  const one = (raw: Record<string, unknown>, opts: Record<string, unknown>, ctx: Partial<IntakeContext> = {}) => {
    const m = mapGenericRow("feedx", raw, opts);
    if (!m.ok) throw new Error("setup");
    return { l: m.listing, r: runIntake([batch("feedx", [m.listing])], { catalog, approved: appr, ...ctx }) };
  };

  // A: an approved listing is preserved, but a refresh whose price granularity was never declared is not applied
  const a1 = one(ROW, { usageRights: "granted" });
  check("A: approved + priceBasis UNKNOWN -> HOLD (previous state kept), not AUTO_REFRESH", [a1.r.outcomes[0].action, a1.r.outcomes[0].reasons[0].split(":")[0]], ["HOLD", "approved_refresh_price_basis_unverified"]);
  const a2 = one(ROW, { usageRights: "granted", priceBasis: "seller_listing" });
  check("A: approved + declared seller_listing -> AUTO_REFRESH (existing approvals keep refreshing)", a2.r.outcomes[0].action, "AUTO_REFRESH");

  // E: a new response lacking currency / stock must not overwrite a good record
  const e1 = one({ ...ROW, currency: undefined }, { usageRights: "granted", priceBasis: "seller_listing" });
  check("E: approved + price but currency UNKNOWN -> HOLD, not AUTO_REFRESH", [e1.r.outcomes[0].action, e1.r.outcomes[0].reasons[0].split(":")[0]], ["HOLD", "approved_refresh_no_currency"]);
  const e2 = one({ ...ROW, availability: undefined }, { usageRights: "granted", priceBasis: "seller_listing" });
  check("E: approved + availability UNKNOWN -> price-only refresh, told to keep previous availability", [e2.r.outcomes[0].action, e2.r.outcomes[0].listing.availability, e2.r.outcomes[0].reasons[0].includes("keep previous availability")], ["AUTO_REFRESH", UNKNOWN, true]);
  const e3 = one({ ...ROW, availability: "out_of_stock" }, { usageRights: "granted", priceBasis: "seller_listing" });
  check("E: an EXPLICIT out_of_stock is still passed through (state 4 can be withdrawn)", [e3.r.outcomes[0].action, e3.r.outcomes[0].listing.availability], ["AUTO_REFRESH", "out_of_stock"]);

  // D: rights policy applies at decision time and is never baked into the snapshot
  const mapped = mapGenericRow("feedx", ROW, { priceBasis: "seller_listing" }); // mapper declares NO rights
  if (!mapped.ok) throw new Error("setup");
  const run1 = runIntake([batch("feedx", [mapped.listing])], { catalog, approved: appr, providerRights: { feedx: "granted" } });
  check("D: policy granted -> run proceeds", run1.outcomes[0].action, "AUTO_REFRESH");
  check("D: snapshot keeps what the MAPPER declared (UNKNOWN), not the policy grant", run1.snapshot[0].usageRights, UNKNOWN);
  const run2 = runIntake([], { catalog, approved: appr, previousSnapshot: run1.snapshot }); // policy entry removed
  check("D: policy entry removed -> carried-over row falls back to HOLD rights_unverified (no stale grant)", [run2.outcomes[0].action, run2.outcomes[0].reasons[0]], ["HOLD", "rights_unverified"]);
  const run3 = runIntake([], { catalog, approved: appr, previousSnapshot: run1.snapshot, providerRights: { feedx: "denied" } });
  check("D: policy denied -> carried-over row is AUTO_DROP", run3.outcomes[0].reasons[0], "rights_denied");
  const declared = mapGenericRow("feedx", ROW, { usageRights: "granted", priceBasis: "seller_listing" });
  if (!declared.ok) throw new Error("setup");
  const rd = runIntake([batch("feedx", [declared.listing])], { catalog, approved: appr });
  const rd2 = runIntake([], { catalog, approved: appr, previousSnapshot: rd.snapshot });
  check("D: a grant the mapper itself declared still carries over (existing behaviour unchanged)", [rd.snapshot[0].usageRights, rd2.outcomes[0].action], ["granted", "AUTO_REFRESH"]);

  // C: a snapshot row written by an older version (no priceBasis) can never act as a seller price
  const legacy = { ...declared.listing, provider: "rakuten_product", externalId: "pp1", priceBasis: undefined } as unknown as ProviderListing;
  const rc = runIntake([], { catalog, previousSnapshot: [legacy], providerRights: { rakuten_product: "granted" } });
  check("C: legacy snapshot row without priceBasis -> HOLD price_basis_unverified", rc.outcomes[0].reasons[0].split(":")[0], "price_basis_unverified");

  // B: price candidate (state 3) is not stock-confirmed (state 4)
  const stock = (jpA: string | undefined, krA: string | undefined) => {
    const jpl = jp("SONY ILCE-1M2 ボディ", { availability: jpA });
    const krl = kr("소니 ILCE-1M2 바디", { availability: krA });
    return run([jpl, krl]);
  };
  const both = stock("in_stock", "in_stock");
  check("B: stock stated in both regions -> comparable AND stock-confirmed", [both.stats.comparableGroups, both.stats.comparableGroupsStockConfirmed, both.reviewBatches[0].stockConfirmedRegions], [1, 1, ["JP", "KR"]]);
  const unk = stock(undefined, undefined);
  check("B: stock unstated in both -> still a price candidate, but NOT stock-confirmed", [unk.stats.comparableGroups, unk.stats.comparableGroupsStockConfirmed, unk.reviewBatches[0].stockConfirmedRegions], [1, 0, []]);
  const half = stock("in_stock", undefined);
  check("B: one side confirmed, the other unknown -> not stock-confirmed", [half.stats.comparableGroupsStockConfirmed, half.reviewBatches[0].stockConfirmedRegions], [0, ["JP"]]);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
