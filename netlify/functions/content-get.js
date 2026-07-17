// GET ?id=<submission_id>
// -> { submission } — only if approved

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
    .from("content_submissions")
    .select("id, category, title, body, photos, created_at, published_at, profile_id, profiles(display_name, rbx_avatar_url)")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();

  if (error || !data) {
    return json(404, { error: "Guide not found" });
  }

  return json(200, { submission: data });
}

export const handler = safeHandler(handlerImpl);
