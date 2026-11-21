# Public price display safety audit — 2026-11-21

Scope: repository code at `fix/tripprice-p0-public-display-20261118` (16292c6). No production DB,
Cloud Run, Scheduler or network access was used, so **live row counts were not measured**
(a read-only SQL for the operator is at the end).

## 1. Source classification (what can reach public pages)

| sources.id | Region | Origin of data | Public surfaces it can feed | Image hosts |
| --- | --- | --- | --- | --- |
| `rakuten` | JP | Rakuten Ichiba Item Search API (`src/adapters/rakuten.ts`) | price, stock, seller URL (affiliate), shipping status, FX-converted KRW, JSON-LD Offer, `variant.image_url` backfill | rakuten.co.jp, r10s.jp |
| `coupang` | KR | Coupang Partners Open API (`src/adapters/coupang.ts`) | same set | coupang.com, coupangcdn.com |
| (none else) | — | `supabase/migrations/0002_seed_sources.sql` seeds only these two | — | unknown host => withheld |

Not public-price sources: manual/admin-entered values would still be tied to a `source_id`, so they
fall under the same gate. The offline WAU audit (separate branch) never feeds public pages.

## 2. Public data-use permission status

| Source | Permission to republish price/stock/image publicly | Evidence in repo |
| --- | --- | --- |
| `rakuten` | **Unconfirmed** | none (docs only note API usability and shipping caveats) |
| `coupang` | **Unconfirmed** | none |

Being able to call an API, or a human approving a match, is not a data-use grant. Nothing was
assumed: both stay denied until the operator records written confirmation (terms clause/contract
reference, date, scope: price / stock / image / seller link / cache period) and then adds the id to
`PUBLIC_PRICE_SOURCES`.

## 3. Gate review (`PUBLIC_PRICE_SOURCES`)

Sound: default deny; no wildcard (`all`/`true`/`*` ignored); lowercase id allowlist; read per request
(pages are `force-dynamic`, change/revert without rebuild); images allowed only from hosts of allowed
sources, unknown hosts withheld; DB, `price_history`, matching and refresh untouched.

Surface consistency (all verified by tests):

| Surface | Gate | Result under default deny |
| --- | --- | --- |
| Home gaps / recent / hero | `catalogService` → `buildEntry` filters listings + image | empty → **now falls back to price-free product cards** |
| Category, search | same | products listed, "가격 정보 없음", placeholder image |
| Product page SSR / price rows / timestamps / FX / analytics | `preparePublicListings` | no price; "withheld" wording instead of "no seller" |
| JSON-LD | built only from filtered quotes; omitted if no offers | no JSON-LD |
| Metadata / OG image | filtered variant image; description says no price | no image, no price claim |
| Variant/card/hero images | `withPublicImage` | placeholder |
| Sitemap / robots | URLs only | unchanged (product URLs still listed) |

Test result: `publicSurfaces.static.test.ts` also guards that no (site) file other than the product
page reads raw listings and that every `next.config` image host is covered by the image policy.

## 4. Side effects of default deny

1. All prices, comparisons and listing images vanish — intended until permission is confirmed.
2. Home used to render empty sections ("아직 비교할 상품이 없어요"); fixed: price-free "상품 둘러보기".
3. Category/search/product navigation and product names, brand, model, variant info remain.
4. Residual: product pages without a public price remain indexable and in the sitemap (thin
   content). Option, not implemented: `noindex` when no public price.
5. Tokens are trimmed/lowercased, but a misspelled id (e.g. `coupan`) silently hides that source;
   there is no startup warning. Verify prices appear after setting the variable.
6. Source-region note: allowing only one source (e.g. coupang) yields a single-market view with
   no KR↔JP comparison; the page wording already handles this.

## 5. Operator SQL (read-only, run yourself)

```sql
select s.id, s.region, count(*) filter (where l.last_known_price is not null) as priced,
       count(*) filter (where l.last_known_availability is false) as out_of_stock, count(*) as listings
from source_listings l join sources s on s.id = l.source_id group by 1,2;
select split_part(split_part(image_url,'//',2),'/',1) as host, count(*)
from product_variants where image_url is not null group by 1;
```
