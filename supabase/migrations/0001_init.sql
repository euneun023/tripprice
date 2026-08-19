-- Phase 1 initial schema.
-- Category-agnostic on purpose: no table or column here assumes diving,
-- or any other single vertical. "category" is free text on canonical_products.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- sources: the channels we can pull prices from (Rakuten, Coupang, ...)
-- ---------------------------------------------------------------------
create table sources (
  id text primary key,                 -- 'rakuten' | 'coupang' | 'tradeinn' | 'manual-kr' | ...
  name text not null,
  region text not null check (region in ('KR','JP','INTL')),
  update_method text not null check (update_method in ('api','feed','manual')),
  automation_status text not null check (automation_status in ('auto','semi-auto','manual','failed')),
  default_stale_after_hours int not null default 24,
  rate_limit_per_hour int,             -- nullable; scheduler pacing hint, not enforced by DB
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- canonical_products: our own concept of a product, source-independent.
-- ---------------------------------------------------------------------
create table canonical_products (
  id uuid primary key default gen_random_uuid(),
  category text not null,              -- free text: 'diving' | 'beauty' | 'fashion' | 'electronics' | 'household' | ...
  brand text not null,
  official_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_canonical_products_category on canonical_products(category);

-- ---------------------------------------------------------------------
-- product_variants: the actual sellable unit (color/size/capacity/model).
-- A product with no meaningful variant differentiation still gets exactly
-- one variant row (variant_attributes = '{}') - source_listings always
-- points at a variant, never directly at a canonical_product, so there is
-- one FK path regardless of whether the product "has variants" or not.
-- ---------------------------------------------------------------------
create table product_variants (
  id uuid primary key default gen_random_uuid(),
  canonical_product_id uuid not null references canonical_products(id) on delete cascade,
  variant_attributes jsonb not null default '{}'::jsonb,  -- e.g. {"color":"Black/White","size":"270"}
  model_sku text,                      -- official manufacturer identifier, if known (PoC: often unknown)
  display_name text,
  created_at timestamptz not null default now(),
  unique (canonical_product_id, variant_attributes)
);

create index idx_variants_product on product_variants(canonical_product_id);

-- ---------------------------------------------------------------------
-- source_listings: a human-approved mapping from one product_variant to
-- one listing on one source. This is the mapping the PoC proved has to be
-- semi-automatic - search only ever produces candidates, never an
-- auto-confirmed row.
-- ---------------------------------------------------------------------
create table source_listings (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references product_variants(id) on delete cascade,
  source_id text not null references sources(id),

  external_id text not null,           -- Rakuten: itemCode ("shopCode:itemUrl") / Coupang: productId
  external_id_type text not null,      -- 'rakuten_item_code' | 'coupang_product_id' | ...
  source_url text,                     -- informational ONLY. Confirmed live in PoC: Coupang's productUrl
                                        -- is always the same "/re/AFFSDP" redirect path with identity
                                        -- encoded only in volatile tracking query params - never use this
                                        -- column to decide identity, only external_id.
  search_keyword_used text not null,   -- fallback re-search keyword, captured at approval time

  approved_at timestamptz not null default now(),
  approved_by text not null,
  confidence text not null check (confidence in ('verified','estimated')),

  last_checked_at timestamptz,
  last_success_at timestamptz,
  stale_after_hours int not null default 24,

  review_required boolean not null default false,
  review_reason text check (review_reason in ('NOT_FOUND','PRICE_JUMP','OUT_OF_STOCK','AMBIGUOUS_MATCH','STALE')),

  last_known_price numeric,
  last_known_currency text,
  last_known_availability boolean,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one (source, external_id) maps to exactly one product_variant
  unique (source_id, external_id)
);

create index idx_listings_variant on source_listings(product_variant_id) where is_active;
create index idx_listings_review_queue on source_listings(review_required, updated_at) where review_required and is_active;
create index idx_listings_due on source_listings(source_id, last_checked_at nulls first) where is_active;

-- ---------------------------------------------------------------------
-- price_history: append-only, but NOT appended on every poll. Only on a
-- meaningful state transition (price change, availability change, or the
-- first successful read). A same-price re-check only touches
-- source_listings.last_checked_at.
-- ---------------------------------------------------------------------
create table price_history (
  id bigserial primary key,
  source_listing_id uuid not null references source_listings(id) on delete cascade,
  price numeric,
  currency text,
  krw_price numeric,
  fx_rate_used numeric,
  availability boolean,
  outcome text not null check (outcome in ('success','not_found','error')),
  change_reason text check (change_reason in ('initial','price_change','availability_change','manual')),
  checked_at timestamptz not null default now()
);

create index idx_price_history_listing_time on price_history(source_listing_id, checked_at desc);

-- ---------------------------------------------------------------------
-- fx_rates: small cache, refreshed independently of any product source.
-- ---------------------------------------------------------------------
create table fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  target_currency text not null,
  rate numeric not null,
  fetched_at timestamptz not null default now()
);

create index idx_fx_rates_lookup on fx_rates(base_currency, target_currency, fetched_at desc);

-- ---------------------------------------------------------------------
-- affiliate_programs: monetization metadata ONLY. The comparison/ranking
-- service must never join this table - see src/services/comparisonService.ts.
-- ---------------------------------------------------------------------
create table affiliate_programs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references sources(id),
  program_name text not null,
  commission_rate numeric,
  region_scope text,
  kr_traffic_status text not null check (kr_traffic_status in ('confirmed','unconfirmed','excluded')),
  notes text
);

-- ---------------------------------------------------------------------
-- review_actions: audit trail of how a flagged listing was resolved.
-- ---------------------------------------------------------------------
create table review_actions (
  id uuid primary key default gen_random_uuid(),
  source_listing_id uuid not null references source_listings(id) on delete cascade,
  reason text not null,
  detected_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('approved_new_price','remapped','deactivated','snoozed')),
  note text,
  created_at timestamptz not null default now()
);
