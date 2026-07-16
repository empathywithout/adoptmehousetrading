// GET ?context_type=offer|commission&context_id=<id>, Authorization: Bearer <token>
// -> { messages: [...] }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

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
  if (context_type === "offer") {
    const { data: offer } = await db
      .from("offers")
      .select("offering_profile_id, listings(profile_id)")
      .eq("id", context_id)
      .maybeSingle();
    if (!offer) return json(404, { error: "Offer not found" });
    isParty = offer.offering_profile_id === profile.id || offer.listings.profile_id === profile.id;
  } else {
    const { data: request } = await db
      .from("commission_requests")
      .select("builder_profile_id, requester_profile_id")
      .eq("id", context_id)
      .maybeSingle();
    if (!request) return json(404, { error: "Commission not found" });
    isParty = request.builder_profile_id === profile.id || request.requester_profile_id === profile.id;
  }

  if (!isParty) {
    return json(403, { error: "Not a party to this trade" });
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

  return json(200, { messages });
}

export const handler = safeHandler(handlerImpl);
