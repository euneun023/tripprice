# WAU offline feed review

This branch adds an offline staging boundary only. It does not register a source,
create listings, refresh prices, touch Supabase, run Cloud Run/Scheduler, or publish
prices. Keep supplied feeds and generated price reports outside this public repository.

## Run

Requires Node 22+ and the existing root dependencies. No new dependency was added.

```sh
npm ci --ignore-scripts
npm run test:wau
npx tsc --noEmit -p tsconfig.json
npm run audit:wau -- /private/KR.csv /private/JP.csv /private/review.csv /private/new-output 2026-11-21
```

The date is an explicit evidence cutoff, not a fetch timestamp. The provided review
is dated 2026-11-20. Running with 2026-11-20 reconstructs that snapshot; running with
2026-11-21 marks every observation historical. This is a conservative local review
policy, not a provider TTL or a legal caching rule. There is no live product probe.
The output directory must not already exist. Duplicate keys or malformed CSV abort
before output creation; missing counterparts appear as problem rows in the ID union.

## Outputs and interpretation

| File | Meaning |
| --- | --- |
| all-products.csv | Every ID from either feed or review, with match basis, original/observed prices, deltas, stock and issues |
| verified-products.csv | Supplied same-date observations with strong identity and both purchase buttons reported; observed price may differ from feed |
| problem-products.csv | Complement of the verified snapshot; exact reasons retained |
| staging.json | Same audit records for a future internal review interface, never publishable listings |
| summary.json | Counts, evidence scope and SHA-256 hashes for reproducibility |

`snapshotVerified` means corroborated against the supplied review CSV, not independently
verified by this process, a live checkout, or permission to display. Price discrepancies
remain flagged even in a verified observation. Every row has `publicationAllowed:false`.
`problem-products.csv` is a snapshot classification, not a list of all publication holds;
publication holds apply to verified rows too. No raw description/image/affiliate token
is copied into staging. Spreadsheet formula payloads in string cells are neutralized.

## Identity and evidence precedence

Require advertiser 124878, WAU brand, same feed ID and no conflicting GTIN/MPN,
condition or variant attributes. Valid GTIN+feed ID is strongest, brand+MPN+feed ID
next. Feed ID alone is held. This proves correspondence within supplied feeds only,
not independent manufacturer authentication or uniqueness in production.

Use a valid sale price when present, otherwise regular price, with strict positive
amount/currency checks. A nonempty promotion window is held because the feed fetch
time is absent. Supplied review prices are retained as separate observations, never
silently substituted into a domain listing. Missing/zero price is unknown, not free.

Explicit sold-out status overrides `in_stock` in the feed. Catalog text alone yields
`null` availability. A manual exclusion is preserved, and 404 status is distinct from
a usable replacement URL. Older evidence is never stamped with today's verification.

Both files represent one global merchant. A language/currency label is insufficient
to establish a seller country, stock location, destination, checkout currency or tax
basis. Generic `/products/` URLs are valid but do not establish locale. Even `/ko/`
and `/ja/` establish language only. Do not create two country-specific sources from
these labels. Keep shipping unknown and do not compute a consumer savings ranking.

## Existing code reuse and future connection points

| Existing component | Reuse / deferred action |
| --- | --- |
| src/domain/url.ts | HTTP(S) boundary reused, with a tighter WAU host/path allowlist |
| src/domain/types.ts | ShippingStatus reused; staging intentionally has no DB input shape |
| src/adapters/rakuten.ts | Existing Japan merchant API integration is the first expansion candidate; no duplicate client |
| src/services/mappingService.ts | Future human-reviewed mapping, only after rights/market and production duplicate checks |
| src/services/refreshService.ts | Future approved-listing refresh, after a feed-specific authenticated acquisition design |
| src/domain/pricing.ts | Future approved offers can reuse FX; this audit makes no FX call and does not reuse a dated FX rate as current |

A later approved bridge must record provider, advertiser/feed ID, locale, verified
market country, acquisition time, observed time, evidence URL/variant, price currency,
availability and rights evidence/version/expiry. Production external-ID uniqueness
and canonical/variant duplication must be checked against the live DB in a separately
authorized task. Local CSV identity is not that production gate. The bridge must not
turn this staging JSON directly into `NewSourceListingInput` or accept a caller flag
that bypasses the publication block.

## Validation

`npm run test:wau` covers CSV quoting/BOM/newlines, formula defense, GTIN checksum,
identity conflicts, absent counterparts/duplicates, observed-vs-feed price, explicit
exclusion, stock/404 precedence, missing purchase evidence, locale uncertainty,
currency/promotion checks, evidence drift, date freshness, CLI output/hash creation
and refusal to overwrite. Tests are synthetic and offline. No CI/deployment workflow,
database migration, refresh job or web route is changed.
