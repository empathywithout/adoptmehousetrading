// GET ?theme=cottagecore&house_id=castle
// -> { entries: [...] } — each with builder's display_name attached

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("build_registry")
    .select("*, profiles(display_name, rbx_avatar_url)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.house_id) {
    query = query.eq("house_id", params.house_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load the build registry" });
  }

  const entries = params.theme ? data.filter((e) => (e.themes || []).includes(params.theme)) : data;

  return json(200, { entries });
}

export const handler = safeHandler(handlerImpl);
