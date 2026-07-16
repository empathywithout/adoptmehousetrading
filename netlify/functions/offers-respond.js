// POST, Authorization: Bearer <token>
// body: { offer_id, action: "accept" | "decline" }
// -> { offer }
//
// Accepting an offer marks the listing "traded" and auto-declines every
// other pending offer on it (the house is gone — those offers no longer
// make sense to leave open).

import {  supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Create a profile first" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { offer_id, action } = body;
  if (!offer_id || !["accept", "decline"].includes(action)) {
    return json(400, { error: "offer_id and a valid action are required" });
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

  if (offer.listings.profile_id !== profile.id) {
    return json(403, { error: "Only the listing owner can respond to offers" });
  }

  if (offer.status !== "pending") {
    return json(400, { error: "This offer has already been resolved" });
  }

  if (action === "decline") {
    const { data, error } = await db
      .from("offers")
      .update({ status: "declined" })
      .eq("id", offer_id)
      .select()
      .single();
    if (error) return json(500, { error: "Couldn't decline offer" });
    return json(200, { offer: data });
  }

  // action === "accept"
  const { data, error } = await db
    .from("offers")
    .update({ status: "accepted" })
    .eq("id", offer_id)
    .select()
    .single();
  if (error) return json(500, { error: "Couldn't accept offer" });

  await db.from("listings").update({ status: "traded" }).eq("id", offer.listings.id);
  await db
    .from("offers")
    .update({ status: "declined" })
    .eq("listing_id", offer.listings.id)
    .eq("status", "pending");

  return json(200, { offer: data });
}

export const handler = safeHandler(handlerImpl);
