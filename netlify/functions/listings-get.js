// GET ?id=<listing_id>, Authorization: Bearer <token> (optional)
// -> { listing, offers: [...] }
//
// Roblox username is private. Everyone sees display_name by default. The
// real rbx_username is only included for:
//   - the lister, viewing themselves
//   - the lister, viewing an offer that's been ACCEPTED (they now need to
//     coordinate the in-game trade with that specific person)
//   - an offerer, viewing their own offer (they already know their own
//     username, but no reason to hide it from them)
//   - an offerer whose own offer was accepted, viewing the lister's info
// Everyone else — anonymous visitors, other offerers, the lister looking
// at a still-pending offer — only ever sees display_name.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return json(400, { error: "Missing id" });
  }

  const db = supabaseAdmin();
  const viewer = await requireProfile(event); // null if no/invalid token — that's fine, endpoint is public

  const { data: listing, error: listingErr } = await db
    .from("listings")
    .select("*, profiles(display_name, rbx_username, rbx_avatar_url)")
    .eq("id", id)
    .maybeSingle();

  if (listingErr || !listing) {
    return json(404, { error: "Listing not found" });
  }

  const { data: offers, error: offersErr } = await db
    .from("offers")
    .select("*, profiles(display_name, rbx_username, rbx_avatar_url)")
    .eq("listing_id", id)
    .order("created_at", { ascending: false });

  if (offersErr) {
    console.error(offersErr);
    return json(500, { error: "Couldn't load offers" });
  }

  const viewerIsLister = viewer && viewer.id === listing.profile_id;
  const viewerHasAcceptedOffer = viewer && offers.some((o) => o.offering_profile_id === viewer.id && o.status === "accepted");

  if (!(viewerIsLister || viewerHasAcceptedOffer) && listing.profiles) {
    listing.profiles.rbx_username = null;
  }

  for (const offer of offers) {
    const viewerIsThisOfferer = viewer && viewer.id === offer.offering_profile_id;
    const listerViewingAccepted = viewerIsLister && offer.status === "accepted";
    if (!(viewerIsThisOfferer || listerViewingAccepted) && offer.profiles) {
      offer.profiles.rbx_username = null;
    }
  }

  return json(200, { listing, offers });
}

export const handler = safeHandler(handlerImpl);
