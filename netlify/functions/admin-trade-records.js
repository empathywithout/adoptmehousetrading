// GET — admin only
// Returns all data team trade records with submitter name
// /.netlify/functions/admin-trade-records

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(403, { error: "Forbidden" });

  const db = supabaseAdmin();

  const { data: records, error } = await db
    .from("trade_records")
    .select("id, logged_by, trade_date, source, confidence, notes, side_a, side_b, house, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) { console.error(error); return json(500, { error: "Could not load records" }); }

  // Fetch submitter display names
  const profileIds = [...new Set((records || []).map(r => r.logged_by).filter(Boolean))];
  let profileMap = {};
  if (profileIds.length) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, display_name")
      .in("id", profileIds);
    (profiles || []).forEach(p => { profileMap[p.id] = p.display_name; });
  }

  const enriched = (records || []).map(r => ({
    ...r,
    logged_by_name: profileMap[r.logged_by] || "unknown",
  }));

  return json(200, { records: enriched });
}

export const handler = safeHandler(handlerImpl);
