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

  email text not null unique,
  password_hash text not null,        -- scrypt hash — same slow-hash reasoning as the PIN this
                                       -- replaces, just for a real password now.
  password_salt text not null,

  display_name text not null unique,  -- shown publicly everywhere (listing cards, Browse
                                       -- Houses, Recent Trades, builder profiles). The real
                                       -- Roblox username is private and only revealed to a
                                       -- specific counterparty once an offer/commission with
                                       -- them is ACCEPTED — see listings-get.js/profile-dashboard
                                       -- for where that reveal actually happens.

  rbx_username text not null unique,  -- private — see display_name above
  rbx_user_id bigint,                 -- from Roblox's public API, for avatar/profile link
  rbx_avatar_url text,

  created_at timestamptz not null default now(),

  -- Builder fields — a profile opts into being a "Builder" separately from
  -- posting house listings. Commissions are a distinct system from house
  -- trading (a builder takes custom-build requests; it's not tied to any
  -- one house), so these live on the profile rather than as another
  -- listing_type.
  is_builder boolean not null default false,
  builder_bio text,
  commission_status text not null default 'closed' check (commission_status in ('open', 'closed')),
  portfolio_photos jsonb not null default '[]', -- legacy, no longer written to by the UI —
                                       -- portfolio now comes from build_registry (see below)
  builder_themes jsonb not null default '[]'    -- specialties, same tag set as listing themes
);

-- Sessions: a profile can be signed in on multiple devices/browsers at once.
-- Logging in on a new device just adds a row here rather than invalidating
-- every other active session.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index sessions_profile_idx on sessions(profile_id);
create index sessions_token_idx on sessions(token_hash);

-- RLS with no public policies — only the service-role key (which bypasses
-- RLS entirely) should ever touch this table. Session tokens are exactly
-- the kind of thing the anon/authenticated keys should never be able to
-- query directly, even read-only.
alter table sessions enable row level security;

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
  themes jsonb not null default '[]', -- array of theme tag strings, e.g. ["cottagecore","franchise"].
                                       -- Real builds cross aesthetic styles (cottagecore, cutecore,
                                       -- gothic), franchise crossovers (Animal Crossing, Cookie Run
                                       -- Kingdom), and technique (realism) — deliberately an open
                                       -- tag list rather than a fixed enum, since new themes show up
                                       -- constantly and a rigid taxonomy goes stale fast.
  theme_note text,                    -- optional free text, e.g. which franchise for a
                                       -- "franchise_crossover" tag ("Animal Crossing")
  value_amount numeric,               -- magnitude in value_unit, e.g. 1.5
  value_unit text check (value_unit in ('shark', 'frost', 'rp')),
                                       -- Shark (low/mid trades) and Frost (high-tier trades)
                                       -- are the real community baseline units — NOT a fixed
                                       -- conversion, it floats (~4/5 Frost per Shark as of this
                                       -- writing). Store the unit the poster actually used
                                       -- rather than forcing a conversion we can't verify.
  bucks_invested numeric,             -- optional: total Bucks the lister says they spent on
                                       -- the house + furniture. Self-reported, not itemized
                                       -- against a furniture catalog — just a number the
                                       -- lister provides.
  included_items jsonb not null default '[]', -- array of {category,id,name,image} — bonus
                                       -- items bundled in WITH the house (not what the lister
                                       -- wants back — see looking_for for that). Same
                                       -- category rules as offers: everything except houses.

  title text not null,
  description text,
  photos jsonb not null default '[]', -- array of Supabase Storage URLs, minimum 5 enforced
                                       -- in listings-create.js (not here — a photo COUNT
                                       -- floor isn't expressible as a simple column check)
  video_url text,                     -- optional video tour LINK (YouTube/Streamable/etc.),
                                       -- deliberately NOT a raw file upload — video storage/
                                       -- bandwidth costs scale far worse than photos, and a
                                       -- link offloads playback/transcoding to a platform
                                       -- built for it instead of us building our own
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

-- Completed trades: the seed of a future "comps" engine (real settled trades,
-- not opinion-based value guides). Rather than a cold separate submission
-- flow, this hooks directly into offers that get accepted right here — when
-- an offer is accepted, either party can confirm the trade actually happened
-- in-game and attach a screenshot. If BOTH parties confirm, that's a real
-- corroboration signal (two independent accounts agreeing) without needing
-- any video/hashing/trust-tier system yet.
create table completed_trades (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references offers(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  lister_confirmed boolean not null default false,
  lister_proof_photo text,
  offerer_confirmed boolean not null default false,
  offerer_proof_photo text,
  status text not null default 'pending' check (status in ('pending', 'corroborated', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index completed_trades_status_idx on completed_trades(status);

alter table completed_trades enable row level security;
create policy "public can read corroborated trades" on completed_trades
  for select using (status = 'corroborated');

-- Derived value list — built from OUR OWN verified trades, not imported from
-- any other site (see the research conversation this came out of: other
-- value sites' data is either ToS-restricted or not ours to republish, and
-- more importantly, using someone else's opinions would undercut the entire
-- premise of this site being about real verified trades).
--
-- Real constraint: completed_trades records a whole trade (a house's value
-- vs. a bundle of offered items), not a per-item price. Splitting a
-- multi-item bundle's value across different items would be a guess
-- dressed up as data — so only offers with a SINGLE item type (any
-- quantity, divided evenly) count as a data point here. Multi-item offers
-- are real trades but aren't usable as clean per-item pricing signals.
--
-- Recomputed incrementally whenever a trade newly becomes corroborated
-- (see trades-confirm.js) rather than on a schedule — there's no cron
-- infrastructure, and this keeps values fresh the moment real data exists
-- without needing one.
create table item_values (
  id uuid primary key default gen_random_uuid(),
  category text not null,              -- adopt_me_pets, vehicles, toys, pet_wear, stickers, strollers, foods
  item_id text not null,               -- matches the id field in data/{category}.json
  variant text,                        -- pets only: regular/neon/mega_neon, null otherwise
  potion text,                         -- pets only: none/ride/fly/fly_ride, null otherwise
  value_unit text not null check (value_unit in ('shark', 'frost', 'rp')),
  source text not null default 'verified' check (source in ('verified', 'data_team')),
                                       -- 'verified' = derived from a corroborated on-site trade
                                       -- (the strongest signal we have). 'data_team' = self-
                                       -- reported by a vetted Data Team member (see
                                       -- data_team_applications below) — useful for bootstrapping
                                       -- volume, but a real trust step down from a two-sided
                                       -- confirmed trade, so it's tracked as its OWN row rather
                                       -- than silently blended into the verified range.
  value_low numeric not null,
  value_high numeric not null,
  sample_size int not null default 0,
  updated_at timestamptz not null default now(),
  unique (category, item_id, variant, potion, value_unit, source)
);

create index item_values_lookup_idx on item_values(category, item_id, variant, potion);

alter table item_values enable row level security;
create policy "public can read item values" on item_values
  for select using (true);

-- Data Team: a vetted group of trusted members who can self-report trades
-- to bootstrap item_values faster than on-site verified volume alone.
-- Deliberately gated behind an application + approval, not open to anyone
-- with a profile — the whole point is that self-reported data needs a
-- real trust step, same reasoning as everything else on this site
-- (post-first, but reviewed/gated where the stakes are real).
alter table profiles add column is_data_team_member boolean not null default false;

create table data_team_applications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  message text not null,               -- why they should be trusted (trading history/reputation elsewhere, etc.)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index data_team_applications_status_idx on data_team_applications(status);

alter table data_team_applications enable row level security;
-- No public select policy — applications are reviewed by an admin only.

-- User-submitted guides/how-tos, reviewed before publishing. Unlike Data
-- Team submissions (deliberately kept off the public/indexed surface),
-- published guides ARE meant to be public and indexed — good long-form
-- niche content is exactly what helps search visibility, and no
-- competitor site actually crowdsources guides from users with a review
-- step (they're all first-party editorial), so this is real differentiation.
create table content_submissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  category text not null check (category in ('build_guide', 'how_to', 'tips', 'other')),
  title text not null,
  body text not null,
  photos jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz
);

create index content_submissions_status_idx on content_submissions(status);

alter table content_submissions enable row level security;
create policy "public can read approved content" on content_submissions
  for select using (status = 'approved');
-- Pending/rejected submissions are only visible to admins (service role) —
-- same reasoning as disputes: no public review-in-progress visibility.

-- Commission requests: a separate system from house trading. A builder
-- (profiles.is_builder = true) takes requests from other players; unlike
-- an offer on a house listing, a commission needs an explicit agreed-scope
-- record locked in BEFORE work starts — this directly targets the real,
-- recurring scam pattern in the community ("failed comm": builder finishes
-- the work, client ghosts or lowballs after). Completion uses the exact
-- same both-sides-confirm pattern as completed_trades — "verified" means
-- the same thing everywhere on this site, not a different check per
-- feature.
create table commission_requests (
  id uuid primary key default gen_random_uuid(),
  builder_profile_id uuid not null references profiles(id) on delete cascade,
  requester_profile_id uuid not null references profiles(id) on delete cascade,

  description text not null,          -- what the client wants built
  agreed_scope text,                  -- snapshot of description at accept time — the locked-in
                                       -- agreement both sides can point back to later
  themes jsonb not null default '[]', -- desired theme tags, same set as listing themes

  offered_items jsonb not null default '[]',  -- payment offered, items — no Robux/cash per
                                               -- the same no-crosstrading stance as trading
  offered_value_amount numeric,
  offered_value_unit text check (offered_value_unit in ('shark', 'frost', 'rp')),

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'delivered', 'verified', 'cancelled')),
  -- pending:   submitted, awaiting builder response
  -- accepted:  builder agreed — agreed_scope is now locked in, work begins
  -- declined:  builder said no
  -- delivered: builder marked the build finished, attached proof photos
  -- verified:  BOTH sides confirmed completion (same pattern as completed_trades)
  -- cancelled: either side backed out after accepted but before verified

  delivery_photos jsonb not null default '[]',
  builder_confirmed boolean not null default false,
  requester_confirmed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commission_requests_builder_idx on commission_requests(builder_profile_id);
create index commission_requests_requester_idx on commission_requests(requester_profile_id);
create index commission_requests_status_idx on commission_requests(status);

alter table commission_requests enable row level security;
-- No public select policy — a commission request is only visible to the
-- two parties involved, via the service-role functions. Unlike a house
-- listing's offers (which are semi-public, like Traderie's offer history),
-- commission negotiations are private between the builder and the client.

-- Build registry: the actual prestige mechanic for this community, per
-- research — attribution, not badges or points. A builder registers a
-- build as their original work (photos + timestamp + theme tags), so
-- there's a real, queryable "who built this first" instead of the manual
-- crowdsourced compilation posts people were already doing by hand.
--
-- Moderation model: post-first, dispute-based, not pre-approval — a
-- submission is live immediately. Timestamp is the tiebreaker: a newer
-- entry that looks like an existing one gets flagged as a possible
-- duplicate (possible_duplicate_of) automatically, informational only,
-- never blocking. Actual disputes go through build_registry_disputes
-- below and get manually reviewed — same "corroborate/dispute after,
-- don't gatekeep before" pattern already used for completed_trades.
create table build_registry (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,                -- the build's name, e.g. "Ivory Pagoda"
  description text,
  photos jsonb not null default '[]', -- required in practice (enforced in the function,
                                       -- not the DB) — ideally including in-progress shots,
                                       -- much harder to fake retroactively than a finished photo
  themes jsonb not null default '[]', -- same tag set as listing themes
  included_items jsonb not null default '[]', -- items/pets/etc featured in the build —
                                       -- same {category,id,name,image} shape as listing
                                       -- included_items, since builders often want credit
                                       -- for a build's furniture/pet staging too, not just
                                       -- the house shell
  house_id text,                      -- optional link to data/houses.json, if known
  possible_duplicate_of uuid references build_registry(id),
  status text not null default 'active' check (status in ('active', 'disputed', 'confirmed_clone', 'confirmed_original')),
  created_at timestamptz not null default now()
);

create index build_registry_profile_idx on build_registry(profile_id);
create index build_registry_status_idx on build_registry(status);

alter table build_registry enable row level security;
create policy "public can read build registry entries" on build_registry
  for select using (true);

-- Which registered build shows as a builder's cover photo on Commissions
-- cards and their profile page. Optional — falls back to their most
-- recent registered build if not set.
alter table profiles add column featured_registry_entry_id uuid references build_registry(id);

create table build_registry_disputes (
  id uuid primary key default gen_random_uuid(),
  build_registry_id uuid not null references build_registry(id) on delete cascade,
  disputer_profile_id uuid not null references profiles(id) on delete cascade,
  claim text not null,                          -- the disputer's explanation/evidence
  claimed_original_entry_id uuid references build_registry(id), -- their own earlier entry, if they have one
  rebuttal text,                                -- the accused builder's one response, if they gave one
  rebuttal_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'upheld', 'rejected')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index build_registry_disputes_entry_idx on build_registry_disputes(build_registry_id);

alter table build_registry_disputes enable row level security;
-- No public select policy — disputes are reviewed manually (by you or a
-- trusted mod, same role the community's own mods already play running
-- their build contests) rather than shown publicly while pending.

-- Trade chat: unlocks once an offer or commission is ACCEPTED — before
-- that there's no reason for two strangers to be messaging each other.
-- Preset-only (no free text) deliberately: a fixed, vetted phrase list
-- means there's nothing to moderate for scams, harassment, or off-platform
-- contact sharing — the tradeoff for that safety is less expressive chat,
-- which is fine for coordinating an in-game trade. Shared across both
-- offers and commissions via context_type/context_id rather than building
-- two separate chat systems.
create table trade_chat_messages (
  id uuid primary key default gen_random_uuid(),
  context_type text not null check (context_type in ('offer', 'commission')),
  context_id uuid not null,
  sender_profile_id uuid not null references profiles(id) on delete cascade,
  preset_key text not null,
  created_at timestamptz not null default now()
);

create index trade_chat_messages_context_idx on trade_chat_messages(context_type, context_id);

alter table trade_chat_messages enable row level security;
-- No public select policy — messages are only visible to the two parties
-- involved, via the service-role functions, same as commission_requests.


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

-- Data API grants: Supabase's newer default is that new tables in the public
-- schema are NOT automatically exposed to the Data API (PostgREST) — you
-- must explicitly grant access. Without this, service_role gets
-- "PGRST125: Invalid path specified" on every request, because PostgREST's
-- schema cache doesn't even know these tables exist as API resources.
-- service_role is the only role our Netlify Functions ever use (the browser
-- never talks to Supabase directly), so that's the only grant needed here.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- Content submissions: user-submitted build guides, how-tos, and trading
-- guides, reviewed before publication. Unlike the Data Team feature, this
-- content is meant to be genuinely public and SEO-indexed — real long-form
-- content is what actually builds search authority, and guides written by
-- REAL registered builders (see build_registry) are a genuine
-- differentiator from the generic "best Adopt Me house ideas" listicle
-- sites that already crowd this space.
--
-- Categories reflect what the community actually organizes content around
-- (from research into TikTok/Reddit/YouTube Adopt Me build content), not a
-- generic "guide" bucket: theme builds, budget/challenge builds, building
-- techniques/tricks, and trading & value guides.
--
-- Approval here does NOT auto-publish a live page — this site is static
-- pre-rendered HTML, so publishing means running scripts/generate-guides.mjs
-- (pulls all approved submissions and generates real static pages), then
-- the normal build+commit+push, same as every other content type on this
-- site. One extra manual step, but no new CI/webhook infrastructure needed.
create table content_submissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  category text not null check (category in ('theme_build', 'budget_build', 'building_technique', 'trading_guide')),
  body text not null,                  -- markdown
  cover_photo text,                    -- Supabase Storage URL, optional
  house_id text,                       -- optional: which house type this is about
  related_registry_entry_id uuid references build_registry(id),
                                       -- optional: cross-link to the author's own
                                       -- registered build, if this guide is about it
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_note text,                 -- optional feedback shown to the author
  slug text unique,                    -- set on approval, used for the public URL
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz
);

create index content_submissions_status_idx on content_submissions(status);

alter table content_submissions enable row level security;
create policy "public can read approved content" on content_submissions
  for select using (status = 'approved');

-- Notifications: created directly by the same function that causes the
-- triggering event (an offer, an accept/decline, a chat message, etc.)
-- rather than a separate pub/sub system — simplest thing that works given
-- everything already runs through service-role functions anyway. `link` is
-- a relative site path the front-end navigates to on click.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  message text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_profile_unread_idx on notifications(profile_id, read, created_at desc);

alter table notifications enable row level security;
-- No public select policy — a person's notifications are only ever
-- fetched through the service-role notifications-list.js function,
-- authenticated as that specific profile.


-- service role key (bypasses RLS), so the anon/public key used by the
-- browser (if ever used directly) gets read-only access to active
-- listings/offers and nothing else.
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
