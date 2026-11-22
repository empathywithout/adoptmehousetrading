-- Migration 030: photo fingerprints for spotting registry reposts.
--
-- Every photo upload gets a new R2 filename, so when someone registers the
-- same build twice with the same screenshots, the photo URLs differ and the
-- existing duplicate check (shared URL) misses it. photo_hashes holds a small
-- visual fingerprint per photo (64 hex characters each, same order as
-- photos), computed in netlify/functions/_lib/photo-fingerprint.js.
--
-- Used to block exact reposts at registration (same person, same title,
-- every photo already on their earlier entry) and to remove the ones already
-- in the registry from the admin dashboard.
--
-- NULL means not computed yet. Existing rows are filled in on demand, so
-- nothing is backfilled here. Cleared by registry-update.js when an entry's
-- photos change.
--
-- Run this BEFORE deploying the code that reads the column: registry-create
-- selects and writes it. Additive, safe to run more than once.

alter table build_registry add column if not exists photo_hashes jsonb;

notify pgrst, 'reload schema';

-- Verify (expect one row, data_type jsonb):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'build_registry' and column_name = 'photo_hashes';
