// GET  -> { entries: [...] }  — all registry entries with possible_duplicate_of set
// POST { id, action: "dismiss" | "remove" } — dismiss flag or remove the entry
//
// "dismiss" clears possible_duplicate_of (not actually a dupe)
// "remove"  sets status = "removed" (confirmed dupe, take it down)

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  const db = supabaseAdmin();

  if (event.httpMethod === "GET") {
    const { data, error } = await db
      .from("build_registry")
      .select("id, title, created_at, status, photos, possible_duplicate_of, profile_id, profiles(display_name, rbx_avatar_url)")
      .not("possible_duplicate_of", "is", null)
      .neq("status", "removed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't fetch registry duplicates" });
    }

    // Also fetch the "original" entries they're flagged against
    const originalIds = [...new Set((data || []).map(e => e.possible_duplicate_of))];
    let originals = {};
    if (originalIds.length) {
      const { data: origData } = await db
        .from("build_registry")
        .select("id, title, created_at, profiles(display_name)")
        .in("id", originalIds);
      (origData || []).forEach(o => { originals[o.id] = o; });
    }

    const entries = (data || []).map(e => ({
      ...e,
      original_entry: originals[e.possible_duplicate_of] || null,
    }));

    return json(200, { entries });
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

    const { id, action } = body;
    if (!id || !["dismiss", "remove"].includes(action)) {
      return json(400, { error: "id and action (dismiss|remove) required" });
    }

    if (action === "dismiss") {
      const { error } = await db
        .from("build_registry")
        .update({ possible_duplicate_of: null })
        .eq("id", id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "remove") {
      const { error } = await db
        .from("build_registry")
        .update({ status: "removed" })
        .eq("id", id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }
  }

  return json(405, { error: "Method not allowed" });
}

export const handler = safeHandler(handlerImpl);
