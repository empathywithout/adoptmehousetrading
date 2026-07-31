// GET, Authorization: Bearer <token>
// -> { profile, stats, listings, commission_requests_as_builder,
//      commission_requests_as_requester, build_registry_entries, my_offers,
//      data_team_application, my_guides }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  const db = supabaseAdmin();
  const ACCEPTED_ISH = ["accepted"];
  const REVEALED_STATUSES = ["accepted", "delivered", "verified"];

  // ── My listings ──
  const { data: listings, error: listingsErr } = await db
    .from("listings")
    .select("*")
    .eq("profile_id", profile.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (listingsErr) { console.error(listingsErr); return json(500, { error: "Couldn't load your listings" }); }

  // Fetch offers for my listings
  const myListingIds = (listings || []).map(l => l.id);
  let offersByListing = {};
  if (myListingIds.length) {
    const { data: offers } = await db
      .from("offers")
      .select("*")
      .in("listing_id", myListingIds)
      .order("created_at", { ascending: false });

    // Fetch offerer profiles
    const offererIds = [...new Set((offers || []).map(o => o.offering_profile_id))];
    let offererProfiles = {};
    if (offererIds.length) {
      const { data: ps } = await db.from("profiles").select("id, display_name, rbx_username, rbx_avatar_url").in("id", offererIds);
      for (const p of ps || []) offererProfiles[p.id] = p;
    }

    for (const offer of offers || []) {
      const prof = offererProfiles[offer.offering_profile_id] || null;
      offer.profiles = prof ? {
        ...prof,
        rbx_username: ACCEPTED_ISH.includes(offer.status) ? prof.rbx_username : null,
      } : null;
      if (!offersByListing[offer.listing_id]) offersByListing[offer.listing_id] = [];
      offersByListing[offer.listing_id].push(offer);
    }
  }

  const listingsWithOffers = (listings || []).map(l => ({ ...l, offers: offersByListing[l.id] || [] }));

  // ── Commission requests as builder ──
  let requestsAsBuilder = [];
  try {
    const { data, error } = await db
      .from("commission_requests")
      .select("*")
      .eq("builder_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const requesterIds = [...new Set((data || []).map(r => r.requester_profile_id))];
    let requesterProfiles = {};
    if (requesterIds.length) {
      const { data: ps } = await db.from("profiles").select("id, display_name, rbx_username, rbx_avatar_url").in("id", requesterIds);
      for (const p of ps || []) requesterProfiles[p.id] = p;
    }
    requestsAsBuilder = (data || []).map(r => ({
      ...r,
      profiles: requesterProfiles[r.requester_profile_id]
        ? { ...requesterProfiles[r.requester_profile_id], rbx_username: REVEALED_STATUSES.includes(r.status) ? requesterProfiles[r.requester_profile_id].rbx_username : null }
        : null,
    }));
  } catch (err) { console.error("commission_requests (as builder) failed:", err); }

  // ── Commission requests as requester ──
  let requestsAsRequester = [];
  try {
    const { data, error } = await db
      .from("commission_requests")
      .select("*")
      .eq("requester_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const builderIds = [...new Set((data || []).map(r => r.builder_profile_id))];
    let builderProfiles = {};
    if (builderIds.length) {
      const { data: ps } = await db.from("profiles").select("id, display_name, rbx_username, rbx_avatar_url").in("id", builderIds);
      for (const p of ps || []) builderProfiles[p.id] = p;
    }
    requestsAsRequester = (data || []).map(r => ({
      ...r,
      profiles: builderProfiles[r.builder_profile_id]
        ? { ...builderProfiles[r.builder_profile_id], rbx_username: REVEALED_STATUSES.includes(r.status) ? builderProfiles[r.builder_profile_id].rbx_username : null }
        : null,
    }));
  } catch (err) { console.error("commission_requests (as requester) failed:", err); }

  // ── Commissions completed count ──
  let commissionsCompleted = 0;
  try {
    const { count } = await db.from("commission_requests").select("id", { count: "exact", head: true }).eq("builder_profile_id", profile.id).eq("status", "verified");
    commissionsCompleted = count || 0;
  } catch (err) { console.error("commission count failed:", err); }

  // ── My build registry entries ──
  let myBuildRegistryEntries = [];
  try {
    const { data } = await db.from("build_registry").select("*").eq("profile_id", profile.id).neq("status", "removed").order("created_at", { ascending: false });
    myBuildRegistryEntries = data || [];
  } catch (err) { console.error("build_registry failed:", err); }

  // ── My guides ──
  let myGuides = [];
  try {
    const { data } = await db.from("content_submissions").select("id, title, category, published_at, cover_photo").eq("profile_id", profile.id).eq("status", "approved").order("published_at", { ascending: false });
    myGuides = data || [];
  } catch (err) { console.error("my guides failed:", err); }

  // ── Data team application ──
  let dataTeamApplication = null;
  try {
    const { data } = await db.from("data_team_applications").select("status, created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    dataTeamApplication = data || null;
  } catch (err) { console.error("data_team_applications failed:", err); }

  // ── My sent offers ──
  let myOffers = [];
  try {
    const { data, error } = await db
      .from("offers")
      .select("*")
      .eq("offering_profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const listingIds = [...new Set((data || []).map(o => o.listing_id))];
    let offerListings = {};
    if (listingIds.length) {
      const { data: ls } = await db.from("listings").select("id, title, status, house_id, value_amount, value_unit, profile_id").in("id", listingIds);
      const listerIds = [...new Set((ls || []).map(l => l.profile_id))];
      let listerProfiles = {};
      if (listerIds.length) {
        const { data: ps } = await db.from("profiles").select("id, display_name, rbx_username, rbx_avatar_url").in("id", listerIds);
        for (const p of ps || []) listerProfiles[p.id] = p;
      }
      for (const l of ls || []) offerListings[l.id] = { ...l, profiles: listerProfiles[l.profile_id] || null };
    }

    myOffers = (data || []).map(o => {
      const listing = offerListings[o.listing_id] || null;
      if (listing?.profiles && o.status !== "accepted") listing.profiles.rbx_username = null;
      return { ...o, listings: listing };
    });
  } catch (err) { console.error("my offers failed:", err); }

  // ── Completed trades count ──
  let asListerCount = 0, asOffererCount = 0;
  try {
    // Count as lister: completed_trades where listing belongs to this profile
    const { data: listerTrades } = await db.from("completed_trades").select("listing_id").eq("status", "corroborated").in("listing_id", myListingIds.length ? myListingIds : ["00000000-0000-0000-0000-000000000000"]);
    asListerCount = (listerTrades || []).length;

    // Count as offerer: completed_trades where offer belongs to this profile
    const myOfferIds = myOffers.filter(o => o.status === "accepted").map(o => o.id);
    if (myOfferIds.length) {
      const { data: offererTrades } = await db.from("completed_trades").select("offer_id").eq("status", "corroborated").in("offer_id", myOfferIds);
      asOffererCount = (offererTrades || []).length;
    }
  } catch (err) { console.error("completed trades count failed:", err); }

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
    stats: {
      completed_trades: asListerCount + asOffererCount,
      active_listings: listingsWithOffers.filter(l => l.status === "active").length,
      commissions_completed: commissionsCompleted,
      member_since: profile.created_at,
    },
    listings: listingsWithOffers,
    commission_requests_as_builder: requestsAsBuilder,
    commission_requests_as_requester: requestsAsRequester,
    build_registry_entries: myBuildRegistryEntries,
    my_offers: myOffers,
    data_team_application: dataTeamApplication,
    my_guides: myGuides,
  });
}

export const handler = safeHandler(handlerImpl);
