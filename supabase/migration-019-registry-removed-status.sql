-- Run this if you already ran migration-018 before 'removed' status existed
-- on build_registry. Fresh setups can just run schema.sql — it already
-- includes this.

alter table build_registry drop constraint if exists build_registry_status_check;
alter table build_registry add constraint build_registry_status_check
  check (status in ('active', 'disputed', 'confirmed_clone', 'confirmed_original', 'removed'));

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
