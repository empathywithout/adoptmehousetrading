// POST, Authorization: Bearer <token>
// body: { listing_id }
// -> { ok: true }
//
// Soft delete (status='removed'), same pattern as build_registry entries —
// preserves any offers/history tied to it rather than a hard delete, and
// avoids foreign-key issues. A removed listing stops showing up in Browse
// Houses, the homepage's Recently Added, and the owner's own Active
// Listings, but the row itself (and any past offers on it) stays intact.

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

  const { listing_id } = body;
  if (!listing_id) {
    return json(400, { error: "listing_id is required" });
  }

  const db = supabaseAdmin();

  const { data: listing } = await db.from("listings").select("id, profile_id, status").eq("id", listing_id).maybeSingle();
  if (!listing) {
    return json(404, { error: "Listing not found" });
  }
  if (listing.profile_id !== profile.id) {
    return json(403, { error: "Only the person who posted this listing can remove it" });
  }
  if (listing.status === "removed") {
    return json(400, { error: "Already removed" });
  }

  const { error } = await db.from("listings").update({ status: "removed" }).eq("id", listing_id);
  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't remove this listing" });
  }

  // Decline any still-pending offers on it — there's no listing left to accept them for.
  await db.from("offers").update({ status: "declined" }).eq("listing_id", listing_id).eq("status", "pending");

  return json(200, { ok: true });
}

export const handler = safeHandler(handlerImpl);
