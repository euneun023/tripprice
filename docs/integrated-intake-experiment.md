# A + B integration experiment (2026-11-04)

Branch: integration experiment only. Not merged to `main`, not deployed, no DB, no external API call, no secret read.

| | Branch | Provides |
|---|---|---|
| A | `claude/tripprice-data-sources-athvmw` | `adapters/rakutenProduct.ts` (Product Search: `productNo`, `makerName`), `seed-catalog-from-rakuten.ts`, rate-limit probe, research doc |
| B | `claude/tripprice-multi-source-matching-xk6fva` | `domain/providerListing.ts`, `services/listingIntakeService.ts` (dedupe → model id → grouping → triage), synthetic generator, review worklist |

Both branched from `main` d313d64; the only overlapping file was `package.json` (different hunks, auto-merged, all 5 new scripts kept).

## The gap that was found

Nothing connected A's output to B's input: A emits `RakutenProduct`, B only accepts `ProviderListing`. Added one bridge,
`src/services/rakutenProductIntake.ts` (`mapRakutenProduct`, `buildRakutenProductBatch`), no matching logic of its own:

- provider `rakuten_product`, not `rakuten` (a `productId` and an approved `itemCode` are different ID spaces)
- `productNo → modelNumber`, `makerName → manufacturer`, NFKC-folded (full-width `ＩＬＣＥ－７Ｍ５` previously failed to link to the catalog); suffixes/hyphens untouched
- emptied `salesMinPrice` → `price: null` → HOLD `no_price` (not "malformed", which would fail the whole batch)
- availability only from a stated listing count; `null` stays UNKNOWN
- usage rights never defaulted to granted

## Results (`npm run intake:integrated`, aggregates in `integrated-intake-results.json`)

Real and synthetic numbers are separate and must not be summed.

**REAL (Git identities, no supplier price/stock):** 499 rows → 448 unique identities. Only **7** of them have a model number the catalog can code-match; 387 link by name only (weak), 54 unlinked. 4 existing approved mappings → 4 AUTO_REFRESH (price refresh only, as designed).

**SYNTHETIC over the real catalog:** 20 fabricated Rakuten Product rows (1 malformed rejected) + 9 Coupang items → 28 listings → 18 REVIEW in 8 batches (7 weak, 1 strong), 5 AUTO_DROP, 5 HOLD, 0 AUTO_REFRESH. Only 7 real identities could produce code-matched pairs, which is why this is small.

**SYNTHETIC scale (3000 fabricated models):** 7,237 Rakuten + 3,430 Coupang rows → 10,443 listings → 7,733 REVIEW in 3,430 batches, 1,772 AUTO_DROP, 938 HOLD; ~15k listings/s. Ground-truth wrong outcomes: 0 (templated titles, so this proves processing and safety, **not** real-world accuracy).

**Safety (all runs):** first mappings never auto-approved (AUTO_REFRESH 0); rights undeclared → 0 REVIEW, everything HOLD; Rakuten fetch failure → previous state kept identically; re-run identical.

## Not connected yet

- Live Rakuten Product Search never called: field names (esp. how often `productNo` is filled) remain unverified.
- Data-usage rights for Rakuten/Coupang unconfirmed; pipeline therefore HOLDs them by default. `granted` in the experiment only declares a fixture.
- A's `CandidateSeed` output is not turned into B `CatalogEntry`/variantIds; review worklist is not wired to `approveListing()` or any DB.
- Coupang live search is not driven by this runner (only the mapper is exercised).
- JAN is not carried by `ProviderListing`.
- `bcd-candidates.review.json` (raw review results) is not in Git: 4 pre-existing tests fail with ENOENT on `main` too.
