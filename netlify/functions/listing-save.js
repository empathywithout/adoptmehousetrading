// POST, Authorization: Bearer <token>
// body: { listing_id }
// -> { saved: bool, save_count: number }
// Idempotent toggle — same pattern as registry-save.js

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const rateLimiter = new Map();
function checkRateLimit(profileId) {
  const now = Date.now();
  const entry = rateLimiter.get(profileId);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(profileId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });
  if (!checkRateLimit(profile.id)) return json(429, { error: "Slow down — you've saved a lot of listings recently" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const { listing_id } = body;
  if (!listing_id) return json(400, { error: "listing_id required" });

  const db = supabaseAdmin();

  const { data: listing, error: listingErr } = await db
    .from("listings")
    .select("id, profile_id, save_count, status")
    .eq("id", listing_id)
    .neq("status", "removed")
    .maybeSingle();

  if (listingErr || !listing) return json(404, { error: "Listing not found" });
  if (listing.profile_id === profile.id) return json(400, { error: "You can't save your own listing" });

  const { data: existing } = await db
    .from("listing_saves")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("listing_id", listing_id)
    .maybeSingle();

  if (existing) {
    await db.from("listing_saves").delete().eq("id", existing.id);
    await db.from("listings").update({ save_count: Math.max(0, (listing.save_count || 0) - 1) }).eq("id", listing_id);
    return json(200, { saved: false, save_count: Math.max(0, (listing.save_count || 0) - 1) });
  } else {
    const { error: insertErr } = await db.from("listing_saves").insert({ profile_id: profile.id, listing_id });
    if (insertErr) {
      if (insertErr.code === "23505") return json(200, { saved: true, save_count: listing.save_count });
      return json(500, { error: "Couldn't save" });
    }
    const newCount = (listing.save_count || 0) + 1;
    await db.from("listings").update({ save_count: newCount }).eq("id", listing_id);
    return json(200, { saved: true, save_count: newCount });
  }
}

export const handler = safeHandler(handlerImpl);
