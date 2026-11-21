// Scheduled every 30 minutes (see [functions."discord-post-listings"] in
// netlify.toml). Takes no input, so there is nothing useful to do with it
// over HTTP.
//
// Posts new house listings to the community Discord as link cards, so people
// in the server see what has just gone up and click through to the site. The
// trading itself still happens on the site.
//
// Two deliberate delays:
//   * A listing is only posted once it is POST_DELAY_MINUTES old. Reports and
//     removals get that long to catch a bad listing, because a Discord message
//     stays up even after the listing is removed here.
//   * Only listings from the last MAX_AGE_HOURS are considered. If this job is
//     switched off for a while, turning it back on doesn't dump a backlog.
//
// Each listing is handled exactly once, tracked in listings.discord_handled_at
// (migration-029). That column is set whether the listing was posted or
// skipped (removed or traded before its turn, or admin test data), so nothing
// is looked at twice. It is set only after Discord accepts the message, so a
// failed send is retried on the next run.
//
// Needs DISCORD_LISTINGS_WEBHOOK set to the channel's webhook URL. Without it
// this logs and does nothing, the same as rebuild-site without its hook.

import { supabaseAdmin } from "./_lib/supabase.js";
import { isTestRow } from "./_lib/testdata.js";
import {
  isDiscordWebhookUrl,
  buildListingEmbed,
  chunk,
  sendWebhook,
  MAX_EMBEDS_PER_MESSAGE,
} from "./_lib/discord.js";

const WEBHOOK_ENV = "DISCORD_LISTINGS_WEBHOOK";
const POST_DELAY_MINUTES = 30;
const MAX_AGE_HOURS = 48;
// One run posts at most this many. Anything left over goes out next run, so a
// sudden burst can't turn into a wall of cards or hit Discord's rate limit.
const MAX_PER_RUN = 30;

const SITE_URL = (process.env.URL || "https://adoptmehousetrading.com").replace(/\/$/, "");

// House names for the cards. The function bundle doesn't include data/, so
// read the copy the site already serves. If that fails the cards fall back to
// a tidied-up house id rather than the job failing.
async function loadHouseNames() {
  try {
    const res = await fetch(`${SITE_URL}/data/houses.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const houses = Array.isArray(data) ? data : data.houses || [];
    return Object.fromEntries(houses.map((h) => [h.id, h.name]));
  } catch (err) {
    console.warn("[discord-post-listings] couldn't load house names, using ids:", err.message);
    return {};
  }
}

async function markHandled(db, ids) {
  if (!ids.length) return;
  const { error } = await db
    .from("listings")
    .update({ discord_handled_at: new Date().toISOString() })
    .in("id", ids);
  if (error) console.error("[discord-post-listings] couldn't mark listings handled", error);
}

export const handler = async () => {
  const webhook = process.env[WEBHOOK_ENV];
  if (!webhook) {
    console.log(`[discord-post-listings] ${WEBHOOK_ENV} is not set, skipping.`);
    return { statusCode: 200, body: "skipped: no webhook configured" };
  }
  if (!isDiscordWebhookUrl(webhook)) {
    console.error(`[discord-post-listings] ${WEBHOOK_ENV} does not look like a Discord webhook URL, refusing to post to it.`);
    return { statusCode: 500, body: "refused: unexpected webhook URL" };
  }

  const db = supabaseAdmin();
  const now = Date.now();
  const newest = new Date(now - POST_DELAY_MINUTES * 60000).toISOString();
  const oldest = new Date(now - MAX_AGE_HOURS * 3600000).toISOString();

  const { data: rows, error } = await db
    .from("listings")
    .select("id, title, house_id, listing_type, value_amount, value_unit, photos, status, created_at, profiles(display_name)")
    .is("discord_handled_at", null)
    .filter("created_at", ">=", oldest)
    .filter("created_at", "<=", newest)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[discord-post-listings] couldn't load listings", error);
    return { statusCode: 500, body: "error" };
  }
  if (!rows?.length) {
    console.log("[discord-post-listings] nothing new");
    return { statusCode: 200, body: "0" };
  }

  // Removed, traded or test listings are marked handled without posting.
  const skip = [];
  const toPost = [];
  for (const l of rows) {
    const isTest = isTestRow({ title: l.title, names: [l.profiles?.display_name] });
    if (l.status !== "active" || isTest) skip.push(l.id);
    else toPost.push(l);
  }
  await markHandled(db, skip);

  const houseNames = toPost.length ? await loadHouseNames() : {};
  let posted = 0;

  // Oldest first, so the channel reads in the order listings went up. Stop at
  // the first failed message: everything after it stays unhandled and goes out
  // in order next run.
  for (const batch of chunk(toPost, MAX_EMBEDS_PER_MESSAGE)) {
    const embeds = batch.map((l) => buildListingEmbed(l, { siteUrl: SITE_URL, houseNames }));
    const ok = await sendWebhook(webhook, embeds);
    if (!ok) break;
    await markHandled(db, batch.map((l) => l.id));
    posted += batch.length;
  }

  console.log(`[discord-post-listings] posted ${posted}, skipped ${skip.length}, left for next run ${toPost.length - posted}`);
  return { statusCode: 200, body: String(posted) };
};
