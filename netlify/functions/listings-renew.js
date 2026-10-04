// POST, Authorization: Bearer <token>
// body: { listing_id }
// -> { listing }
//
// Active listings drop out of Browse after 30 days without an edit or a
// renewal (see listings-list.js). Renewing just bumps updated_at, which
// puts the listing back in Browse for another 30 days.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";

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

  const { listing_id } = body;
  if (!listing_id) {
    return json(400, { error: "listing_id is required" });
  }

  const db = supabaseAdmin();

  const { data: listing } = await db
    .from("listings")
    .select("id, profile_id, status")
    .eq("id", listing_id)
    .maybeSingle();

  if (!listing || listing.status === "removed") {
    return json(404, { error: "Listing not found" });
  }
  if (listing.profile_id !== profile.id) {
    return json(403, { error: "Only the listing owner can renew it" });
  }
  if (listing.status !== "active") {
    return json(400, { error: "Only active listings can be renewed" });
  }

  const { data, error } = await db
    .from("listings")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", listing_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't renew listing" });
  }

  await invalidate("listings:list:");

  return json(200, { listing: data });
}

export const handler = safeHandler(handlerImpl);
