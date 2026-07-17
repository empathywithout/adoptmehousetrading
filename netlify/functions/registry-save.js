// POST, Authorization: Bearer <token>
// body: { build_registry_id }
// -> { saved: bool, save_count: number }
//
// Idempotent toggle: if the user hasn't saved this entry, saves it.
// If they have, unsaves it. Returns the new state + updated count.
//
// Anti-gaming enforced here AND at the DB level:
//   - Must be signed in (requireProfile)
//   - Can't save your own build (checked before DB insert)
//   - One save per user per entry (DB unique constraint)

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

// Rough rate limit: max 30 saves per hour per profile.
// Stored in-memory — resets on function cold start, but cold starts happen
// frequently enough (every few minutes on free tier) that this is a
// meaningful speedbump without needing Redis.
const rateLimiter = new Map(); // profile_id -> { count, resetAt }

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
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  if (!checkRateLimit(profile.id)) {
    return json(429, { error: "Slow down — you've saved a lot of builds recently" });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const { build_registry_id } = body;
  if (!build_registry_id) return json(400, { error: "build_registry_id required" });

  const db = supabaseAdmin();

  // Fetch the entry to verify it exists and isn't the user's own build
  const { data: entry, error: entryErr } = await db
    .from("build_registry")
    .select("id, profile_id, save_count, status")
    .eq("id", build_registry_id)
    .neq("status", "removed")
    .maybeSingle();

  if (entryErr || !entry) return json(404, { error: "Build not found" });
  if (entry.profile_id === profile.id) {
    return json(400, { error: "You can't save your own build" });
  }

  // Check if they've already saved it
  const { data: existing } = await db
    .from("registry_saves")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("build_registry_id", build_registry_id)
    .maybeSingle();

  if (existing) {
    // Unsave
    await db.from("registry_saves").delete().eq("id", existing.id);
    // Read fresh count from the entry (trigger has already updated it)
    const { data: updated } = await db
      .from("build_registry")
      .select("save_count")
      .eq("id", build_registry_id)
      .maybeSingle();
    return json(200, { saved: false, save_count: updated?.save_count ?? Math.max(0, entry.save_count - 1) });
  } else {
    // Save
    const { error: insertErr } = await db.from("registry_saves").insert({
      profile_id: profile.id,
      build_registry_id,
    });
    if (insertErr) {
      // Unique violation means they already saved it (race condition) — treat as already saved
      if (insertErr.code === "23505") {
        return json(200, { saved: true, save_count: entry.save_count });
      }
      console.error("save insert error:", JSON.stringify(insertErr));
      return json(500, { error: "Couldn't save" });
    }
    const { data: updated } = await db
      .from("build_registry")
      .select("save_count")
      .eq("id", build_registry_id)
      .maybeSingle();
    return json(200, { saved: true, save_count: updated?.save_count ?? entry.save_count + 1 });
  }
}

export const handler = safeHandler(handlerImpl);
