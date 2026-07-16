// GET ?id=<profile_id>
// -> { builder }

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
    .select("id, rbx_username, rbx_avatar_url, builder_bio, commission_status, portfolio_photos, builder_themes, is_builder")
    .eq("id", id)
    .maybeSingle();

  if (error || !data || !data.is_builder) {
    return json(404, { error: "Builder not found" });
  }

  return json(200, { builder: data });
}

export const handler = safeHandler(handlerImpl);
