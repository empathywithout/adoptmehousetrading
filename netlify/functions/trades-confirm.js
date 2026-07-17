// POST, Authorization: Bearer <token>
// body: { offer_id, proof_photo? }
// -> { status, lister_confirmed, offerer_confirmed }
//
// Two independent confirmations (lister + offerer) on the same offer is the
// corroboration signal — no video/hashing needed for this to mean something.
// If only one side ever confirms, the trade stays 'pending' indefinitely,
// which is fine — it just doesn't feed the public comps feed.

import { supabaseAdmin, requireProfile, notify, json, safeHandler } from "./_lib/supabase.js";

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
    .select("id, status, listing_id, offering_profile_id, items, listings(profile_id, title, value_amount, value_unit)")
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

  const justCorroborated = data.status === "corroborated" && existing?.status !== "corroborated";

  const otherPartyId = isLister ? offer.offering_profile_id : offer.listings.profile_id;
  if (justCorroborated) {
    await notify(db, offer.listings.profile_id, "trade_corroborated", `Trade for "${offer.listings.title}" is fully confirmed!`, `listings/listing.html?id=${offer.listing_id}`);
    await notify(db, offer.offering_profile_id, "trade_corroborated", `Trade for "${offer.listings.title}" is fully confirmed!`, `listings/listing.html?id=${offer.listing_id}`);
  } else if (data.status === "pending") {
    await notify(db, otherPartyId, "trade_confirm_needed", `${profile.display_name} confirmed the trade for "${offer.listings.title}" — confirm your side too`, `listings/listing.html?id=${offer.listing_id}`);
  }

  // Recompute item values the moment this trade newly becomes corroborated
  // — not on a schedule, since there's no cron infrastructure, and this
  // keeps values fresh the instant real data exists. Only single-item-type
  // offers count as clean per-item pricing signals (see item_values comment
  // in schema.sql for why multi-item offers are excluded).
  if (justCorroborated && offer.listings.value_amount != null && offer.items?.length === 1) {
    try {
      const item = offer.items[0];
      const qty = Math.max(1, Number(item.qty) || 1);
      const impliedValue = offer.listings.value_amount / qty;
      const unit = offer.listings.value_unit;

      const { data: existingValue } = await db
        .from("item_values")
        .select("*")
        .eq("category", item.category)
        .eq("item_id", item.id)
        .is("variant", item.variant || null)
        .is("potion", item.potion || null)
        .eq("value_unit", unit)
        .maybeSingle();

      if (existingValue) {
        await db
          .from("item_values")
          .update({
            value_low: Math.min(existingValue.value_low, impliedValue),
            value_high: Math.max(existingValue.value_high, impliedValue),
            sample_size: existingValue.sample_size + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingValue.id);
      } else {
        await db.from("item_values").insert({
          category: item.category,
          item_id: item.id,
          variant: item.variant || null,
          potion: item.potion || null,
          value_unit: unit,
          value_low: impliedValue,
          value_high: impliedValue,
          sample_size: 1,
        });
      }
    } catch (err) {
      // Value recomputation is a nice-to-have layered on top of a
      // successful trade confirmation — never let it fail the actual
      // confirmation the user is waiting on.
      console.error("item_values recompute failed (non-fatal):", err);
    }
  }

  return json(200, {
    status: data.status,
    lister_confirmed: data.lister_confirmed,
    offerer_confirmed: data.offerer_confirmed,
  });
}

export const handler = safeHandler(handlerImpl);
