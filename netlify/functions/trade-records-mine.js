// GET, Authorization: Bearer <token>
// -> { records: [...] } — this member's recent trade submissions

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });
  if (!profile.is_data_team_member) return json(403, { error: "Data Team members only" });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("trade_records")
    .select("id, trade_date, source, confidence, side_a, side_b, side_a_value_shark, side_b_value_shark, notes, created_at")
    .eq("logged_by", profile.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { console.error(error); return json(500, { error: "Couldn't load records" }); }

  return json(200, { records: data || [] });
}

export const handler = safeHandler(handlerImpl);
