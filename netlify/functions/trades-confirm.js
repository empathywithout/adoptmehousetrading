// POST, Authorization: Bearer <token>
// body: { offer_id, proof_photo? }
// -> { status, lister_confirmed, offerer_confirmed }
//
// Two independent confirmations (lister + offerer) on the same offer is the
// corroboration signal — no video/hashing needed for this to mean something.
// If only one side ever confirms, the trade stays 'pending' indefinitely,
// which is fine — it just doesn't feed the public comps feed.

import {  supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

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

  const { offer_id, proof_photo } = body;
  if (!offer_id) {
    return json(400, { error: "offer_id is required" });
  }

  const db = supabaseAdmin();

  const { data: offer } = await db
    .from("offers")
    .select("id, status, listing_id, offering_profile_id, listings(profile_id)")
    .eq("id", offer_id)
    .maybeSingle();

  if (!offer || offer.status !== "accepted") {
    return json(400, { error: "Only accepted offers can be confirmed as completed trades" });
  }

  const isLister = offer.listings.profile_id === profile.id;
  const isOfferer = offer.offering_profile_id === profile.id;
  if (!isLister && !isOfferer) {
    return json(403, { error: "Not a party to this offer" });
  }

  const { data: existing } = await db
    .from("completed_trades")
    .select("*")
    .eq("offer_id", offer_id)
    .maybeSingle();

  const patch = isLister
    ? { lister_confirmed: true, lister_proof_photo: proof_photo || existing?.lister_proof_photo || null }
    : { offerer_confirmed: true, offerer_proof_photo: proof_photo || existing?.offerer_proof_photo || null };

  const merged = {
    offer_id,
    listing_id: offer.listing_id,
    lister_confirmed: existing?.lister_confirmed || false,
    offerer_confirmed: existing?.offerer_confirmed || false,
    lister_proof_photo: existing?.lister_proof_photo || null,
    offerer_proof_photo: existing?.offerer_proof_photo || null,
    ...patch,
  };
  merged.status = merged.lister_confirmed && merged.offerer_confirmed ? "corroborated" : "pending";
  merged.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("completed_trades")
    .upsert(merged, { onConflict: "offer_id" })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't confirm trade" });
  }

  return json(200, {
    status: data.status,
    lister_confirmed: data.lister_confirmed,
    offerer_confirmed: data.offerer_confirmed,
  });
}

export const handler = safeHandler(handlerImpl);
