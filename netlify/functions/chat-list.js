// GET ?context_type=offer|commission&context_id=<id>, Authorization: Bearer <token>
// -> { messages: [...], counterparty: { display_name, rbx_username, rbx_user_id, rbx_avatar_url } }
//
// Also verifies the context is actually unlocked (accepted+), not just
// that the caller is a party — same rule chat-send.js enforces, so
// hitting this endpoint directly on a still-pending offer/commission
// can't be used to peek at chat or the counterparty's real username early.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const UNLOCKED_STATUSES = {
  offer: ["accepted"],
  commission: ["accepted", "delivered", "verified"],
};

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  const { context_type, context_id } = event.queryStringParameters || {};
  if (!["offer", "commission"].includes(context_type) || !context_id) {
    return json(400, { error: "Valid context_type and context_id are required" });
  }

  const db = supabaseAdmin();

  let isParty = false;
  let statusOk = false;
  let counterpartyId = null;

  if (context_type === "offer") {
    const { data: offer } = await db
      .from("offers")
      .select("offering_profile_id, status, listings(profile_id)")
      .eq("id", context_id)
      .maybeSingle();
    if (!offer) return json(404, { error: "Offer not found" });
    isParty = offer.offering_profile_id === profile.id || offer.listings.profile_id === profile.id;
    statusOk = UNLOCKED_STATUSES.offer.includes(offer.status);
    counterpartyId = offer.offering_profile_id === profile.id ? offer.listings.profile_id : offer.offering_profile_id;
  } else {
    const { data: request } = await db
      .from("commission_requests")
      .select("builder_profile_id, requester_profile_id, status")
      .eq("id", context_id)
      .maybeSingle();
    if (!request) return json(404, { error: "Commission not found" });
    isParty = request.builder_profile_id === profile.id || request.requester_profile_id === profile.id;
    statusOk = UNLOCKED_STATUSES.commission.includes(request.status);
    counterpartyId = request.builder_profile_id === profile.id ? request.requester_profile_id : request.builder_profile_id;
  }

  if (!isParty) {
    return json(403, { error: "Not a party to this trade" });
  }
  if (!statusOk) {
    return json(400, { error: "Chat unlocks once this is accepted" });
  }

  const { data: messages, error } = await db
    .from("trade_chat_messages")
    .select("*, profiles(display_name)")
    .eq("context_type", context_type)
    .eq("context_id", context_id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load messages" });
  }

  const { data: counterparty } = await db
    .from("profiles")
    .select("display_name, rbx_username, rbx_user_id, rbx_avatar_url")
    .eq("id", counterpartyId)
    .maybeSingle();

  return json(200, { messages, counterparty: counterparty || null });
}

export const handler = safeHandler(handlerImpl);
