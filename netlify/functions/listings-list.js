// GET ?house_id=&status=&listing_type=&limit=
// -> { listings: [...], total } — each with profile.display_name attached
//
// Returns every matching listing as a LIGHT row (cover photo only, no
// description/video) rather than the newest 100 full rows. The old hard
// cap silently hid every active listing older than about four days, and
// the Browse page's filters only searched the loaded 100. Browse filters
// in the browser, so sending the whole (light) set lets filters search
// everything while this stays one cached query. Server-side filtering per
// filter combination would multiply cache keys and Neon compute, which is
// the tighter constraint right now. Revisit if active listings pass a few
// thousand.
//
// Default (no status param): active listings that were created, edited or
// renewed in the last EXPIRE_DAYS days, plus listings traded in the last
// RECENT_TRADED_DAYS days. Older active listings are "expired": hidden
// here until the owner renews them (listings-renew.js). No schema change;
// expiry is derived from updated_at.

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import { withCache } from "./_lib/cache.js";

export const EXPIRE_DAYS = 30;
const RECENT_TRADED_DAYS = 7;
const MAX_ROWS = 3000;

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const cacheKey = (e) => `listings:list:v2:${new URLSearchParams(e.queryStringParameters || {}).toString()}`;
  return withCache(cacheKey, 60, fetchListings, event);
}

function lightRow(l) {
  return {
    id: l.id,
    profile_id: l.profile_id,
    listing_type: l.listing_type,
    house_id: l.house_id,
    title: l.title,
    // Cover photo only, kept as an array so existing `photos?.[0]` callers work.
    photos: Array.isArray(l.photos) && l.photos.length ? [l.photos[0]] : [],
    themes: l.themes,
    value_amount: l.value_amount,
    value_unit: l.value_unit,
    is_cloned: l.is_cloned,
    build_type: l.build_type,
    status: l.status,
    save_count: l.save_count,
    created_at: l.created_at,
    updated_at: l.updated_at,
    profiles: l.profiles,
  };
}

async function fetchListings(event) {
  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();
  const now = Date.now();
  const expireCutoff = new Date(now - EXPIRE_DAYS * 86400000).toISOString();
  const tradedCutoff = now - RECENT_TRADED_DAYS * 86400000;

  let query = db
    .from("listings")
    .select("*, profiles(display_name, rbx_avatar_url)")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  query = query.in("status", params.status ? [params.status] : ["active", "traded"]);

  // The 'commission' listing_type is deprecated (see migration-020) — any
  // legacy rows with that value stay in the database untouched, but never
  // show up in public browse results.
  query = query.neq("listing_type", "commission");

  if (!params.status) {
    // Nothing older than the expiry window can qualify under the default
    // view (active must be fresh; traded must be even more recent).
    query = query.filter("updated_at", ">=", expireCutoff);
  }

  if (params.house_id) {
    query = query.eq("house_id", params.house_id);
  }

  if (params.listing_type) {
    query = query.eq("listing_type", params.listing_type);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load listings" });
  }

  let rows = data || [];
  if (!params.status) {
    rows = rows.filter((l) => l.status !== "traded" || new Date(l.updated_at).getTime() >= tradedCutoff);
  }

  const total = rows.length;
  const limit = Math.max(0, parseInt(params.limit, 10) || 0);
  if (limit) rows = rows.slice(0, limit);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
    },
    body: JSON.stringify({ listings: rows.map(lightRow), total }),
  };
}

export const handler = safeHandler(handlerImpl);
