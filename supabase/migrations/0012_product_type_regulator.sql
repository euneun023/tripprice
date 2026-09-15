-- Expand canonical_products.product_type's allowed slugs by one: 'regulator'.
-- Mirrors 0010_product_type_dive_light.sql / 0011_product_type_bcd.sql's
-- CHECK constraint exactly, just with the new slug added - no other change
-- (no backfill needed here, since no existing row uses 'regulator' yet; this
-- is purely opening the door for future INSERTs to use it). Keep this list in
-- sync by hand with src/domain/searchAliases.ts's PRODUCT_TYPES (same
-- convention 0006/0010/0011 already established - there is no single source
-- of truth shared between SQL and TypeScript in this codebase).
--
-- regulator's canonical identity (1st+2nd stage set only; DIN/Yoke and
-- octopus-inclusion are variant_attributes, not separate canonicals/product_types)
-- is documented in the design Gate this migration follows - no schema change
-- beyond this CHECK constraint is needed for that (variant_attributes is
-- already a free-form jsonb-ish column, same as how camera_lens's `mount`
-- key already works).
--
-- No BEGIN/COMMIT here on purpose - same convention as 0006/0007/0010/0011
-- (this file is the source-of-truth migration body only; a manual SQL Editor
-- apply wraps this exact body in its own BEGIN/COMMIT at apply time).

-- 1. drop the old constraint (11 slugs)
alter table canonical_products drop constraint canonical_products_product_type_check;

-- 2. re-add it with the 12th slug included
alter table canonical_products add constraint canonical_products_product_type_check
  check (product_type in (
    'camera', 'camera_lens', 'earbuds', 'headphones', 'smartwatch',
    'dive_computer', 'diving_mask', 'fins', 'wetsuit', 'dive_light', 'bcd',
    'regulator'
  ));
