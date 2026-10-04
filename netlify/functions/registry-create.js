// POST, Authorization: Bearer <token>
// body: { title, description, themes, photos, house_id, build_type }
// -> { entry }
//
// Post-first, not pre-approved — live immediately. Runs the duplicate
// heuristics in _lib/duplicates.js against existing active entries.
//
// Re-registering an image THIS submitter already registered is rejected:
// the earlier entry already carries the claim, so the second one only adds
// noise (one account had eight entries sharing a single photo). Everything
// else is flagged for admin review and never blocked — a photo first
// registered by someone else may be a real ownership dispute, and that is
// what the dispute system exists for.
//
// Still not perceptual hashing: this matches identical stored files, which
// is the pattern actually present in the data.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";
import { findDuplicate } from "./_lib/duplicates.js";

const VALID_THEMES = [
  "cutecore",
  "coquette",
  "cottagecore",
  "cozy",
  "gothic",
  "cutegoth",
  "cottagegoth",
  "realism",
  "fairycore",
  "nature",
  "garden",
  "japanese",
  "modern",
  "minimalist",
  "medieval",
  "dark_academia",
  "royal",
  "victorian",
  "vintage",
  "beach",
  "tropical",
  "farmhouse",
  "autumn",
  "winter_cabin",
  "spring",
  "fantasy",
  "horror",
  "holiday_seasonal",
  "custom_theme",
];

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Create a profile first" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { title, description, themes, photos, house_id, included_items, build_type } = body;

  if (!title?.trim()) {
    return json(400, { error: "Give your build a title" });
  }
  const cleanPhotos = Array.isArray(photos) ? photos.filter((p) => typeof p === "string" && p.startsWith("http")) : [];
  if (cleanPhotos.length < 1) {
    return json(400, { error: "At least 1 photo is required to register a build" });
  }
  const cleanThemes = Array.isArray(themes) ? themes.filter((t) => VALID_THEMES.includes(t)) : [];
  const VALID_BUILD_TYPES = ["original", "speedbuild", "cloned"];
  const cleanBuildType = VALID_BUILD_TYPES.includes(build_type) ? build_type : "original";
  const cleanIncludedItems = Array.isArray(included_items)
    ? included_items.slice(0, 30).map((it) => ({
        category: String(it.category || ""),
        id: String(it.id || ""),
        name: String(it.name || ""),
        image: String(it.image || ""),
        qty: Math.min(20, Math.max(1, Number(it.qty) || 1)),
        ...(it.category === "adopt_me_pets"
          ? {
              variant: ["regular", "neon", "mega_neon"].includes(it.variant) ? it.variant : "regular",
              potion: ["none", "ride", "fly", "fly_ride"].includes(it.potion) ? it.potion : "none",
            }
          : {}),
      }))
    : [];

  const db = supabaseAdmin();

  // Duplicate check. Candidates are ordered oldest-first so the earliest
  // entry keeps the claim. photos is needed here for image matching, which
  // makes the rows bigger — acceptable at a few dozen registrations a day,
  // worth revisiting if the registry grows past a few thousand entries.
  let possibleDuplicateOf = null;
  let duplicateReason = null;
  try {
    const { data: candidates, error: dupErr } = await db
      .from("build_registry")
      .select("id, title, photos, profile_id")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    // A failed query must not silently mean "no duplicates found" — that is
    // how detection quietly stopped working before.
    if (dupErr) throw dupErr;

    const found = findDuplicate(
      { title, photos: cleanPhotos, profileId: profile.id },
      candidates || []
    );
    possibleDuplicateOf = found.duplicateOf;
    duplicateReason = found.reason;
  } catch (err) {
    console.error("[registry-create] duplicate check failed (non-fatal):", err);
  }

  if (duplicateReason === "self_photo") {
    return json(409, {
      error:
        "You've already registered this photo on another build. Open that entry to edit it, or remove it first if you want to register it again.",
      code: "ALREADY_REGISTERED",
      existing_entry_id: possibleDuplicateOf,
    });
  }

  const { data: entry, error } = await db
    .from("build_registry")
    .insert({
      profile_id: profile.id,
      title: String(title).slice(0, 120),
      description: description ? String(description).slice(0, 2000) : null,
      photos: cleanPhotos,
      themes: cleanThemes,
      included_items: cleanIncludedItems,
      house_id: house_id || null,
      build_type: cleanBuildType,
      possible_duplicate_of: possibleDuplicateOf,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: `Couldn't register build: ${error.message || JSON.stringify(error)}` });
  }

  await invalidate("registry:list:");
  return json(200, { entry });
}

export const handler = safeHandler(handlerImpl);
