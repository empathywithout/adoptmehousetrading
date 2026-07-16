// POST, Authorization: Bearer <token>
// body: { context_type: "offer" | "commission", context_id, preset_key }
// -> { message }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_PRESETS = [
  "ready_now",
  "give_me_a_few_minutes",
  "whats_your_roblox_username",
  "added_you_ingame",
  "sending_trade_request",
  "trade_complete_on_my_end",
  "cant_find_you_ingame",
  "can_we_reschedule",
];

// Statuses at which chat is unlocked for each context — from acceptance
// onward, not just the exact accepted moment.
const UNLOCKED_STATUSES = {
  offer: ["accepted"],
  commission: ["accepted", "delivered", "verified"],
};

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

  const { context_type, context_id, preset_key } = body;
  if (!["offer", "commission"].includes(context_type) || !context_id) {
    return json(400, { error: "Valid context_type and context_id are required" });
  }
  if (!VALID_PRESETS.includes(preset_key)) {
    return json(400, { error: "Not a valid message preset" });
  }

  const db = supabaseAdmin();

  let isParty = false;
  let statusOk = false;

  if (context_type === "offer") {
    const { data: offer } = await db
      .from("offers")
      .select("offering_profile_id, status, listings(profile_id)")
      .eq("id", context_id)
      .maybeSingle();
    if (!offer) return json(404, { error: "Offer not found" });
    isParty = offer.offering_profile_id === profile.id || offer.listings.profile_id === profile.id;
    statusOk = UNLOCKED_STATUSES.offer.includes(offer.status);
  } else {
    const { data: request } = await db
      .from("commission_requests")
      .select("builder_profile_id, requester_profile_id, status")
      .eq("id", context_id)
      .maybeSingle();
    if (!request) return json(404, { error: "Commission not found" });
    isParty = request.builder_profile_id === profile.id || request.requester_profile_id === profile.id;
    statusOk = UNLOCKED_STATUSES.commission.includes(request.status);
  }

  if (!isParty) {
    return json(403, { error: "Not a party to this trade" });
  }
  if (!statusOk) {
    return json(400, { error: "Chat unlocks once this is accepted" });
  }

  const { data: message, error } = await db
    .from("trade_chat_messages")
    .insert({
      context_type,
      context_id,
      sender_profile_id: profile.id,
      preset_key,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't send message" });
  }

  return json(200, { message });
}

export const handler = safeHandler(handlerImpl);
