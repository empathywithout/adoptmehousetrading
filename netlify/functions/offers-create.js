// POST, Authorization: Bearer <token>
// body: { listing_id, items: [{category,id,name,image}], message }
// -> { offer }

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

  const { listing_id, items, message } = body;

  if (!listing_id) {
    return json(400, { error: "listing_id is required" });
  }

  const db = supabaseAdmin();

  const { data: listing } = await db
    .from("listings")
    .select("id, status, profile_id, listing_type")
    .eq("id", listing_id)
    .maybeSingle();

  if (!listing || listing.status !== "active") {
    return json(400, { error: "This listing isn't accepting offers" });
  }

  if (listing.profile_id === profile.id) {
    return json(400, { error: "You can't respond to your own listing" });
  }

  const itemsRequired = listing.listing_type === "house_trade";
  if (itemsRequired && (!Array.isArray(items) || items.length === 0)) {
    return json(400, { error: "Add at least one item to your offer" });
  }
  if (!itemsRequired && (!Array.isArray(items) || items.length === 0) && !message) {
    return json(400, { error: "Add an item or a message" });
  }

  const cleanItems = Array.isArray(items)
    ? items.slice(0, 20).map((it) => ({
        category: String(it.category || ""),
        id: String(it.id || ""),
        name: String(it.name || ""),
        image: String(it.image || ""),
        qty: Math.min(20, Math.max(1, Number(it.qty) || 1)),
        ...(it.category === "adopt_me_pets"
          ? {
              variant: ["regular", "neon", "mega_neon"].includes(it.variant) ? it.variant : "regular",
              potion: ["none", "ride", "fly", "fly_ride"].includes(it.potion) ? it.potion : "none",
            }
          : {}),
      }))
    : [];

  const { data, error } = await db
    .from("offers")
    .insert({
      listing_id,
      offering_profile_id: profile.id,
      items: cleanItems,
      message: message ? String(message).slice(0, 500) : null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit offer" });
  }

  return json(200, { offer: data });
}

export const handler = safeHandler(handlerImpl);
