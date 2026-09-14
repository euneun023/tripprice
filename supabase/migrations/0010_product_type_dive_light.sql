-- Expand canonical_products.product_type's allowed slugs by one: 'dive_light'.
-- Mirrors 0006_product_type.sql's CHECK constraint exactly, just with the
-- new slug added - no other change (no backfill needed here, since no
-- existing row uses 'dive_light' yet; this is purely opening the door for
-- future INSERTs to use it). Keep this list in sync by hand with
-- src/domain/searchAliases.ts's PRODUCT_TYPES (same convention 0006 already
-- established - there is no single source of truth shared between SQL and
-- TypeScript in this codebase).
--
-- regulator/bcd are intentionally NOT added here - out of scope for this
-- migration, per the read-only Gate analysis this follows.
--
-- No BEGIN/COMMIT here on purpose - same convention as 0006/0007 (this file
-- is the source-of-truth migration body only; a manual SQL Editor apply
-- wraps this exact body in its own BEGIN/COMMIT at apply time).

-- 1. drop the old constraint (9 slugs)
alter table canonical_products drop constraint canonical_products_product_type_check;

-- 2. re-add it with the 10th slug included
alter table canonical_products add constraint canonical_products_product_type_check
  check (product_type in (
    'camera', 'camera_lens', 'earbuds', 'headphones', 'smartwatch',
    'dive_computer', 'diving_mask', 'fins', 'wetsuit', 'dive_light'
  ));
