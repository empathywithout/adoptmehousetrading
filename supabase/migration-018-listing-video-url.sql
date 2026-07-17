-- Run this if you already ran migration-017 before video_url existed.
-- Fresh setups can just run schema.sql — it already includes this.

alter table listings add column if not exists video_url text;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
