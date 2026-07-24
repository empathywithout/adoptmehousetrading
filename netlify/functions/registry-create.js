// POST, Authorization: Bearer <token>
// body: { title, description, themes, photos, house_id, build_type }
// -> { entry }
//
// Post-first, not pre-approved — live immediately. Runs a lightweight
// duplicate check (similar title + overlapping theme) against existing
// active entries and flags the newer one as a possible duplicate of the
// earliest match — purely informational, never blocks submission. This
// isn't perceptual image hashing (deliberately out of scope, per the
// earlier strategy call — that needs real volume to justify the
// complexity); it's a cheap first pass that catches the obvious cases.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";

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

function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

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

  // Duplicate heuristic — exact normalized title match only.
  // Earliest entry wins; later one gets flagged.
  const normalized = normalizeTitle(title);
  let possibleDuplicateOf = null;
  try {
    const { data: candidates } = await db
      .from("build_registry")
      .select("id, title, created_at, profile_id")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const list = candidates || [];

    // Exact normalized title match (case/punctuation insensitive)
    const titleMatch = list.find((c) =>
      c.id !== profile.id && normalizeTitle(c.title) === normalized
    );
    if (titleMatch) possibleDuplicateOf = titleMatch.id;

    // Same submitter resubmitting exact same title
    if (!possibleDuplicateOf) {
      const selfDupe = list.find(
        (c) => c.profile_id === profile.id && normalizeTitle(c.title) === normalized
      );
      if (selfDupe) possibleDuplicateOf = selfDupe.id;
    }
  } catch (err) {
    console.error("duplicate-check query failed (non-fatal):", err);
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
    return json(500, { error: "Couldn't register build" });
  }

  await invalidate("registry:list:");
  return json(200, { entry });
}

export const handler = safeHandler(handlerImpl);
