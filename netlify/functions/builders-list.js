// GET ?status=open&theme=cottagecore
// -> { builders: [...] }

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("profiles")
    .select("id, rbx_username, rbx_avatar_url, builder_bio, commission_status, portfolio_photos, builder_themes, created_at")
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

  return json(200, { builders });
}

export const handler = safeHandler(handlerImpl);
