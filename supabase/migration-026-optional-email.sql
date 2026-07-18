-- Make email optional on profiles.
-- Existing users are completely unaffected:
--   - Their email rows are untouched (NOT NULL only prevents future NULLs)
--   - Their login path (email + @) is unchanged
--   - All active sessions survive (keyed on profile_id, not email)
-- New users can now sign up with just Roblox username + password.
-- The UNIQUE constraint stays — emails must still be unique if provided.
-- Password reset remains email-only — users without email are warned upfront.

alter table profiles alter column email drop not null;

-- Index rbx_username for fast login lookups (was already unique, add explicit index)
create index if not exists profiles_rbx_username_idx on profiles(rbx_username);
-- Index email for fast login lookups
create index if not exists profiles_email_idx on profiles(email) where email is not null;

notify pgrst, 'reload schema';
