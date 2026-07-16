-- Run this if you already ran schema.sql (or migration-001) before this
-- update. Fresh setups can just run schema.sql — it already includes this.

alter table listings rename column value_points to value_amount;
alter table listings add column if not exists value_unit text
  check (value_unit in ('shark', 'frost'));
alter table listings add column if not exists bucks_invested numeric;
alter table listings add column if not exists included_items jsonb not null default '[]';

create table if not exists completed_trades (
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

create index if not exists completed_trades_status_idx on completed_trades(status);

alter table completed_trades enable row level security;
create policy "public can read corroborated trades" on completed_trades
  for select using (status = 'corroborated');
