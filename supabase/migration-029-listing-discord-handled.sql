-- Migration 029: track which listings have been announced in Discord.
--
-- discord-post-listings.js runs every 30 minutes and posts new house listings
-- to a channel in the community Discord. It needs to know which listings it
-- has already dealt with, so nothing is posted twice and nothing is missed if
-- a run fails.
--
-- discord_handled_at is set when the job has dealt with a listing: either it
-- posted it, or it decided not to (the listing was removed or traded before
-- its turn came, or it is admin test data). NULL means not handled yet.
--
-- Every listing that exists when this runs is marked handled straight away.
-- That is deliberate: only listings created after the feature goes live get
-- announced, so the channel starts clean instead of with a backlog.
--
-- Run this BEFORE deploying the code that reads the column. It is additive
-- and the current site ignores it, so running it early is safe.
-- Safe to run more than once.

alter table listings add column if not exists discord_handled_at timestamptz;

update listings set discord_handled_at = now() where discord_handled_at is null;

create index if not exists listings_discord_pending_idx
  on listings(created_at) where discord_handled_at is null;

notify pgrst, 'reload schema';

-- Verify (expect 0 on the first run, since every existing listing is marked):
--   select count(*) from listings where discord_handled_at is null;
