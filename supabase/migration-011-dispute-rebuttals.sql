-- Run this if you already ran migration-008/009 before rebuttals existed.
-- Fresh setups can just run schema.sql — it already includes this.

alter table build_registry_disputes add column if not exists rebuttal text;
alter table build_registry_disputes add column if not exists rebuttal_at timestamptz;
alter table build_registry_disputes add column if not exists resolved_at timestamptz;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
