-- refresh_lock: singleton row guarding the future scheduled-refresh Cloud
-- Run Job against duplicate concurrent executions (Cloud Scheduler
-- at-least-once delivery, or two Job executions overlapping). This table is
-- not read or written by any current production code path - nothing calls
-- SupabaseRefreshLeaseRepository yet (see src/repository/supabase/
-- RefreshLeaseRepository.ts) until the Job entrypoint itself exists, a later
-- step. Applying this migration alone changes nothing about how the app
-- currently behaves.
--
-- Access: no RLS, matching every other table in this schema (see
-- 0001_init.sql / 0003_grants.sql) - this project never issues a Supabase
-- anon/publishable key to any client (src/db/supabaseClient.ts's
-- getSupabaseClient() only ever authenticates as service_role), so
-- anon/authenticated already have zero table-level grants on ANYTHING in
-- this schema and are fully blocked without RLS. Enabling RLS on just this
-- one table would be inconsistent with that established convention and adds
-- no protection on top of it. service_role gets full access automatically
-- via 0003_grants.sql's `alter default privileges ... grant ... to
-- service_role`, which already covers every future table in this schema -
-- no new grant statement is needed here.
--
-- Singleton invariant: `id` is both the primary key (at most one row per
-- value) and CHECKed to equal the literal 'singleton' (no other id value
-- can ever be inserted) - together these guarantee AT MOST one row can ever
-- exist, and that if a row exists it must be this one. This does NOT
-- guarantee a row always exists: nothing in this schema stops a DELETE
-- (no trigger/rule is added here - disproportionate for this table's
-- scale), so an empty table is a state the constraint alone cannot rule
-- out. The seed insert below establishes the row at migration time only;
-- SupabaseRefreshLeaseRepository (src/repository/supabase/
-- RefreshLeaseRepository.ts) treats a missing singleton row at runtime as a
-- fatal configuration/invariant error, never as ordinary lock contention.
create table refresh_lock (
  id text primary key check (id = 'singleton'),
  run_id text,
  locked_at timestamptz,
  locked_until timestamptz
);

insert into refresh_lock (id, run_id, locked_at, locked_until)
values ('singleton', null, null, null);
