# Release candidate: P0 public price safety — 2026-11-21

Branch `release/p0-public-price-safety-rc-20261121` = `fix/tripprice-p0-public-display-20261118`
(16292c6) + audit branch (`e9d3144`) + RC copy/SEO fixes. Base `d313d64` == origin/main.
The unrelated WAU audit branch is NOT included.

## Prerequisites (operator)
1. Production runs: record the deployed image tag (`git-<sha>`) and compare with `d313d64`
   (could not be read here: no GCP credentials). Expected: the RC is exactly main + 3 commits.
2. Decide `PUBLIC_PRICE_SOURCES`. Empty = no price/image/seller link anywhere (safe default).
   Add `coupang` / `rakuten` only after written data-use permission.

## Deploy (operator, not done here)
1. Build web image from the RC commit (`cloudbuild.web.yaml`, tag `git-<sha>`).
2. Deploy as a NEW revision with 0% traffic and a tag; set/leave `PUBLIC_PRICE_SOURCES` empty.
3. Smoke on the tagged URL: `/`, `/categories/<slug>`, `/search?q=...`, `/products/<id>`:
   products render, no ¥/원 prices, no seller links, no product images, product page has
   `noindex` and no `application/ld+json`; `/sitemap.xml`, `/robots.txt`, `/admin` 401.
4. Shift traffic only after the smoke passes. Refresh Job / Scheduler are untouched (DB data keeps updating).

## Rollback
- Fast: route traffic back to the previous revision (no data change needed; DB untouched).
- Re-expose a source: set `PUBLIC_PRICE_SOURCES=<id>` (per-request read, no rebuild) — only with permission.

## User impact (empty PUBLIC_PRICE_SOURCES)
- All prices, comparisons, savings, seller links and product images disappear; names, brands,
  model numbers, categories, search keep working. Home shows "상품 둘러보기".
- Price-less product pages become `noindex,follow` and lose "가격 비교" from title/description,
  so search traffic to those pages will decline until prices are allowed again. Sitemap still lists them.
- Analytics: comparison_mode will be "no-data" for all views.
