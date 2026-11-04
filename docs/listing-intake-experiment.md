# Multi-provider listing intake — experiment record (2026-11-03)

Branch: `claude/tripprice-multi-source-matching-xk6fva` (experiment only; nothing merged, no deploy, no DB, no provider API call, no secret read).

Goal: stop depending on Rakuten/Coupang by turning *any* provider's candidate listings into one comparable-catalog worklist, and shrink human work from "register every product by hand" to "approve a group once".

## What was built

| File | Role |
|---|---|
| `src/domain/providerListing.ts` | Provider-neutral `ProviderListing` (provider, external id, manufacturer, model number, title, mount/colour/bundle/fitting, condition, price/currency, seller, availability, fetchedAt, usageRights). Unstated = literal `UNKNOWN`. Mappers: `mapRakutenItem`, `mapCoupangProduct`, `mapGenericRow`; `buildProviderBatch` turns bad responses into a *failed batch* (= "no information"), never "sold out". |
| `src/services/listingIntakeService.ts` | `renderReviewWorklist(result)` renders one markdown section per review batch (prices off by default). `runIntake(batches, ctx)`: dedupe → model identification → same-product grouping → comparability → triage into `AUTO_DROP / AUTO_REFRESH / REVIEW / HOLD`, plus group-level `ReviewBatch`es. Pure, in-memory, deterministic. |
| `src/services/listingIntakeService.test.ts` | 77 checks (safety matrix below). |
| `src/scripts/lib/syntheticListings.ts` | Seeded synthetic listing generator **with ground-truth labels**. |
| `src/scripts/run-listing-intake.ts` | Offline runner for E1/E2/E3. `npm run intake:experiment`, `npm run intake:test`. |
| `docs/listing-intake-experiment-results.json` | Aggregate counts only (no price values). |

Reused, not re-implemented: `identifierMatch.matchesModelToken`, `negativeFilter.classifyListingText` (used/refurb/accessory/wrong-category), `marketQuoteService.evaluateOfferEligibility` + its one-market-per-region semantics, `searchAliases` (`PRODUCT_TYPES`, `BRAND_ALIASES`, `PRODUCT_TYPE_ALIASES`), `http(s)` URL guard, the Product/Variant/SourceListing vocabulary (`CatalogEntry` ≈ product+variant, `ApprovedListingRef` ≈ an approved source_listing). Not touched: DB schema, `approveListing`, refresh flow, candidate evaluator.

## Automatic (A) vs human (B)

- **A — automatic, safe:** drop exact duplicates; drop id-changed duplicates (same provider+seller+title, nothing approved); drop used/refurbished/accessory/wrong-category; drop rights-denied; hold rights-unverified, no-price, unknown-region, unknown-model, single-region, attribute-conflict; keep prior snapshot when a provider fails; `AUTO_REFRESH` only for listings a human already approved.
- **B — human, batched:** every *first* mapping. One `ReviewBatch` per same-product group (catalog variant or newly discovered code), with an evidence tier (`strong` = exact catalog model-code token + brand + no attribute gap; everything else `weak`) and reasons. Also: approved listing whose text now looks used/other-variant; seller id change of an approved listing (remap); a second offer in an already-approved market.
- Never automatic: first approval, name-only identity, new-product discovery.

## Defects the experiments found (all fixed, each has a regression test)

1. Name-only link ignored a *conflicting model code* in the title (`ILCE-1M2W` vs catalog `ILCE-1M2`) — 20 wrong links in E2 → now `HOLD variant_conflict`.
2. `ZV-E10 II` merged with `ZV-E10` (later-generation marker after a code) — now part of the identity.
3. Generation marker behind a generic word (`Z5 BODY Mark II`) bypassed the guard.
4. `20942W` mis-read as a wattage unit, hiding a colour-SKU conflict.
5. Deduping dropped the record that carried the structured model number — survivors now keep known identity fields.
6. Synthetic generator bug (rights-unknown provider generated as `granted`) — generator fixed, not the pipeline.

## Results (details + exact numbers in `docs/listing-intake-experiment-results.json`)

Three measurements that must **not** be added together or read as a product count:

### E1 — REAL repo data (identity level only)
Rows: 499 (baseline 429, seed 30, pilot 20, CSV 10, products.ts/mainstreamBatch1 10) → 51 duplicates removed → **448 unique real candidate identities**. Categories span cameras/lenses, earbuds/headphones/smartwatch, diving gear, plus beauty/fashion/household from `mainstreamBatch1`.

- Model identification from the candidate's own data (no catalog): 73/448 = **16.3%** (explicit 29, code in name 44). 84% have no code at all (e.g. "Scubapro Bella").
- Catalog self-consistency (catalog = the 448 identities): 394/448 linked to their own entry (387 by name, 7 by code), **0 linked to another entry, 0 ambiguous**, 54 unlinked — 51 of those are single-word names (`Mares Genius`, `Oceanic Viper`) which the pipeline deliberately refuses to link.
- Code-collision check (distinct products sharing one identified code): 0 after fix 2.
- Approved-state preservation on the repo's real approvals: `data/approved-mappings.json` has **4** approvals (not more); 4/4 → `AUTO_REFRESH`, 0 → REVIEW. Only 2/4 resolve to a catalog identity in repo code (`garmin-descent-mk3s…`, `gull-mantis5` have no product definition in `products.ts`).
- Triage of these rows: 51 `AUTO_DROP` (dupes), 448 `HOLD(no_price)`, **0 REVIEW**. The repo has **no provider price/stock/listing text** (`*.review.json` are not in Git), so real-data comparability / listing-level wrong-match / REVIEW:HOLD ratios **cannot be measured from Git data** — reported as not measured, not as 0 errors.
- Human baseline label counts for context (from `matching-baseline.json`, produced by earlier human review, not by this pipeline): exact 260, missing_source 98, ambiguous 22, wrong_category 22, accessory 11, bundle/condition 9, variant_mismatch 7 (of 429).

### E2 — SYNTHETIC listings over the 448 REAL identities (ground truth known)
2,514 generated listings (JP/KR/INTL/unverified-rights feeds, injected accessories, used/refurb, sibling models, exact and id-changed duplicates, out-of-stock, 47 malformed).
- Wrong matches: **0** (true match to wrong variant 0, sibling linked 0, accessory/used reviewed 0, rights-unknown reviewed 0); false rejects 0.
- True-match recall 87.9% (912/1,037); all 125 misses are `model_unknown` (single-word names) → HOLD, not wrong.
- Classification correct: 94.5% of 2,347 post-dedupe listings.
- REVIEW 1,062 : HOLD 508 (AUTO_DROP 777); 1,062 listing decisions → 441 batch decisions (2.4×). Only 7 of 441 batches are `strong` — real catalog entries mostly lack a model number / lens mount, so nearly everything is `weak`.

### E3 — FULLY SYNTHETIC scale (fabricated brands/models)
| models | listings in | after dedupe | wrong matches | recall | time | rerun identical | 2-part incremental == single run | all-providers-fail run preserves state |
|---|---|---|---|---|---|---|---|---|
| 400 | 2,264 | 2,126 | 0 | 100% | ~0.13 s | yes | yes | yes |
| 3,000 | 16,928 | 15,892 | 0 | 100% | ~1 s | yes | yes | yes |

E3 is easy by construction (every fabricated name carries a unique code) — it proves throughput (~17k listings/s single-threaded) and determinism, **not** matching quality. Success on these synthetic rows is not evidence that 1,000 real products exist.

## Test results
- `npx tsx src/services/listingIntakeService.test.ts`: **77 PASS / 0 FAIL**.
- `npx tsc --noEmit -p tsconfig.json`: clean.
- All other existing test files: unchanged and passing, **except** 4 that fail identically before and after (they read `bcd-candidates.review.json`, which is not in Git): `analyze-identifier-coverage`, `build-matching-baseline`, `evaluate-negative-filter`, `measure-model-token-suggestion` (ENOENT).

## Safety matrix → where tested
Wrong model / suffix SKU / generation (`DC-S5M2W`, `Z8II`, `ZV-E10 II`, `R5 Mark II`) · mount/colour/bundle/fitting conflict & gap · used/refurb/accessory · exact duplicate · seller id change (with and without an approved listing) · out-of-stock vs provider failure vs empty result · malformed/non-array response · unverified/denied usage rights · re-run idempotency, incremental runs, approved & rejected state preserved, approved listing that turns "used" → REVIEW · invariant: with no approvals nothing is ever `AUTO_REFRESH`.

## Known limits
- `レンズキット`-style camera kit titles are dropped by the existing `negativeFilter` (accessory/bundle rule); kit variants are therefore out of scope.
- Attribute extraction (mount/colour/bundle/fitting) is regex-based and only used to block or downgrade, never to confirm.
- Single-word / digit-less names (`Mares Genius`) are never linked; they need a provider model number or a human-curated alias.
- Brand synonyms are a small in-code list (KR/JP for ~14 brands).
- Comparability counts regions (KR/JP/INTL) only; no shipping, tax or import-cost logic (out of scope by instruction).

## Status / BLOCKED items
- ~~BLOCKED — push to `origin`~~ **Resolved 2026-11-04**: GitHub App installed by the owner; branch pushed (earlier attempts failed with 403, nothing was worked around).
- Not done on purpose (out of scope / needs approval): real provider API calls, shipping/import-cost calculator, UI, DB writes, `approveListing` wiring, deploy, merge to main.
