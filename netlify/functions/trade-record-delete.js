// POST, Authorization: Bearer <token>
// body: { id }
// -> { ok: true } — soft delete, only own records

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });
  if (!profile.is_data_team_member) return json(403, { error: "Data Team members only" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const { id } = body;
  if (!id) return json(400, { error: "id required" });

  const db = supabaseAdmin();
  const { data: record } = await db.from("trade_records").select("logged_by").eq("id", id).maybeSingle();
  if (!record) return json(404, { error: "Record not found" });
  if (record.logged_by !== profile.id) return json(403, { error: "Not your record" });

  await db.from("trade_records").update({ status: "removed" }).eq("id", id);
  return json(200, { ok: true });
}

export const handler = safeHandler(handlerImpl);
