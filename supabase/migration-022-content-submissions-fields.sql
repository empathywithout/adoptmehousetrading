-- content-submit.js already accepts video_url and cover_photo but the
-- initial migration (015) may not have added them if the table was created
-- from that older migration rather than the current schema.sql.

alter table content_submissions add column if not exists cover_photo text;
alter table content_submissions add column if not exists video_url text;
alter table content_submissions add column if not exists house_id text;
alter table content_submissions add column if not exists related_registry_entry_id uuid references build_registry(id) on delete set null;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
