// POST, Authorization: Bearer <token>
// body: { category, title, body, video_url, cover_photo, house_id, related_registry_entry_id }
// -> { submission }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_CATEGORIES = ["theme_build", "budget_build", "building_technique", "trading_guide"];

// Per-category content minimums. Longer-form categories (theme builds, budget
// builds, trading guides) need more depth to be genuinely useful as SEO
// articles. Building technique tips can be shorter and still stand alone.
const CAT_MIN = {
  theme_build: 500,
  budget_build: 500,
  building_technique: 300,
  trading_guide: 500,
};

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

  const { category, title, body, video_url, cover_photo, house_id, related_registry_entry_id } = requestBody;

  if (!VALID_CATEGORIES.includes(category)) {
    return json(400, { error: "Valid category is required" });
  }

  const cleanTitle = String(title || "").trim();
  if (cleanTitle.length < 10 || cleanTitle.length > 100) {
    return json(400, { error: "Title must be 10-100 characters" });
  }

  const cleanBody = String(body || "").trim();
  const minChars = CAT_MIN[category] || 300;
  if (cleanBody.length < minChars) {
    return json(400, { error: `Content needs at least ${minChars} characters for this guide type` });
  }

  // Video is a link field only, never a raw upload. A video guide with written
  // content alongside it is indexable by search engines; a video alone isn't.
  const cleanVideoUrl = video_url && /^https?:\/\//.test(String(video_url).trim())
    ? String(video_url).trim().slice(0, 500)
    : null;

  const db = supabaseAdmin();

  // If they linked one of their own registered builds, verify it's theirs.
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
      video_url: cleanVideoUrl,
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
