-- The content_submissions table was created with placeholder categories
-- (build_guide/how_to/tips/other) but the backend functions always used the
-- real categories (theme_build/budget_build/building_technique/trading_guide).
-- This fixes the DB constraint to match what the backend actually accepts.

alter table content_submissions drop constraint if exists content_submissions_category_check;
alter table content_submissions add constraint content_submissions_category_check
  check (category in ('theme_build', 'budget_build', 'building_technique', 'trading_guide'));

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
