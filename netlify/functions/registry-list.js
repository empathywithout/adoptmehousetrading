// GET ?theme=cottagecore&house_id=castle&profile_id=<id>&sort=saves|recent
// -> { entries: [...], total } — each with builder's display_name attached
//
// The main registry page (no profile_id) gets every entry as a LIGHT row
// (cover photo only, no description/included_items). The old cap of the
// newest 200 full rows hid every build older than about a month, which
// also meant nothing old enough to be community verified was ever shown.
// A builder's own page (profile_id) still gets full rows.

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import { withCache } from "./_lib/cache.js";

const VERIFY_AFTER_DAYS = 30;
const MAX_ROWS = 3000;

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const cacheKey = (e) => `registry:list:v2:${new URLSearchParams(e.queryStringParameters || {}).toString()}`;
  return withCache(cacheKey, 60, fetchRegistry, event);
}

async function fetchRegistry(event) {
  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  const sortBySaves = params.sort === "saves";

  let query = db
    .from("build_registry")
    .select("*, profiles!build_registry_profile_id_fkey(display_name, rbx_avatar_url)")
    .neq("status", "removed")
    .order(sortBySaves ? "save_count" : "created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (params.house_id)    query = query.eq("house_id", params.house_id);
  if (params.profile_id)  query = query.eq("profile_id", params.profile_id);
  // Filter themes in the DB instead of fetching every row and slicing in JS
  if (params.theme)       query = query.contains("themes", [params.theme]);

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load the build registry" });
  }

  const { data: disputedIds } = await db.from("build_registry_disputes").select("build_registry_id");
  const disputedSet = new Set((disputedIds || []).map((d) => d.build_registry_id));

  const light = !params.profile_id;

  const entries = data.map((e) => {
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86400000;
    const is_community_verified = e.status === "active" && !disputedSet.has(e.id) && ageDays >= VERIFY_AFTER_DAYS;
    if (!light) return { ...e, is_community_verified };
    const { description, included_items, photos, ...rest } = e;
    return {
      ...rest,
      // Cover photo only, kept as an array so `photos?.[0]` callers work.
      photos: Array.isArray(photos) && photos.length ? [photos[0]] : [],
      is_community_verified,
    };
  });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
    },
    body: JSON.stringify({ entries, total: entries.length }),
  };
}

export const handler = safeHandler(handlerImpl);
