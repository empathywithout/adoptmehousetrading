-- Run this if you already ran migration-014 before content submissions
-- existed. Fresh setups can just run schema.sql — it already includes this.

create table if not exists content_submissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  category text not null check (category in ('theme_build', 'budget_build', 'building_technique', 'trading_guide')),
  body text not null,
  cover_photo text,
  house_id text,
  related_registry_entry_id uuid references build_registry(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_note text,
  slug text unique,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz
);

create index if not exists content_submissions_status_idx on content_submissions(status);

alter table content_submissions enable row level security;
create policy "public can read approved content" on content_submissions
  for select using (status = 'approved');

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
