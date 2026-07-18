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
      .select("id, profile_id, house_id, listing_type, title, description, created_at, photos, profiles(display_name, rbx_avatar_url)")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't fetch listings" });
    }

    // Jaccard similarity on word sets — returns 0.0–1.0
    function stringSimilarity(a, b) {
      if (!a || !b) return 1; // if either has no description, don't penalize
      const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
      const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      return union === 0 ? 1 : intersection / union;
    }

    // Group by profile_id + house_id + listing_type + normalized title
    const groupMap = {};
    for (const l of listings) {
      const normalizedTitle = l.title.trim().toLowerCase();
      const key = `${l.profile_id}||${l.house_id}||${l.listing_type}||${normalizedTitle}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(l);
    }

    // Within each title group, further split if descriptions are too different
    const dupeGroups = [];
    for (const group of Object.values(groupMap)) {
      if (group.length < 2) continue;
      // Anchor to the oldest listing's description; any listing with <70% similarity
      // to the anchor is treated as a different listing, not a dupe
      const anchor = group[0];
      const confirmed = [anchor];
      const remainder = [];
      for (const l of group.slice(1)) {
        const sim = stringSimilarity(anchor.description || "", l.description || "");
        if (sim >= 0.7) confirmed.push(l);
        else remainder.push(l);
      }
      if (confirmed.length > 1) dupeGroups.push(confirmed);
      // If anything got split off, try grouping it against itself too
      if (remainder.length > 1) dupeGroups.push(remainder);
    }

    // Only return groups with 2+ listings (actual dupes)
    const groups = dupeGroups
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
