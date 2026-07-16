-- BREAKING CHANGE: replaces PIN-based re-claiming with real email+password
-- accounts, and adds a public display_name separate from the (now private)
-- Roblox username. Given how early-stage this site is, this is a clean
-- break rather than a data-preserving migration — any profiles created
-- before this point don't have an email/password/display_name and will
-- need to sign up again through the new flow.

-- Drops the legacy NOT NULL constraint from before the sessions table
-- existed — safe to run even if migration-006 already did this.
alter table profiles alter column session_token_hash drop not null;

alter table profiles add column if not exists email text;
alter table profiles add column if not exists password_hash text;
alter table profiles add column if not exists password_salt text;
alter table profiles add column if not exists display_name text;

-- If you have zero real profiles yet (likely, given how early this is),
-- the constraints below just work. If you have test profiles without
-- email/password/display_name set, either delete them first or give them
-- placeholder values before running the NOT NULL + UNIQUE constraints:
--   delete from profiles where email is null;

alter table profiles alter column email set not null;
alter table profiles alter column password_hash set not null;
alter table profiles alter column password_salt set not null;
alter table profiles alter column display_name set not null;

alter table profiles add constraint profiles_email_unique unique (email);
alter table profiles add constraint profiles_display_name_unique unique (display_name);

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
