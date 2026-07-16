// GET, Authorization: Bearer <token>
// -> { profile, stats: { completed_trades, active_listings, member_since },
//      listings: [{ ...listing, offers: [...] }] }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  const db = supabaseAdmin();

  const { data: listings, error: listingsErr } = await db
    .from("listings")
    .select("*, offers(*, profiles(rbx_username, rbx_avatar_url))")
    .eq("profile_id", profile.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (listingsErr) {
    console.error(listingsErr);
    return json(500, { error: "Couldn't load your listings" });
  }

  // Completed trades = corroborated trades where this profile was either
  // the lister or the offerer.
  const { count: asLister } = await db
    .from("completed_trades")
    .select("id, listings!inner(profile_id)", { count: "exact", head: true })
    .eq("status", "corroborated")
    .eq("listings.profile_id", profile.id);

  const { count: asOfferer } = await db
    .from("completed_trades")
    .select("id, offers!inner(offering_profile_id)", { count: "exact", head: true })
    .eq("status", "corroborated")
    .eq("offers.offering_profile_id", profile.id);

  const stats = {
    completed_trades: (asLister || 0) + (asOfferer || 0),
    active_listings: listings.filter((l) => l.status === "active").length,
    member_since: profile.created_at,
  };

  return json(200, {
    profile: {
      id: profile.id,
      rbx_username: profile.rbx_username,
      rbx_avatar_url: profile.rbx_avatar_url,
    },
    stats,
    listings,
  });
}

export const handler = safeHandler(handlerImpl);
