-- Expand-contract "contract" half for canonical_products.product_type - see
-- 0006_product_type.sql's header for the full rationale. 0006 deliberately
-- stopped at nullable + CHECK; this migration does the ONE thing 0006
-- explicitly deferred: SET NOT NULL. Nothing else.
--
-- Do not run this until BOTH are true (verified read-only, not assumed):
--   1. every current writer of canonical_products (CanonicalProductRepository
--      .createProduct() and every caller of it - admin API route, CLI
--      seed-product, any fixture script) already sends a real ProductType on
--      every INSERT (confirmed for the current app as of the
--      "e158807"/Search V2 deploy and its immediate predecessor "cf12e22" -
--      see the writer census this migration follows).
--   2. a fresh NULL-count check on production reads 0 immediately before
--      this migration runs (not just "it read 0 once earlier" - a stale
--      check is exactly what step 1 below re-verifies at apply time anyway).
--
-- This migration touches product_type and NOTHING else: no backfill
-- re-run, no UPDATE, no CHECK constraint re-creation (0006's
-- canonical_products_product_type_check already covers valid values and is
-- untouched here), no column re-creation, no DROP/DELETE/TRUNCATE, no other
-- table or schema change.
--
-- No BEGIN/COMMIT here on purpose - this file is the source-of-truth
-- migration body only (same convention as 0006_product_type.sql). A manual
-- SQL Editor apply wraps this exact body in its own BEGIN/COMMIT at that
-- time (same pattern used for 0006's apply), so the NULL-guard below still
-- rolls back SET NOT NULL atomically if it raises - that's an apply-time
-- concern, not something this file itself needs to declare.

-- 1. Fail loudly if any row still has NULL product_type - never let
-- SET NOT NULL below be the first thing to discover a missed row (that
-- would fail anyway, but with a less specific error and no chance to see
-- how many/which rows first).
do $$
declare
  missing_count int;
begin
  select count(*) into missing_count from canonical_products where product_type is null;
  if missing_count > 0 then
    raise exception 'product_type SET NOT NULL blocked: % row(s) still NULL - resolve them (see 0006_product_type.sql) before re-running this migration', missing_count;
  end if;
end $$;

-- 2. Only reached if the guard above passed - every row already has a
-- valid, non-null product_type.
alter table canonical_products alter column product_type set not null;
