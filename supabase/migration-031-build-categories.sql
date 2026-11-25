-- Migration 031: build categories beyond houses.
--
-- Listings and registry entries were always houses. Players also trade and
-- register other things they build: plushies (and sculptures), furniture and
-- decor sets, and pixel or wall art. category says which; everything that
-- exists today is a house, which is the default.
--
-- house_id is only meaningful for houses. It is already nullable in
-- production (migration-001 dropped NOT NULL); the constraint below requires
-- it for new house rows only. NOT VALID so it isn't checked against old rows,
-- some of which (legacy 'commission' listings) have no house.
--
-- The allowed values are mirrored in netlify/functions/_lib/build-categories.js
-- and public/js/api.js (BUILD_CATEGORIES). Keep all three in step.
--
-- Run this BEFORE deploying the code that writes category. Additive and safe
-- to run more than once.

alter table listings add column if not exists category text not null default 'house';
alter table build_registry add column if not exists category text not null default 'house';

alter table listings drop constraint if exists listings_category_check;
alter table listings add constraint listings_category_check
  check (category in ('house', 'plushie', 'furniture', 'wall_art'));

alter table build_registry drop constraint if exists build_registry_category_check;
alter table build_registry add constraint build_registry_category_check
  check (category in ('house', 'plushie', 'furniture', 'wall_art'));

alter table listings alter column house_id drop not null;
alter table listings drop constraint if exists listings_house_required_for_houses;
alter table listings add constraint listings_house_required_for_houses
  check (category <> 'house' or house_id is not null) not valid;

create index if not exists listings_category_idx on listings(category);
create index if not exists build_registry_category_idx on build_registry(category);

notify pgrst, 'reload schema';

-- Verify (expect every existing row to be 'house'):
--   select category, count(*) from listings group by 1;
--   select category, count(*) from build_registry group by 1;
