-- Run this ONLY if you already executed the original schema.sql (the version
-- before listing_type/is_cloned/value_points/expanded report reasons existed).
-- If you're setting up Supabase fresh, just run schema.sql — it already
-- includes everything below.

alter table listings add column if not exists listing_type text not null default 'house_trade'
  check (listing_type in ('house_trade', 'looking_for', 'commission'));
alter table listings add column if not exists is_cloned boolean;
alter table listings add column if not exists value_points numeric;
alter table listings alter column house_id drop not null;
alter table listings add constraint house_id_required_for_house_listings
  check (listing_type = 'commission' or house_id is not null);

create index if not exists listings_type_idx on listings(listing_type);

-- Reports previously had no reason constraint — this locks it to the categories
-- that match the real community's rules (crosstrading, proxy trading, etc).
-- If you have existing report rows with other reason values, back them up or
-- map them to 'other' before running this, since the constraint will reject
-- inserts (not existing rows) going forward.
alter table reports add constraint reports_reason_check check (reason in (
  'crosstrading',
  'proxy_trading',
  'misrepresented_clone',
  'scam_or_no_show',
  'other'
));
