// GET ?house_id=&status=
// -> { listings: [...] } — each with profile.rbx_username attached

import { supabaseAdmin, json } from "./_lib/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("listings")
    .select("*, profiles(rbx_username, rbx_avatar_url)")
    .order("created_at", { ascending: false })
    .limit(100);

  query = query.in("status", params.status ? [params.status] : ["active", "traded"]);

  if (params.house_id) {
    query = query.eq("house_id", params.house_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load listings" });
  }

  return json(200, { listings: data });
}
