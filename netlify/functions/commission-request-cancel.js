// POST, Authorization: Bearer <token>
// body: { request_id }
// -> { request }
//
// Either party can cancel an ACCEPTED commission before it's delivered —
// same reasoning as offers-cancel.js. Not allowed once delivered/verified,
// since at that point there's actual completed work to account for rather
// than just a plan someone's backing out of.

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

  const { request_id } = body;
  if (!request_id) {
    return json(400, { error: "request_id is required" });
  }

  const db = supabaseAdmin();
  const { data: request } = await db.from("commission_requests").select("*").eq("id", request_id).maybeSingle();

  if (!request) {
    return json(404, { error: "Request not found" });
  }

  const isBuilder = request.builder_profile_id === profile.id;
  const isRequester = request.requester_profile_id === profile.id;
  if (!isBuilder && !isRequester) {
    return json(403, { error: "Not a party to this commission" });
  }

  if (request.status !== "accepted") {
    return json(400, { error: "Only an accepted (not yet delivered) commission can be cancelled" });
  }

  const { data, error } = await db
    .from("commission_requests")
    .update({ status: "cancelled" })
    .eq("id", request_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't cancel" });
  }

  return json(200, { request: data });
}

export const handler = safeHandler(handlerImpl);
