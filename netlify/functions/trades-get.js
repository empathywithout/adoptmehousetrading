// GET ?offer_id=<uuid>, Authorization: Bearer <token>
// -> { status, lister_confirmed, offerer_confirmed, __isLister } | null
//
// Only the two counterparties on the offer can see this — it's not public
// data until status is 'corroborated' (see the RLS policy in schema.sql for
// the anon-key read path; this function uses the service role and does its
// own authorization check instead).

import { supabaseAdmin, requireProfile, json } from "./_lib/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  const offerId = event.queryStringParameters?.offer_id;
  if (!offerId) {
    return json(400, { error: "Missing offer_id" });
  }

  const db = supabaseAdmin();

  const { data: offer } = await db
    .from("offers")
    .select("id, status, offering_profile_id, listings(profile_id)")
    .eq("id", offerId)
    .maybeSingle();

  if (!offer) {
    return json(404, { error: "Offer not found" });
  }

  const isLister = offer.listings.profile_id === profile.id;
  const isOfferer = offer.offering_profile_id === profile.id;
  if (!isLister && !isOfferer) {
    return json(403, { error: "Not a party to this offer" });
  }

  const { data: trade } = await db
    .from("completed_trades")
    .select("status, lister_confirmed, offerer_confirmed")
    .eq("offer_id", offerId)
    .maybeSingle();

  return json(200, {
    status: trade?.status || "pending",
    lister_confirmed: trade?.lister_confirmed || false,
    offerer_confirmed: trade?.offerer_confirmed || false,
    __isLister: isLister,
  });
}
