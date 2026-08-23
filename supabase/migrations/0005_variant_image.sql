-- Adds a single representative image per product_variant (not per
-- canonical_product - colors/variants can look different; not per
-- source_listing - the picture shouldn't flip every time the price winner
-- changes between sources). Nullable: absence just means "no image yet",
-- rendered as a neutral fallback by the frontend, never a fake photo.
alter table product_variants add column if not exists image_url text;
