// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { stats: { users, active_listings, verified_trades, pending_guides, pending_disputes, data_team_members } }

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Incorrect admin password" });

  const db = supabaseAdmin();

  const [
    { count: users },
    { count: activeListings },
    { count: verifiedTrades },
    { count: pendingGuides },
    { count: pendingDisputes },
    { count: dataTeamMembers },
  ] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("completed_trades").select("id", { count: "exact", head: true }).eq("status", "corroborated"),
    db.from("content_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("build_registry_disputes").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("is_data_team_member", true),
  ]);

  return json(200, {
    stats: {
      users: users || 0,
      active_listings: activeListings || 0,
      verified_trades: verifiedTrades || 0,
      pending_guides: pendingGuides || 0,
      pending_disputes: pendingDisputes || 0,
      data_team_members: dataTeamMembers || 0,
    },
  });
}

export const handler = safeHandler(handlerImpl);
