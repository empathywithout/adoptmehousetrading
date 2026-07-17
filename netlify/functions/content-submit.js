// POST, Authorization: Bearer <token>
// body: { category, title, body, cover_photo, house_id, related_registry_entry_id }
// -> { submission }
//
// Categories reflect what the community actually organizes build content
// around, not a generic "guide" bucket: theme builds (cottagecore, gothic,
// Japanese/Korean minimalist, etc.), budget/challenge builds, building
// techniques/tricks, and trading & value guides.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_CATEGORIES = ["theme_build", "budget_build", "building_technique", "trading_guide"];

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  let requestBody;
  try {
    requestBody = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { category, title, body, cover_photo, house_id, related_registry_entry_id } = requestBody;

  if (!VALID_CATEGORIES.includes(category)) {
    return json(400, { error: "Valid category is required" });
  }
  const cleanTitle = String(title || "").trim();
  if (cleanTitle.length < 10 || cleanTitle.length > 100) {
    return json(400, { error: "Title must be 10–100 characters" });
  }
  const cleanBody = String(body || "").trim();
  if (cleanBody.length < 800) {
    return json(400, { error: "Guides need to be at least 800 characters — enough to genuinely help someone reading it" });
  }

  const db = supabaseAdmin();

  // If they linked one of their own registered builds, verify it's actually
  // theirs — same reasoning as the builder cover-photo feature.
  let cleanRegistryEntryId = null;
  if (related_registry_entry_id) {
    const { data: owned } = await db
      .from("build_registry")
      .select("id")
      .eq("id", related_registry_entry_id)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (owned) cleanRegistryEntryId = related_registry_entry_id;
  }

  const { data, error } = await db
    .from("content_submissions")
    .insert({
      profile_id: profile.id,
      category,
      title: cleanTitle,
      body: cleanBody.slice(0, 20000),
      cover_photo: cover_photo || null,
      house_id: house_id || null,
      related_registry_entry_id: cleanRegistryEntryId,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit" });
  }

  return json(200, { submission: data });
}

export const handler = safeHandler(handlerImpl);
