// POST, Authorization: Bearer <token>
// body: { house_id, title, description, photos: [url], looking_for: [category] }
// -> { listing }

import { supabaseAdmin, requireProfile, json } from "./_lib/supabase.js";

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

export async function handler(event) {
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
    is_cloned,
    value_points,
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

  // is_cloned only makes sense for an actual house being traded — a
  // "looking_for" or "commission" post isn't claiming a build is theirs.
  const cleanIsCloned = cleanType === "house_trade" && typeof is_cloned === "boolean" ? is_cloned : null;

  const cleanValuePoints =
    value_points !== undefined && value_points !== null && value_points !== "" && !isNaN(Number(value_points))
      ? Number(value_points)
      : null;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("listings")
    .insert({
      profile_id: profile.id,
      listing_type: cleanType,
      house_id: cleanType === "commission" ? null : house_id,
      is_cloned: cleanIsCloned,
      value_points: cleanValuePoints,
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
