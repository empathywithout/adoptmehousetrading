// POST, Authorization: Bearer <token>
// body: { request_id, action: "accept" | "decline" }
// -> { request }
//
// Accepting snapshots the current description into agreed_scope — this is
// the locked-in record both sides can point back to if there's a dispute
// later, directly targeting the real "builder finishes, client ghosts or
// lowballs" scam pattern (there's now something concrete that was agreed
// to before work started).

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

  const { request_id, action } = body;
  if (!request_id || !["accept", "decline"].includes(action)) {
    return json(400, { error: "request_id and a valid action are required" });
  }

  const db = supabaseAdmin();

  const { data: request } = await db.from("commission_requests").select("*").eq("id", request_id).maybeSingle();

  if (!request) {
    return json(404, { error: "Request not found" });
  }
  if (request.builder_profile_id !== profile.id) {
    return json(403, { error: "Only the builder can respond to this request" });
  }
  if (request.status !== "pending") {
    return json(400, { error: "This request has already been responded to" });
  }

  const patch =
    action === "accept"
      ? { status: "accepted", agreed_scope: request.description }
      : { status: "declined" };

  const { data, error } = await db
    .from("commission_requests")
    .update(patch)
    .eq("id", request_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't respond to request" });
  }

  await notify(
    db,
    request.requester_profile_id,
    action === "accept" ? "commission_accepted" : "commission_declined",
    action === "accept" ? "Your commission request was accepted!" : "Your commission request was declined",
    "profile.html"
  );

  return json(200, { request: data });
}

export const handler = safeHandler(handlerImpl);
