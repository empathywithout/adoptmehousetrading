-- Add build_type to build_registry: submitter-declared originality claim.
-- Separate from `status` which is the admin-verified outcome after disputes.
-- Separate from listings.is_cloned (boolean) which will also be replaced.

alter table build_registry add column if not exists build_type text
  check (build_type in ('original', 'speedbuild', 'cloned'));

-- Add build_type to listings — replaces the old boolean is_cloned
-- (keeping is_cloned for backward compat, new UI writes build_type instead)
alter table listings add column if not exists build_type text
  check (build_type in ('original', 'speedbuild', 'cloned'));

notify pgrst, 'reload schema';
