// POST, Authorization: Bearer <token>
// body: { offer_id }
// -> { offer }
//
// Either party (lister or offerer) can cancel an ACCEPTED offer before it's
// fully confirmed by both sides — plans change, someone's no longer able
// to trade in-game, etc. Not allowed once the trade is already
// corroborated (both sides confirmed it happened) — at that point it's
// done, not something to back out of. Cancelling reopens the listing for
// other offers and clears any in-progress (unconfirmed) trade-confirmation
// record so it doesn't linger.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { offer_id } = body;
  if (!offer_id) {
    return json(400, { error: "offer_id is required" });
  }

  const db = supabaseAdmin();

  const { data: offer } = await db
    .from("offers")
    .select("*, listings(id, profile_id, status)")
    .eq("id", offer_id)
    .maybeSingle();

  if (!offer) {
    return json(404, { error: "Offer not found" });
  }

  const isLister = offer.listings.profile_id === profile.id;
  const isOfferer = offer.offering_profile_id === profile.id;
  if (!isLister && !isOfferer) {
    return json(403, { error: "Not a party to this trade" });
  }

  if (offer.status !== "accepted") {
    return json(400, { error: "Only an accepted offer can be cancelled" });
  }

  const { data: trade } = await db.from("completed_trades").select("status").eq("offer_id", offer_id).maybeSingle();
  if (trade?.status === "corroborated") {
    return json(400, { error: "This trade has already been confirmed by both sides and can't be cancelled" });
  }

  const { data, error } = await db.from("offers").update({ status: "withdrawn" }).eq("id", offer_id).select().single();
  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't cancel" });
  }

  await db.from("listings").update({ status: "active" }).eq("id", offer.listings.id);

  // Clear any in-progress (unconfirmed) trade record so it doesn't linger
  // if this offer or listing gets acted on again later.
  if (trade) {
    await db.from("completed_trades").delete().eq("offer_id", offer_id);
  }

  return json(200, { offer: data });
}

export const handler = safeHandler(handlerImpl);
