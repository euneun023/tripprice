# Feed access and monetization review — 2026-11-21 KST

Scope: public official documentation and the existing repository. Account approval,
commercial rates, payouts and advertiser-specific rights are not established by this
review. No login, credential request, outbound message or production API call occurred.

## Candidate order

| Priority | Candidate | Publicly documented capability | Project fit | Unresolved before commercial use |
| --- | --- | --- | --- | --- |
| 1 | Rakuten Ichiba Item Search API | Japan merchant search with item price, availability, shipping signals and optional affiliate links | Existing src/adapters/rakuten.ts already targets the documented 20260701 endpoint; reuse it | Current application/account authorization, applicable affiliate/payment eligibility, storage/refresh rules, attribution and exact variant identity; international shipping is separate |
| 2 | Awin advertiser feeds | Product details/prices/images/deep links; feed list contains advertiser, language, primary region and last-import information | Reuse the new offline boundary to qualify feeds first | WAU membership/soft-membership status and advertiser-specific terms; approved site/method/territory; display, image, caching/history and raw redistribution rights |
| 3 | eBay Feed API | Bulk marketplace/category files and updates | Potential later bulk source; do not build another client now | Limited-release production permission, EPN membership and contracts, marketplace/category access and affiliate linking requirements |

These are documented provider routes, not newly approved merchant feeds. No estimate
of commission, catalogue coverage, revenue or approval likelihood is made. WAU
locale exports are not evidence of two independent national retail markets.

## Public evidence

- [Rakuten API documentation](https://webservice.rakuten.co.jp/documentation/ichiba-item-search): current version requires applicationId plus accessKey; affiliateId is optional and changes returned links. The existing adapter already follows the endpoint/auth shape. The terms pages timed out, so caching/retention permission remains unresolved.
- [Awin publisher feed guide](https://help.awin.com/developers/docs/product-feed-publisher-guide-intro): feeds are intended for product promotion including price comparison.
- [Awin feed list documentation](https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds): compare Last Imported before downloading changed feeds; account-accessible feeds can include joined advertisers and some pre-join promotions. Do not assume this proves WAU's status.
- [Awin publisher FAQ](https://help.awin.com/developers/docs/faqs-for-publishers): soft membership applies to selected advertisers; feed defects are an advertiser/account-manager issue.
- [Awin programme FAQ](https://www.awin.com/gb/faqs): advertiser-specific conditions determine accepted promotional methods. WAU's account-only terms were deliberately deferred.
- [eBay requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html) and [Feed API](https://developer.ebay.com/api-docs/buy/static/api-feed.html): bulk production access is restricted; approval and EPN participation must be established before implementation investment.
- [WAU terms](https://wauglobal.com/policies/terms-of-service): general storefront content permission is limited, and the general price clause excludes additional charges unless stated otherwise. A separate affiliate/feed agreement could grant rights; it was not available here.
- [WAU shipping policy](https://wauglobal.com/policies/shipping-policy): its tax statement differs from the general price clause. Treat tax/shipping/customs totals as unresolved for a concrete destination/order.
- [WAU Korean](https://wauglobal.com/ko) and [Japanese](https://wauglobal.com/ja) storefront pages: retrieved views had Korean/Japanese language respectively but France/EUR market selectors. This supports treating language and checkout country as independent; these views do not validate KRW/JPY prices or current stock for all products.

## Evidence required to remove commercial holds

| Item | Evidence to retain | Current status |
| --- | --- | --- |
| Publisher / advertiser access | Joined or applicable soft-membership status, effective dates, site/domain approval | Unconfirmed; account work deferred |
| Display permission | Governing programme/contract version, approved comparison method and territories | Unconfirmed |
| Images/descriptions | Reuse/caching permission and attribution requirements | Unconfirmed; not exported by the new staging format |
| Price storage/history | Allowed cache age, refresh duty, retention and permission for derived/history data | Unconfirmed; no invented TTL |
| Distribution | Whether raw CSV/API resale or sharing outside the approved site is permitted | Unconfirmed; no raw feed/results committed to public GitHub |
| Markets and totals | Seller/dispatch country, destination, currency, variant, tax/shipping and checkout evidence | Unconfirmed; no savings ranking |
| Revenue eligibility | Approved tracking method, applicable rate/exclusions, return/reversal rules, payout and territory eligibility | Unconfirmed; no revenue promise |

Suggested enquiry text for later use (not sent):

> We operate Tripprice, a comparison service. Please confirm whether our approved
> publisher programme permits comparing your locale/currency prices, displaying
> prices and images on our domain, caching current data and retaining price history.
> Please identify the governing terms, permitted regions, refresh/deletion duties,
> required attribution and tracking links, and confirm how locale/currency exports
> map to checkout countries, taxes and delivery eligibility. We do not plan raw-feed
> resale or redistribution without separate permission.

## Next three actions

1. Establish WAU programme rights and market mapping together; if the same product
   cannot actually be purchased under distinct verified KR/JP conditions, keep WAU
   as a global merchant/engineering fixture rather than a country-arbitrage source.
2. Recheck the five historical dual-button observations under explicit KR/JP
   destination/currency settings, then the two broken links and eight excluded
   products. Only if that succeeds expand to the remaining catalog-only items.
3. Select one permitted Japan merchant route through the existing Rakuten adapter
   (or one approved Awin advertiser), obtain fresh evidence, and run a new local
   audit before any separately authorized production duplicate check/import.
