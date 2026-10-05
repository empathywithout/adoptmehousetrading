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

import { supabaseAdmin, requireProfile, notify, json, safeHandler } from "./_lib/supabase.js";
import { tooManyAttemptsFailOpen } from "./_lib/reset.js";

// Hearts a builder is told about. Every single one would be spam on a popular
// build; silence makes the whole feature pointless, which is roughly where
// this feature has been.
//
// Measured on production 2026-10-05, right after repairing the count (the
// maintaining trigger had never been applied live, so save_count sat at 0 and
// the "Most Hearted" sort ordered by a constant): 26 hearts across 22 of 504
// builds, most of those 22 holding exactly one. So the first heart is the
// common case by a wide margin and is the one most worth sending.
const HEART_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]);

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  // Was an in-memory Map, which reset on every cold start and therefore
  // counted almost nothing. Shared across invocations now.
  if (await tooManyAttemptsFailOpen(`heart:${profile.id}`, 30, 60 * 60)) {
    return json(429, { error: "Slow down — you've hearted a lot of builds recently" });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const { build_registry_id } = body;
  if (!build_registry_id) return json(400, { error: "build_registry_id required" });

  const db = supabaseAdmin();

  // Fetch the entry to verify it exists and isn't the user's own build
  const { data: entry, error: entryErr } = await db
    .from("build_registry")
    .select("id, profile_id, save_count, status, title")
    .eq("id", build_registry_id)
    .neq("status", "removed")
    .maybeSingle();

  if (entryErr || !entry) return json(404, { error: "Build not found" });
  if (entry.profile_id === profile.id) {
    return json(400, { error: "You can't heart your own build" });
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
    const count = updated?.save_count ?? entry.save_count + 1;

    // The point of the whole feature: the builder finds out. Hearting used to
    // tell them nothing, which is a fair part of why hearts never caught on.
    if (HEART_MILESTONES.has(count)) {
      const title = entry.title || "your build";
      const message =
        count === 1
          ? `Someone hearted your build "${title}".`
          : `Your build "${title}" now has ${count} hearts.`;
      await notify(db, entry.profile_id, "build_hearted", message, `registry/entry.html?id=${build_registry_id}`);
    }

    return json(200, { saved: true, save_count: count });
  }
}

export const handler = safeHandler(handlerImpl);
