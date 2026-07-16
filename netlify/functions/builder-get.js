// GET ?id=<profile_id>
// -> { builder } — includes a computed cover_photo, same logic as builders-list.js

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return json(400, { error: "Missing id" });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, rbx_avatar_url, builder_bio, commission_status, builder_themes, featured_registry_entry_id, is_builder")
    .eq("id", id)
    .maybeSingle();

  if (error || !data || !data.is_builder) {
    return json(404, { error: "Builder not found" });
  }

  const { data: ownEntries } = await db
    .from("build_registry")
    .select("id, photos, created_at")
    .eq("profile_id", id)
    .order("created_at", { ascending: false });

  const featured = data.featured_registry_entry_id ? (ownEntries || []).find((e) => e.id === data.featured_registry_entry_id) : null;
  const chosen = featured || (ownEntries || [])[0];
  data.cover_photo = chosen?.photos?.[0] || null;

  return json(200, { builder: data });
}

export const handler = safeHandler(handlerImpl);
