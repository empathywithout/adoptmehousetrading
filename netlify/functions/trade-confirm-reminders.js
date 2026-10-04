// Scheduled once a day (see [functions."trade-confirm-reminders"] in
// netlify.toml). Not callable for anything useful over HTTP: it takes no
// input and only ever sends each reminder once.
//
// Most accepted trades were never being confirmed because nothing told
// either trader that confirming was a step. This nudges each side once,
// a day after the offer, if they still haven't confirmed.
//
// Runs once a day on purpose (not on page load) so it adds almost nothing
// to database compute.

import { supabaseAdmin, notify } from "./_lib/supabase.js";

const MIN_AGE_HOURS = 24;
const MAX_AGE_DAYS = 10;
const TYPE = "trade_confirm_reminder";

export const handler = async () => {
  const db = supabaseAdmin();
  const now = Date.now();
  const newest = new Date(now - MIN_AGE_HOURS * 3600000).toISOString();
  const oldest = new Date(now - MAX_AGE_DAYS * 86400000).toISOString();

  const { data: offers, error } = await db
    .from("offers")
    .select("id, created_at, offering_profile_id, listing_id")
    .eq("status", "accepted")
    .filter("created_at", ">=", oldest)
    .filter("created_at", "<=", newest)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[trade-confirm-reminders] couldn't load offers", error);
    return { statusCode: 500, body: "error" };
  }
  if (!offers?.length) {
    console.log("[trade-confirm-reminders] nothing to do");
    return { statusCode: 200, body: "0" };
  }

  const [{ data: confirmations }, { data: listings }] = await Promise.all([
    db.from("completed_trades")
      .select("offer_id, lister_confirmed, offerer_confirmed")
      .in("offer_id", offers.map(o => o.id)),
    db.from("listings")
      .select("id, title, profile_id, status")
      .in("id", [...new Set(offers.map(o => o.listing_id))]),
  ]);

  const confirmMap = {};
  for (const c of confirmations || []) confirmMap[c.offer_id] = c;
  const listingMap = {};
  for (const l of listings || []) listingMap[l.id] = l;

  // Who still needs a nudge, keyed by "profile|link" so each person gets
  // at most one reminder per trade, ever.
  const wanted = [];
  for (const o of offers) {
    const listing = listingMap[o.listing_id];
    // A removed listing 404s, so there is nowhere to send them to confirm.
    if (!listing || listing.status === "removed") continue;
    const c = confirmMap[o.id];
    const link = `listings/listing.html?id=${listing.id}`;
    const message = `Did your trade for "${listing.title}" happen? Confirm it so it counts as verified.`;
    if (!c?.lister_confirmed) wanted.push({ profile_id: listing.profile_id, link, message });
    if (!c?.offerer_confirmed) wanted.push({ profile_id: o.offering_profile_id, link, message });
  }
  if (!wanted.length) return { statusCode: 200, body: "0" };

  const { data: already } = await db
    .from("notifications")
    .select("profile_id, link")
    .eq("type", TYPE)
    .in("link", [...new Set(wanted.map(w => w.link))]);

  const sent = new Set((already || []).map(n => `${n.profile_id}|${n.link}`));

  let count = 0;
  for (const w of wanted) {
    const key = `${w.profile_id}|${w.link}`;
    if (sent.has(key)) continue;
    sent.add(key);
    await notify(db, w.profile_id, TYPE, w.message, w.link);
    count++;
  }

  console.log(`[trade-confirm-reminders] sent ${count} reminder(s)`);
  return { statusCode: 200, body: String(count) };
};
