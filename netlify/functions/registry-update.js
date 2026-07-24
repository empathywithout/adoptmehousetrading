// PATCH, Authorization: Bearer <token>
// body: { id, title, description, themes, photos, included_items }
// -> { entry }
//
// Only the original submitter can edit their own registry entry.
// house_id and build_type are locked after submission — they form part
// of the provenance claim and shouldn't be retroactively changeable.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";

const VALID_THEMES = [
  "cutecore", "coquette", "cottagecore", "cozy", "gothic", "cutegoth",
  "cottagegoth", "realism", "fairycore", "nature", "garden", "japanese",
  "modern", "minimalist", "medieval", "dark_academia", "royal", "victorian",
  "vintage", "beach", "tropical", "farmhouse", "autumn", "winter_cabin",
  "spring", "fantasy", "horror", "holiday_seasonal", "custom_theme",
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

  const { id, title, description, themes, photos, included_items } = body;

  if (!id) {
    return json(400, { error: "Entry ID required" });
  }

  // Verify ownership
  const db = supabaseAdmin();
  const { data: existing, error: fetchErr } = await db
    .from("build_registry")
    .select("id, profile_id, status")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return json(404, { error: "Entry not found" });
  }
  if (existing.profile_id !== profile.id) {
    return json(403, { error: "You can only edit your own registry entries" });
  }
  if (existing.status !== "active") {
    return json(400, { error: "Only active entries can be edited" });
  }

  if (!title?.trim()) {
    return json(400, { error: "Give your build a title" });
  }

  const cleanPhotos = Array.isArray(photos)
    ? photos.filter((p) => typeof p === "string" && p.startsWith("http"))
    : [];
  if (cleanPhotos.length < 1) {
    return json(400, { error: "At least 1 photo is required" });
  }

  const cleanThemes = Array.isArray(themes)
    ? themes.filter((t) => VALID_THEMES.includes(t))
    : [];

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

  const { data: entry, error } = await db
    .from("build_registry")
    .update({
      title: String(title).slice(0, 120),
      description: description ? String(description).slice(0, 2000) : null,
      photos: cleanPhotos,
      themes: cleanThemes,
      included_items: cleanIncludedItems,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("registry-update error:", JSON.stringify(error));
    return json(500, { error: error.message || "Couldn't update entry" });
  }

  await invalidate("registry:list:");
  return json(200, { entry });
}

export const handler = safeHandler(handlerImpl);
