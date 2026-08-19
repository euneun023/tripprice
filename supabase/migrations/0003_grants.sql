-- Fix: service_role had no privileges on the tables created in 0001/0002.
-- Our repository layer (src/repository/supabase/*) always connects as
-- service_role (server/CLI only, never exposed client-side), so it needs
-- explicit grants - Supabase doesn't do this automatically for tables
-- created via a plain SQL migration.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
