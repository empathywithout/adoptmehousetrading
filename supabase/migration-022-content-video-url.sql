-- Adds video_url to content_submissions — a link to a YouTube/Streamable/
-- etc. video guide, deliberately NOT a raw file upload (same reasoning as
-- listings.video_url: video storage/bandwidth costs scale far worse than
-- photos, and an external link offloads transcoding/playback to a platform
-- built for it). Body minimum also lowered from 800 to 300 chars since
-- video guides can be self-explanatory with shorter written context.

alter table content_submissions add column if not exists video_url text;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
