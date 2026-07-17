// GET ?id=<profile_id>
// -> { player: { display_name, rbx_avatar_url, member_since, completed_trades,
//               active_listings, is_builder, is_data_team_member } }
//
// Public trade reputation stats — same completed_trades computation as
// profile-dashboard.js's private stats, just exposed for anyone to view
// about anyone else. Deliberately narrow: real Roblox username, email,
// and anything else private stays private — this only surfaces what's
// already meant to be public trust signal (display name, avatar, trade
// count), not an open window into someone's account.

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

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, display_name, rbx_avatar_url, created_at, is_builder, is_data_team_member")
    .eq("id", id)
    .maybeSingle();

  if (error || !profile) {
    return json(404, { error: "Player not found" });
  }

  const { count: asLister } = await db
    .from("completed_trades")
    .select("id, listings!inner(profile_id)", { count: "exact", head: true })
    .eq("status", "corroborated")
    .eq("listings.profile_id", id);

  const { count: asOfferer } = await db
    .from("completed_trades")
    .select("id, offers!inner(offering_profile_id)", { count: "exact", head: true })
    .eq("status", "corroborated")
    .eq("offers.offering_profile_id", id);

  const { count: activeListings } = await db
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", id)
    .eq("status", "active");

  const { count: registeredBuilds } = await db
    .from("build_registry")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", id)
    .neq("status", "removed");

  return json(200, {
    player: {
      id: profile.id,
      display_name: profile.display_name,
      rbx_avatar_url: profile.rbx_avatar_url,
      member_since: profile.created_at,
      is_builder: profile.is_builder,
      is_data_team_member: profile.is_data_team_member,
      completed_trades: (asLister || 0) + (asOfferer || 0),
      active_listings: activeListings || 0,
      registered_builds: registeredBuilds || 0,
    },
  });
}

export const handler = safeHandler(handlerImpl);
