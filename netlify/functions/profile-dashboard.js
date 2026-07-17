// GET, Authorization: Bearer <token>
// -> { profile, stats: { completed_trades, active_listings, member_since },
//      listings: [{ ...listing, offers: [...] }],
//      commission_requests_as_builder: [...], commission_requests_as_requester: [...] }

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
    .select("*, offers(*, profiles(display_name, rbx_username, rbx_avatar_url))")
    .eq("profile_id", profile.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (listingsErr) {
    console.error(listingsErr);
    return json(500, { error: "Couldn't load your listings" });
  }

  // Roblox username is private — only reveal it on an offer once it's
  // actually been accepted (the two parties now need to coordinate the
  // in-game trade). Everyone else's offers on your own listings still show
  // only their display_name.
  const ACCEPTED_ISH = ["accepted"];
  for (const listing of listings) {
    for (const offer of listing.offers || []) {
      if (offer.profiles && !ACCEPTED_ISH.includes(offer.status)) {
        offer.profiles.rbx_username = null;
      }
    }
  }

  // Commission data is queried defensively — if commission_requests doesn't
  // exist yet (migration not run) or errors for any other reason, the rest
  // of the dashboard (listings, trade stats) should still load. A missing
  // secondary feature shouldn't take down the whole profile page.
  let requestsAsBuilder = [];
  let requestsAsRequester = [];
  let commissionsCompleted = 0;
  const REVEALED_STATUSES = ["accepted", "delivered", "verified"];

  try {
    const { data, error } = await db
      .from("commission_requests")
      .select("*, profiles!commission_requests_requester_profile_id_fkey(display_name, rbx_username, rbx_avatar_url)")
      .eq("builder_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    requestsAsBuilder = (data || []).map((r) => {
      if (r.profiles && !REVEALED_STATUSES.includes(r.status)) r.profiles.rbx_username = null;
      return r;
    });
  } catch (err) {
    console.error("commission_requests (as builder) query failed:", err);
  }

  try {
    const { data, error } = await db
      .from("commission_requests")
      .select("*, profiles!commission_requests_builder_profile_id_fkey(display_name, rbx_username, rbx_avatar_url)")
      .eq("requester_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    requestsAsRequester = (data || []).map((r) => {
      if (r.profiles && !REVEALED_STATUSES.includes(r.status)) r.profiles.rbx_username = null;
      return r;
    });
  } catch (err) {
    console.error("commission_requests (as requester) query failed:", err);
  }

  try {
    const { count, error } = await db
      .from("commission_requests")
      .select("id", { count: "exact", head: true })
      .eq("builder_profile_id", profile.id)
      .eq("status", "verified");
    if (error) throw error;
    commissionsCompleted = count || 0;
  } catch (err) {
    console.error("commission count query failed:", err);
  }

  let myBuildRegistryEntries = [];
  try {
    const { data, error } = await db
      .from("build_registry")
      .select("*")
      .eq("profile_id", profile.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false });
    if (error) throw error;
    myBuildRegistryEntries = data || [];
  } catch (err) {
    console.error("build_registry query failed:", err);
  }

  let dataTeamApplication = null;
  try {
    const { data } = await db
      .from("data_team_applications")
      .select("status, created_at")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dataTeamApplication = data || null;
  } catch (err) {
    console.error("data_team_applications query failed:", err);
  }

  // My own sent offers — offers I've made on OTHER people's listings.
  // Distinct from `listings` above, which only covers listings I posted.
  let myOffers = [];
  try {
    const { data, error } = await db
      .from("offers")
      .select("*, listings(id, title, status, house_id, value_amount, value_unit, profile_id, profiles(display_name, rbx_username, rbx_avatar_url))")
      .eq("offering_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    // Same reveal-on-accept rule as everywhere else: the lister's real
    // Roblox username only shows once my offer is actually accepted.
    myOffers = (data || []).map((o) => {
      if (o.listings?.profiles && o.status !== "accepted") {
        o.listings.profiles.rbx_username = null;
      }
      return o;
    });
  } catch (err) {
    console.error("my offers query failed:", err);
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
    commissions_completed: commissionsCompleted,
    member_since: profile.created_at,
  };

  return json(200, {
    profile: {
      id: profile.id,
      display_name: profile.display_name,
      rbx_username: profile.rbx_username,
      rbx_avatar_url: profile.rbx_avatar_url,
      is_builder: profile.is_builder || false,
      builder_bio: profile.builder_bio || null,
      commission_status: profile.commission_status || "closed",
      portfolio_photos: profile.portfolio_photos || [],
      builder_themes: profile.builder_themes || [],
      is_data_team_member: profile.is_data_team_member || false,
    },
    stats,
    listings,
    commission_requests_as_builder: requestsAsBuilder,
    commission_requests_as_requester: requestsAsRequester,
    build_registry_entries: myBuildRegistryEntries,
    my_offers: myOffers,
    data_team_application: dataTeamApplication,
  });
}

export const handler = safeHandler(handlerImpl);
