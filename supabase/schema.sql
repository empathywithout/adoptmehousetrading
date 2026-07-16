-- AdoptMeHouseTrading.com — Supabase schema
-- Run this in the Supabase SQL editor once your project is created.
--
-- Design notes:
-- * No password auth — "profiles" are just a claimed Roblox username plus a
--   session token. Anyone can create a profile for a username; the token is
--   what proves you're the one who's been acting as that profile on this
--   site (same trust model as Traderie: the site matches traders, it never
--   holds real value, so a lightweight token is proportionate).
-- * house_id / item ids reference the static catalog JSON (data/houses.json,
--   data/offer-items.json), not a DB table — the catalog is build-time data,
--   not something players create rows for.

create extension if not exists "pgcrypto";

create table profiles (
  id uuid primary key default gen_random_uuid(),
  rbx_username text not null unique,
  rbx_user_id bigint,                 -- from Roblox's public API, for avatar/profile link
  rbx_avatar_url text,
  session_token_hash text not null,   -- sha256 of the token stored in the player's browser
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  house_id text not null,             -- id from data/houses.json
  title text not null,
  description text,
  photos jsonb not null default '[]', -- array of Supabase Storage URLs
  looking_for jsonb not null default '[]', -- array of category keys, e.g. ["adopt_me_pets","toys"]
  status text not null default 'active' check (status in ('active', 'traded', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_status_idx on listings(status);
create index listings_house_id_idx on listings(house_id);

create table offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  offering_profile_id uuid not null references profiles(id) on delete cascade,
  items jsonb not null default '[]',  -- array of {category, id, name, image}
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now()
);

create index offers_listing_id_idx on offers(listing_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz not null default now()
);

-- Row Level Security: all writes go through Netlify Functions using the
-- service role key (which bypasses RLS), so the anon/public key used by the
-- browser gets read-only access to active listings/offers and nothing else.
alter table profiles enable row level security;
alter table listings enable row level security;
alter table offers enable row level security;
alter table reports enable row level security;

create policy "public can read active listings" on listings
  for select using (status = 'active' or status = 'traded');

create policy "public can read offers on visible listings" on offers
  for select using (true);

-- No public select policy on profiles or reports — profile lookups and
-- moderation happen only through the service-role functions.
