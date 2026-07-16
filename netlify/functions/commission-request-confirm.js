// POST, Authorization: Bearer <token>
// body: { request_id }
// -> { status, builder_confirmed, requester_confirmed }
//
// Mirrors trades-confirm.js exactly on purpose — "verified" means the same
// thing everywhere on this site (two independent confirmations), whether
// it's a house trade or a commission.

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

  if (!request || request.status !== "delivered") {
    return json(400, { error: "Only a delivered commission can be confirmed" });
  }

  const isBuilder = request.builder_profile_id === profile.id;
  const isRequester = request.requester_profile_id === profile.id;
  if (!isBuilder && !isRequester) {
    return json(403, { error: "Not a party to this commission" });
  }

  const patch = isBuilder ? { builder_confirmed: true } : { requester_confirmed: true };
  const willBothBeConfirmed = isBuilder
    ? true && request.requester_confirmed
    : request.builder_confirmed && true;

  if (willBothBeConfirmed) patch.status = "verified";

  const { data, error } = await db
    .from("commission_requests")
    .update(patch)
    .eq("id", request_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't confirm commission" });
  }

  return json(200, {
    status: data.status,
    builder_confirmed: data.builder_confirmed,
    requester_confirmed: data.requester_confirmed,
  });
}

export const handler = safeHandler(handlerImpl);
