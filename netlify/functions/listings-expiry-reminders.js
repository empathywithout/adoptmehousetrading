// Scheduled once a day (see [functions."listings-expiry-reminders"] in
// netlify.toml). Takes no input and sends each warning at most once per
// listing cycle, so there is nothing useful to do with it over HTTP.
//
// Active listings silently drop out of Browse EXPIRE_DAYS after their last
// edit or renewal (see listings-list.js). Nothing told anyone this was about
// to happen: the owner's listing just stopped being seen, and the people who
// saved it lost it without warning. The owner's Renew button only appeared
// after the listing had already gone, which is the wrong time to find out.
//
// So, WARN_DAYS_BEFORE expiry:
//   * the owner gets a nudge to renew, while renewing still prevents a gap
//   * everyone who saved it gets a heads-up, which is half of what saving is
//     for
//
// Runs daily rather than on page load, so it costs the database almost
// nothing — the same reasoning as trade-confirm-reminders.

import { supabaseAdmin, notify } from "./_lib/supabase.js";
import { EXPIRE_DAYS } from "./_lib/listings.js";

const WARN_DAYS_BEFORE = 3;
const OWNER_TYPE = "listing_expiring_owner";
const SAVER_TYPE = "saved_listing_expiring";

// How many watchers one listing can notify. Matches the cap in
// offers-respond.js.
const MAX_WATCHERS = 200;

export const handler = async () => {
  const db = supabaseAdmin();
  const now = Date.now();

  // Everything inside the warning run-up: old enough to be within
  // WARN_DAYS_BEFORE of expiry, but not yet expired. Deliberately the whole
  // span rather than a one-day slice — a slice only works if the job never
  // misses a day, and a listing that skipped its slice would expire with no
  // warning at all. The already-warned check below is what keeps it to one
  // notification per cycle, so a wide window costs nothing.
  //
  // Older than updated_at <= newest  =>  at least EXPIRE_DAYS - WARN_DAYS_BEFORE old
  // Newer than  updated_at >= oldest =>  not yet EXPIRE_DAYS old
  const oldest = new Date(now - EXPIRE_DAYS * 86400000).toISOString();
  const newest = new Date(now - (EXPIRE_DAYS - WARN_DAYS_BEFORE) * 86400000).toISOString();

  const { data: listings, error } = await db
    .from("listings")
    .select("id, title, profile_id, updated_at, status")
    .eq("status", "active")
    .filter("updated_at", ">=", oldest)
    .filter("updated_at", "<=", newest)
    .order("updated_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[listings-expiry-reminders] couldn't load listings", error);
    return { statusCode: 500, body: "error" };
  }
  if (!listings?.length) {
    console.log("[listings-expiry-reminders] nothing expiring");
    return { statusCode: 200, body: "0" };
  }

  const listingIds = listings.map((l) => l.id);

  const [{ data: saves }, { data: already }] = await Promise.all([
    db.from("listing_saves").select("profile_id, listing_id").in("listing_id", listingIds).limit(5000),
    db.from("notifications")
      .select("profile_id, type, link, created_at")
      .in("type", [OWNER_TYPE, SAVER_TYPE])
      .in("link", listingIds.map((id) => `listings/listing.html?id=${id}`)),
  ]);

  const watchersByListing = {};
  for (const s of saves || []) {
    (watchersByListing[s.listing_id] ||= []).push(s.profile_id);
  }

  // A warning counts as already sent only if it was created AFTER the
  // listing's current updated_at. Renewing or editing bumps updated_at, so
  // last cycle's warning falls before it and stops suppressing — the next
  // cycle warns again, which is what you want. Keying on type+link alone
  // would warn once and then never again for the life of the listing.
  const sentAt = new Map();
  for (const n of already || []) {
    const key = `${n.profile_id}|${n.type}|${n.link}`;
    const t = new Date(n.created_at).getTime();
    if (!sentAt.has(key) || t > sentAt.get(key)) sentAt.set(key, t);
  }

  let sent = 0;
  for (const listing of listings) {
    const link = `listings/listing.html?id=${listing.id}`;
    const cycleStart = new Date(listing.updated_at).getTime();
    const title = listing.title || "your listing";

    const alreadySent = (profileId, type) => {
      const t = sentAt.get(`${profileId}|${type}|${link}`);
      return t !== undefined && t >= cycleStart;
    };
    const send = async (profileId, type, message) => {
      if (alreadySent(profileId, type)) return;
      sentAt.set(`${profileId}|${type}|${link}`, now);
      await notify(db, profileId, type, message, link);
      sent++;
    };

    // Real days left for this listing, not a fixed WARN_DAYS_BEFORE — the
    // window spans several days, so a hardcoded "3 days" would be wrong for
    // anything caught later in the run-up.
    const daysLeft = Math.max(1, Math.ceil(EXPIRE_DAYS - (now - cycleStart) / 86400000));
    const days = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

    await send(
      listing.profile_id,
      OWNER_TYPE,
      `"${title}" drops out of Browse in ${days}. Renew it from your profile to keep it listed.`
    );

    const watchers = (watchersByListing[listing.id] || []).slice(0, MAX_WATCHERS);
    for (const profileId of watchers) {
      if (profileId === listing.profile_id) continue;
      await send(
        profileId,
        SAVER_TYPE,
        `"${title}", a house you saved, drops out of Browse in ${days} unless the owner renews it.`
      );
    }
  }

  console.log(`[listings-expiry-reminders] sent ${sent} reminder(s) across ${listings.length} listing(s)`);
  return { statusCode: 200, body: String(sent) };
};
