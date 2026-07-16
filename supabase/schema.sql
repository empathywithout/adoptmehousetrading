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

  listing_type text not null default 'house_trade'
    check (listing_type in ('house_trade', 'looking_for', 'commission')),
  -- house_trade: "I have this house, offer me items for it" (the original flow)
  -- looking_for: "I want this house, here's what I'll pay" — a request post,
  --              not an offer of an existing house
  -- commission:  "I build houses for hire" — a builder announcing availability,
  --              not tied to one specific house

  house_id text,                      -- id from data/houses.json; null for 'commission'
  is_cloned boolean,                  -- true/false for house_trade listings; null when N/A —
                                       -- mirrors the community's own "100% original" vs
                                       -- "cloned/70%+ similar" distinction, which matters a
                                       -- lot to how a listing is valued and trusted
  value_points numeric,               -- flat point-scale value (community convention), optional

  title text not null,
  description text,
  photos jsonb not null default '[]', -- array of Supabase Storage URLs
  looking_for jsonb not null default '[]', -- array of category keys wanted in return, e.g. ["adopt_me_pets","toys"]
  status text not null default 'active' check (status in ('active', 'traded', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint house_id_required_for_house_listings
    check (listing_type = 'commission' or house_id is not null)
);

create index listings_status_idx on listings(status);
create index listings_house_id_idx on listings(house_id);
create index listings_type_idx on listings(listing_type);

create table offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  offering_profile_id uuid not null references profiles(id) on delete cascade,
  items jsonb not null default '[]',  -- array of {category, id, name, image} — required for
                                       -- offers on 'house_trade' listings, optional for
                                       -- 'looking_for'/'commission' (a message may be enough)
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now()
);

create index offers_listing_id_idx on offers(listing_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  reason text not null check (reason in (
    'crosstrading',        -- Robux/real-money/outside-Adopt-Me trades — against Roblox/Adopt Me ToS
    'proxy_trading',       -- posting/trading on behalf of someone who isn't the account owner
    'misrepresented_clone',-- claimed original but is a clone, or vice versa
    'scam_or_no_show',
    'other'
  )),
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
