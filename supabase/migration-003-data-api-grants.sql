-- Run this if you already ran schema.sql and are hitting:
--   { code: 'PGRST125', message: 'Invalid path specified in request URL' }
-- Supabase changed its default so new tables aren't auto-exposed to the
-- Data API anymore — this grants the service_role key (the only one our
-- Netlify Functions use) access to everything, and makes sure future
-- tables get the same treatment automatically.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
