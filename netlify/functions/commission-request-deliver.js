// POST, Authorization: Bearer <token>
// body: { request_id, delivery_photos }
// -> { request }

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

  const { request_id, delivery_photos } = body;
  if (!request_id) {
    return json(400, { error: "request_id is required" });
  }

  const db = supabaseAdmin();
  const { data: request } = await db.from("commission_requests").select("*").eq("id", request_id).maybeSingle();

  if (!request) {
    return json(404, { error: "Request not found" });
  }
  if (request.builder_profile_id !== profile.id) {
    return json(403, { error: "Only the builder can mark this delivered" });
  }
  if (request.status !== "accepted") {
    return json(400, { error: "Only an accepted request can be marked delivered" });
  }

  const cleanPhotos = Array.isArray(delivery_photos) ? delivery_photos.filter((p) => typeof p === "string").slice(0, 8) : [];

  const { data, error } = await db
    .from("commission_requests")
    .update({ status: "delivered", delivery_photos: cleanPhotos })
    .eq("id", request_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't mark as delivered" });
  }

  await notify(db, request.requester_profile_id, "commission_delivered", "Your commission was marked delivered — check it out", "profile.html");

  return json(200, { request: data });
}

export const handler = safeHandler(handlerImpl);
