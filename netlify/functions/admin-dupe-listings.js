// GET  -> { groups: [{ profile_id, username, house_id, house_name, listing_type, count, listings: [...] }] }
// POST { listing_id } -> delete that specific listing (must not be the oldest in the group)
//
// Safety: only deletes a single listing per call, never touches the oldest (lowest created_at)
// in a duplicate group, and only operates on listings with status = 'active'.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  const db = supabaseAdmin();

  // GET — find all duplicate groups
  if (event.httpMethod === "GET") {
    // Fetch all active listings with profile + house info
    const { data: listings, error } = await db
      .from("listings")
      .select("id, profile_id, house_id, listing_type, title, created_at, photos, profiles(display_name, rbx_avatar_url)")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't fetch listings" });
    }

    // Group by profile_id + house_id + listing_type
    const groupMap = {};
    for (const l of listings) {
      const key = `${l.profile_id}||${l.house_id}||${l.listing_type}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(l);
    }

    // Only return groups with 2+ listings (actual dupes)
    const groups = Object.values(groupMap)
      .filter((g) => g.length > 1)
      .map((g) => ({
        profile_id: g[0].profile_id,
        username: g[0].profiles?.display_name || g[0].profile_id,
        house_id: g[0].house_id,
        house_name: g[0].house_id,
        listing_type: g[0].listing_type,
        count: g.length,
        // oldest first — the first one is the "keeper"
        listings: g.map((l) => ({
          id: l.id,
          title: l.title,
          created_at: l.created_at,
          thumbnail: l.photos?.[0] || null,
        })),
      }));

    return json(200, { groups });
  }

  // POST — delete a specific listing by id
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const { listing_id } = body;
    if (!listing_id) {
      return json(400, { error: "listing_id is required" });
    }

    // Fetch the target listing
    const { data: target, error: fetchErr } = await db
      .from("listings")
      .select("id, profile_id, house_id, listing_type, status, created_at")
      .eq("id", listing_id)
      .maybeSingle();

    if (fetchErr || !target) {
      return json(404, { error: "Listing not found" });
    }
    if (target.status !== "active") {
      return json(400, { error: "Only active listings can be removed this way" });
    }

    // Safety check: find the oldest active listing in this dupe group
    const { data: siblings } = await db
      .from("listings")
      .select("id, created_at")
      .eq("profile_id", target.profile_id)
      .eq("house_id", target.house_id)
      .eq("listing_type", target.listing_type)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const oldest = siblings?.[0];
    if (oldest?.id === listing_id) {
      return json(400, { error: "Can't delete the oldest listing in a group — delete the newer duplicates instead." });
    }

    const { error: deleteErr } = await db
      .from("listings")
      .delete()
      .eq("id", listing_id);

    if (deleteErr) {
      console.error(deleteErr);
      return json(500, { error: "Couldn't delete listing" });
    }

    return json(200, { deleted: listing_id });
  }

  return json(405, { error: "Method not allowed" });
}

export const handler = safeHandler(handlerImpl);
