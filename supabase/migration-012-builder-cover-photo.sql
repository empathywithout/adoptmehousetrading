-- Run this if you already ran schema.sql before featured_registry_entry_id
-- existed. Fresh setups can just run schema.sql — it already includes this.

alter table profiles add column if not exists featured_registry_entry_id uuid references build_registry(id);

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
