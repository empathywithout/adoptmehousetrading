-- Run this if you already ran migration-008-build-registry.sql before
-- included_items existed on build_registry. Fresh setups can just run
-- schema.sql — it already includes this.

alter table build_registry add column if not exists included_items jsonb not null default '[]';

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
