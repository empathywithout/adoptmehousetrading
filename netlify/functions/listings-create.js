// POST, Authorization: Bearer <token>
// body: { house_id, title, description, photos: [url], looking_for: [category] }
// -> { listing }

import {  supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_CATEGORIES = [
  "adopt_me_pets",
  "vehicles",
  "toys",
  "pet_wear",
  "stickers",
  "strollers",
  "foods",
];

const VALID_LISTING_TYPES = ["house_trade", "looking_for", "commission"];

const VALID_THEMES = [
  "cottagecore",
  "cutecore",
  "gothic",
  "realism",
  "nature",
  "modern",
  "fantasy",
  "horror",
  "holiday_seasonal",
  "franchise_crossover",
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

  const {
    listing_type,
    house_id,
    title,
    description,
    photos,
    looking_for,
    included_items,
    is_cloned,
    value_amount,
    value_unit,
    bucks_invested,
    themes,
    theme_note,
  } = body;

  const cleanType = VALID_LISTING_TYPES.includes(listing_type) ? listing_type : "house_trade";

  if (cleanType !== "commission" && !house_id) {
    return json(400, { error: "house_id is required for this listing type" });
  }
  if (!title) {
    return json(400, { error: "title is required" });
  }

  const cleanLookingFor = Array.isArray(looking_for)
    ? looking_for.filter((c) => VALID_CATEGORIES.includes(c))
    : [];

  const cleanPhotos = Array.isArray(photos) ? photos.filter((p) => typeof p === "string").slice(0, 8) : [];

  const cleanIncludedItems = Array.isArray(included_items)
    ? included_items.slice(0, 40).map((it) => ({
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

  // is_cloned only makes sense for an actual house being traded — a
  // "looking_for" or "commission" post isn't claiming a build is theirs.
  const cleanIsCloned = cleanType === "house_trade" && typeof is_cloned === "boolean" ? is_cloned : null;

  const cleanValueAmount =
    value_amount !== undefined && value_amount !== null && value_amount !== "" && !isNaN(Number(value_amount))
      ? Number(value_amount)
      : null;
  const cleanValueUnit = ["shark", "frost", "rp"].includes(value_unit) ? value_unit : null;

  const cleanBucksInvested =
    bucks_invested !== undefined && bucks_invested !== null && bucks_invested !== "" && !isNaN(Number(bucks_invested))
      ? Number(bucks_invested)
      : null;

  const cleanThemes = Array.isArray(themes) ? themes.filter((t) => VALID_THEMES.includes(t)) : [];
  const cleanThemeNote = theme_note ? String(theme_note).slice(0, 100) : null;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("listings")
    .insert({
      profile_id: profile.id,
      listing_type: cleanType,
      house_id: cleanType === "commission" ? null : house_id,
      is_cloned: cleanIsCloned,
      value_amount: cleanValueAmount,
      value_unit: cleanValueAmount !== null ? cleanValueUnit : null,
      bucks_invested: cleanBucksInvested,
      included_items: cleanIncludedItems,
      themes: cleanThemes,
      theme_note: cleanThemeNote,
      title: String(title).slice(0, 120),
      description: description ? String(description).slice(0, 2000) : null,
      photos: cleanPhotos,
      looking_for: cleanLookingFor,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't create listing" });
  }

  return json(200, { listing: data });
}

export const handler = safeHandler(handlerImpl);
