// GET ?id=<listing_id>
// -> { listing, offers: [...] }
//
// Offers include the offering player's rbx_username so the lister knows who
// to friend/trade in-game, but this endpoint is public — anyone can see the
// offers on a listing, same as Traderie shows offer history publicly.

import {  supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return json(400, { error: "Missing id" });
  }

  const db = supabaseAdmin();

  const { data: listing, error: listingErr } = await db
    .from("listings")
    .select("*, profiles(rbx_username, rbx_avatar_url)")
    .eq("id", id)
    .maybeSingle();

  if (listingErr || !listing) {
    return json(404, { error: "Listing not found" });
  }

  const { data: offers, error: offersErr } = await db
    .from("offers")
    .select("*, profiles(rbx_username, rbx_avatar_url)")
    .eq("listing_id", id)
    .order("created_at", { ascending: false });

  if (offersErr) {
    console.error(offersErr);
    return json(500, { error: "Couldn't load offers" });
  }

  return json(200, { listing, offers });
}

export const handler = safeHandler(handlerImpl);
