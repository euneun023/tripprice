-- Shipping cost handling, 1st pass (see the read-only audit this migration
-- follows): preserves ONLY which of three states a listing/price snapshot is
-- in - never an actual shipping fee amount. Neither Rakuten's Item Search
-- API nor Coupang's Partners Open API reliably provides a shipping fee in
-- currency (Rakuten: postageFlag, included/separate only; Coupang:
-- isFreeShipping, a boolean) - so estimating one here would be inventing
-- data no source actually gives us. See src/domain/types.ts's ShippingStatus
-- type, which this column mirrors 1:1.
--
-- `not null default 'unknown'` from the start (unlike 0006_product_type.sql's
-- nullable expand-contract dance) is safe in one step here: Postgres
-- backfills every existing row with the DEFAULT for a NOT NULL column added
-- this way (fast path, no full table rewrite, since 'unknown' is a constant)
-- - there is no old application writer that needs to keep inserting without
-- this column the way product_type's rollout had to accommodate.
--
-- source_listings: current best-known shipping status for the mapped listing
-- (same "current state" role last_known_price/last_known_availability play).
alter table source_listings
  add column shipping_status text not null default 'unknown'
    check (shipping_status in ('included', 'separate', 'unknown'));

-- price_history: point-in-time snapshot alongside price/currency/krw_price,
-- so a listing's shipping status at each checked_at is preserved even if it
-- later changes (e.g. a seller switches from included to separate shipping).
alter table price_history
  add column shipping_status text not null default 'unknown'
    check (shipping_status in ('included', 'separate', 'unknown'));

-- Deliberately NOT added in this migration: any shipping_fee_krw/shipping_fee
-- column. No source gives us a real amount - adding a numeric column now
-- would only invite a future caller to fill it with a guess. If a reliable
-- amount source is ever found, that is a separate, later migration.
