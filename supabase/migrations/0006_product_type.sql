-- Adds canonical_products.product_type: a real product taxonomy field (not
-- a search-only hack - every one of the 23 products registered as of this
-- migration maps to exactly one of these 9 slugs with no forcing; see the
-- read-only design review this migration follows). Used by searchProducts()'s
-- new product-type alias branch (src/domain/searchAliases.ts) alongside the
-- existing brand/official_name/model_sku search, never a replacement for it.
--
-- EXPAND-CONTRACT: this migration is the "expand" half only - it stops at
-- nullable + CHECK, deliberately WITHOUT `SET NOT NULL`. Between this
-- deploying and the new application code (which always sends product_type)
-- being live everywhere, the OLD app revision is still a writer that never
-- sends product_type - and if the new revision needs to be rolled back after
-- this migration is already applied, the old writer must still be able to
-- INSERT. A NOT NULL here would break both of those. The application layer
-- (CLI/admin form/API route) already treats product_type as required from
-- this same change - so the transitional state is "DB nullable, application
-- required": every NEW row still gets a real value in practice, the column
-- just isn't DB-enforced to have one yet.
--
-- The "contract" half - a FUTURE separate migration (not this one, not yet
-- created) - only happens once the new app has been deployed and confirmed
-- to be the sole writer for a while (i.e. a fresh NULL-count check reads 0
-- immediately before that migration runs): THEN, and only then, that later
-- migration adds `ALTER COLUMN product_type SET NOT NULL`.
--
-- This migration's own steps, each its own statement so a partial failure
-- stops before anything destructive:
--   1. add nullable column
--   2. backfill every EXISTING row by primary key (never by name-matching -
--      an official_name string can collide/typo; id cannot)
--   3. assert no NULL remains among today's rows (fails loudly rather than
--      silently leaving a row unbackfilled)
--   4. CHECK constraint - enumerates the exact 9 allowed slugs
-- (no step 5 here - SET NOT NULL is deferred to the future "contract" migration above)

-- 1. nullable column
alter table canonical_products add column if not exists product_type text;

-- 2. backfill by id (grouped by type for readability). These are the 23
-- canonical_products rows that existed in production at the time this
-- migration was written (confirmed read-only via listAllProducts(), never
-- guessed) - a product created after this migration runs already gets its
-- product_type at INSERT time (see CanonicalProductRepository.createProduct()),
-- so this backfill is a one-time catch-up for pre-existing rows only.

-- camera_lens (3)
update canonical_products set product_type = 'camera_lens' where id in (
  '8786e2d7-8f6f-417f-93a1-d6c441a48e68', -- Tamron 28-75mm F2.8 Di III VXD G2
  '1d3851e6-9f96-47ec-9bc8-bf07ac3f5998', -- Tamron 17-70mm F2.8 Di III-A VC RXD
  'e2a8994c-cef7-42a8-a433-1d134546f51d'  -- SIGMA 85mm F1.4 DG DN | Art
);

-- camera (4)
update canonical_products set product_type = 'camera' where id in (
  'dda4847e-b287-4eda-8241-f6ebd1ff3112', -- Insta360 X4
  '099c4f00-a7e1-49f5-abbf-ac4877ff674a', -- Sony RX100 VII
  '70d21084-8a8d-4097-960b-566d7f65f0aa', -- DJI Osmo Pocket 3
  'ef5921bc-1ece-447d-9434-e74640db01a8'  -- RICOH GR IIIx
);

-- smartwatch (2)
update canonical_products set product_type = 'smartwatch' where id in (
  'ef535c8a-4b1d-4cf6-917b-2a7c822c54c7', -- COROS PACE 3
  'e44c1275-ba0a-4f82-ac30-fa2f303b7841'  -- Garmin Venu 3
);

-- earbuds (3)
update canonical_products set product_type = 'earbuds' where id in (
  'f2a74f72-9988-47ac-bdee-a1c151d5fcdf', -- Nothing Ear (a)
  '9865f3f0-7ca0-475c-943d-c1632b7ce308', -- Apple AirPods Pro 3
  'f7074ae0-5c42-4269-915a-2122b88b3ba7'  -- Sony WF-1000XM5
);

-- headphones (2)
update canonical_products set product_type = 'headphones' where id in (
  'afb56579-4c3b-4973-b164-925d386f80a1', -- Sennheiser Momentum 4 Wireless
  'c5be8514-d1b1-4c17-ab5b-2093666f667c'  -- Sony WH-1000XM6
);

-- fins (2)
update canonical_products set product_type = 'fins' where id in (
  '8bf763eb-2b5a-4fe0-8247-c099408ff9f1', -- TUSA Solla Fins
  'e89bb291-e974-4589-971a-710bf7eacf46'  -- Mares Avanti Quattro Power
);

-- diving_mask (3)
update canonical_products set product_type = 'diving_mask' where id in (
  '185284c3-bcdb-4f42-bef3-afdd0ac32d98', -- Mares X-Vision Ultra Liquidskin
  '05e49a4f-7b3a-407f-85e8-6d0dec70f350', -- TUSA Freedom HD Mask
  '0c7a0cea-1e96-4c94-bea7-d3580413b28b'  -- GULL MANTIS5
);

-- wetsuit (1)
update canonical_products set product_type = 'wetsuit' where id in (
  '07dd2689-0fc0-4b15-9ef8-21d8eb3ebac8'  -- Mares Reef 3mm Wetsuit
);

-- dive_computer (3)
update canonical_products set product_type = 'dive_computer' where id in (
  '122a11cd-9c57-4f03-87d2-491898050384', -- Shearwater Research Peregrine
  '04add084-4c3d-4910-9586-48480648cc17', -- Suunto D5 Dive Computer
  'e2b1fabe-1eee-43b9-b770-05dc7c72458d'  -- Garmin Descent Mk3s (Steel/Fog Gray, 43mm)
);
-- total backfilled: 3+4+2+3+2+2+3+1+3 = 23

-- 3. fail loudly if any row (backfilled above, or created between this
-- migration being written and applied) is still NULL - a row this migration
-- doesn't know about should stop the migration, not silently stay NULL
-- forever with nothing left to catch it (there is no SET NOT NULL in this
-- migration to catch it later - see the expand-contract note above).
do $$
declare
  missing_count int;
begin
  select count(*) into missing_count from canonical_products where product_type is null;
  if missing_count > 0 then
    raise exception 'product_type backfill incomplete: % row(s) still NULL - add them to this migration before proceeding', missing_count;
  end if;
end $$;

-- 4. enumerate the exact allowed slugs (mirrors src/domain/searchAliases.ts's
-- PRODUCT_TYPES - keep both in sync by hand, there is no single source of
-- truth shared between SQL and TypeScript in this codebase). NULL is still
-- permitted by this CHECK (a NULL value never fails a CHECK constraint in
-- Postgres) - that's intentional, this is still the nullable "expand" phase.
alter table canonical_products add constraint canonical_products_product_type_check
  check (product_type in (
    'camera', 'camera_lens', 'earbuds', 'headphones', 'smartwatch',
    'dive_computer', 'diving_mask', 'fins', 'wetsuit'
  ));

-- No step 5 in this migration. SET NOT NULL is intentionally deferred to a
-- future migration, once the new application is confirmed to be the only
-- writer (see the expand-contract note at the top of this file).
