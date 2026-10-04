-- Migration 027: write down the schema that only ever existed in production.
--
-- Four things the code reads every day were in neither schema.sql nor any
-- migration, so a from-scratch install was broken and nobody could tell:
--
--   * listing_saves table + listings.save_count  -- the whole listing "like"
--     feature. registry_saves got migration-023; its listings twin got nothing.
--   * content_submissions.photos                 -- read by content-list.js and
--     content-get.js, so /guides 500s without it.
--   * profiles.builder_avatar_url                -- read by builder-get.js and
--     builders-list.js.
--
-- Every statement is idempotent. On the live database this is a no-op: it
-- documents what is already there. Run it anyway so the two stay in step.

-- 1. Listing saves ----------------------------------------------------------
-- Mirrors registry_saves (migration-023). Note save_count is maintained by
-- listing-save.js directly, not by a trigger, which is why none is created
-- here: adding one now would double-count against the function's own update.
create table if not exists listing_saves (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint listing_saves_unique unique (profile_id, listing_id)
);

create index if not exists listing_saves_listing_idx on listing_saves(listing_id);
create index if not exists listing_saves_profile_idx on listing_saves(profile_id);

alter table listings add column if not exists save_count integer not null default 0;
create index if not exists listings_save_count_idx on listings(save_count desc);

alter table listing_saves enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'listing_saves' and policyname = 'public can count saves via listings'
  ) then
    create policy "public can count saves via listings" on listing_saves
      for select using (true);
  end if;
end $$;

-- 2. Guide gallery images ---------------------------------------------------
alter table content_submissions add column if not exists photos jsonb not null default '[]';

-- 3. Optional custom builder picture ---------------------------------------
alter table profiles add column if not exists builder_avatar_url text;
