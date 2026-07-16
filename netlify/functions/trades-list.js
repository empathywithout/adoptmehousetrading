// GET ?house_id=
// -> { trades: [...] } — corroborated trades only, newest first
//
// This is deliberately thin right now: just what actually got traded for
// what, corroborated by both sides. No value inference, no style/premium
// breakdown — that only makes sense once there's real volume to calibrate
// against (see project notes on comps).

import { supabaseAdmin, json } from "./_lib/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const db = supabaseAdmin();

  let query = db
    .from("completed_trades")
    .select(
      "id, created_at, listing_id, listings(house_id, title, value_amount, value_unit, is_cloned, profiles(rbx_username)), offers(items, offering_profile_id, profiles(rbx_username))"
    )
    .eq("status", "corroborated")
    .order("created_at", { ascending: false })
    .limit(100);

  const houseId = event.queryStringParameters?.house_id;
  if (houseId) {
    query = query.eq("listings.house_id", houseId);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load trades" });
  }

  return json(200, { trades: data });
}
