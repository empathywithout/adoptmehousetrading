// GET ?theme=cottagecore&house_id=castle&profile_id=<id>
// -> { entries: [...] } — each with builder's display_name attached

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

const VERIFY_AFTER_DAYS = 30;

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("build_registry")
    .select("*, profiles!build_registry_profile_id_fkey(display_name, rbx_avatar_url)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.house_id) {
    query = query.eq("house_id", params.house_id);
  }
  if (params.profile_id) {
    query = query.eq("profile_id", params.profile_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load the build registry" });
  }

  // Same computation as registry-get.js: verified requires knowing whether
  // an entry was EVER disputed, not just its current status, so we need a
  // quick lookup of which entries have any dispute row at all.
  const { data: disputedIds } = await db.from("build_registry_disputes").select("build_registry_id");
  const disputedSet = new Set((disputedIds || []).map((d) => d.build_registry_id));

  const withVerification = data.map((e) => {
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86400000;
    const is_community_verified = e.status === "active" && !disputedSet.has(e.id) && ageDays >= VERIFY_AFTER_DAYS;
    return { ...e, is_community_verified };
  });

  const entries = params.theme ? withVerification.filter((e) => (e.themes || []).includes(params.theme)) : withVerification;

  return json(200, { entries });
}

export const handler = safeHandler(handlerImpl);
