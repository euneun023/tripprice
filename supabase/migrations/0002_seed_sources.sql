-- Seed the two sources verified live in Phase 0/0.5 PoC.
-- automation_status/region reflect what was actually confirmed by real calls,
-- not aspirational values.

insert into sources (id, name, region, update_method, automation_status, default_stale_after_hours, rate_limit_per_hour)
values
  ('rakuten', 'Rakuten Ichiba (Item Search API)', 'JP', 'api', 'semi-auto', 24, null),
  ('coupang', 'Coupang Partners (Affiliate Open API)', 'KR', 'api', 'semi-auto', 24, 10)
on conflict (id) do nothing;
