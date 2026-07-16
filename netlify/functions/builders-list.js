// GET ?status=open&theme=cottagecore
// -> { builders: [...] } — each with a computed cover_photo

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("profiles")
    .select("id, display_name, rbx_avatar_url, builder_bio, commission_status, builder_themes, featured_registry_entry_id, created_at")
    .eq("is_builder", true)
    .order("created_at", { ascending: false });

  if (params.status && ["open", "closed"].includes(params.status)) {
    query = query.eq("commission_status", params.status);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load builders" });
  }

  const builders = params.theme ? data.filter((b) => (b.builder_themes || []).includes(params.theme)) : data;

  // Cover photo: an explicitly chosen registered build if the builder set
  // one, otherwise their most recent registered build, otherwise none.
  // Computed here in one batch query rather than per-builder to avoid N+1.
  const profileIds = builders.map((b) => b.id);
  let entriesByProfile = {};
  if (profileIds.length) {
    const { data: entries } = await db
      .from("build_registry")
      .select("id, photos, profile_id, created_at")
      .in("profile_id", profileIds)
      .order("created_at", { ascending: false });
    for (const e of entries || []) {
      if (!entriesByProfile[e.profile_id]) entriesByProfile[e.profile_id] = [];
      entriesByProfile[e.profile_id].push(e);
    }
  }

  for (const b of builders) {
    const own = entriesByProfile[b.id] || [];
    const featured = b.featured_registry_entry_id ? own.find((e) => e.id === b.featured_registry_entry_id) : null;
    const chosen = featured || own[0]; // own[0] is most recent, since ordered desc above
    b.cover_photo = chosen?.photos?.[0] || null;
  }

  return json(200, { builders });
}

export const handler = safeHandler(handlerImpl);
