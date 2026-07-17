// POST, Authorization: Bearer <token>
// body: { title, description, themes, photos, house_id }
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

  const { title, description, themes, photos, house_id, included_items } = body;

  if (!title?.trim()) {
    return json(400, { error: "Give your build a title" });
  }
  const cleanPhotos = Array.isArray(photos) ? photos.filter((p) => typeof p === "string").slice(0, 8) : [];
  if (!cleanPhotos.length) {
    return json(400, { error: "At least one photo is required to register a build" });
  }
  const cleanThemes = Array.isArray(themes) ? themes.filter((t) => VALID_THEMES.includes(t)) : [];
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

  // Lightweight duplicate heuristic: same normalized title among active
  // entries, earliest wins as the "original" reference point.
  const normalized = normalizeTitle(title);
  let possibleDuplicateOf = null;
  try {
    const { data: candidates } = await db
      .from("build_registry")
      .select("id, title, created_at")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const match = (candidates || []).find((c) => normalizeTitle(c.title) === normalized);
    if (match) possibleDuplicateOf = match.id;
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
      possible_duplicate_of: possibleDuplicateOf,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't register build" });
  }

  return json(200, { entry });
}

export const handler = safeHandler(handlerImpl);
