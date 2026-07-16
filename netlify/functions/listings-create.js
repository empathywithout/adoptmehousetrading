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

  const { house_id, title, description, photos, looking_for } = body;

  if (!house_id || !title) {
    return json(400, { error: "house_id and title are required" });
  }

  const cleanLookingFor = Array.isArray(looking_for)
    ? looking_for.filter((c) => VALID_CATEGORIES.includes(c))
    : [];

  const cleanPhotos = Array.isArray(photos) ? photos.filter((p) => typeof p === "string").slice(0, 8) : [];

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("listings")
    .insert({
      profile_id: profile.id,
      house_id,
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
