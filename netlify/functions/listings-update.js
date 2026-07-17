// PUT ?id=<listing_id>
// body: { title, description, value_amount, value_unit, bucks_invested,
//         themes, theme_note, looking_for, included_items, video_url, photos }
// -> { listing }
// Only the listing owner can update. house_id, listing_type, and is_cloned
// are intentionally NOT editable — changing them would invalidate existing
// offers which were made based on those facts.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_CATEGORIES = ["adopt_me_pets", "vehicles", "toys", "pet_wear", "stickers", "strollers", "foods"];
const VALID_UNITS = ["shark", "frost", "rp"];
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
  if (event.httpMethod !== "PUT") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Sign in required" });

  const listing_id = event.queryStringParameters?.id;
  if (!listing_id) return json(400, { error: "Missing listing id" });

  const db = supabaseAdmin();

  // Verify ownership and that listing is still active
  const { data: existing, error: fetchErr } = await db
    .from("listings")
    .select("id, profile_id, status, listing_type")
    .eq("id", listing_id)
    .maybeSingle();

  if (fetchErr || !existing) return json(404, { error: "Listing not found" });
  if (existing.profile_id !== profile.id) return json(403, { error: "Not your listing" });
  if (existing.status !== "active") return json(400, { error: "Only active listings can be edited" });

  const body = JSON.parse(event.body || "{}");
  const {
    title, description, value_amount, value_unit, bucks_invested,
    themes, theme_note, looking_for, included_items, video_url, photos,
  } = body;

  // Validate
  const cleanTitle = String(title || "").trim();
  if (cleanTitle.length < 3 || cleanTitle.length > 120) {
    return json(400, { error: "Title must be 3–120 characters" });
  }

  const cleanPhotos = Array.isArray(photos) ? photos.filter((p) => typeof p === "string").slice(0, 8) : [];
  if (existing.listing_type !== "looking_for" && cleanPhotos.length < 5) {
    return json(400, { error: "At least 5 photos are required" });
  }

  const cleanValueAmount = value_amount !== undefined && value_amount !== null && value_amount !== "" && !isNaN(Number(value_amount))
    ? Number(value_amount) : null;
  const cleanValueUnit = VALID_UNITS.includes(value_unit) ? value_unit : null;
  const cleanBucksInvested = bucks_invested !== undefined && !isNaN(Number(bucks_invested))
    ? Number(bucks_invested) : null;
  const cleanThemes = Array.isArray(themes) ? themes.filter((t) => VALID_THEMES.includes(t)) : [];
  const cleanThemeNote = String(theme_note || "").trim().slice(0, 200) || null;
  const cleanLookingFor = Array.isArray(looking_for)
    ? looking_for.filter((c) => VALID_CATEGORIES.includes(c)) : [];
  const cleanVideoUrl = video_url && /^https?:\/\//.test(String(video_url).trim())
    ? String(video_url).trim().slice(0, 500) : null;
  const cleanIncludedItems = Array.isArray(included_items)
    ? included_items.slice(0, 40).map((it) => ({
        category: it.category,
        id: it.id,
        name: it.name,
        image: it.image || null,
        qty: Math.max(1, parseInt(it.qty) || 1),
        ...(it.category === "adopt_me_pets" ? { variant: it.variant || "regular", potion: it.potion || "none" } : {}),
      })) : [];

  const { data: updated, error: updateErr } = await db
    .from("listings")
    .update({
      title: cleanTitle,
      description: String(description || "").trim().slice(0, 2000) || null,
      photos: cleanPhotos,
      value_amount: cleanValueAmount,
      value_unit: cleanValueUnit,
      bucks_invested: cleanBucksInvested,
      themes: cleanThemes,
      theme_note: cleanThemeNote,
      looking_for: cleanLookingFor,
      included_items: cleanIncludedItems,
      video_url: cleanVideoUrl,
      updated_at: new Date().toISOString(),
      build_type: cleanBuildType,
    })
    .eq("id", listing_id)
    .select()
    .maybeSingle();

  if (updateErr) {
    console.error("listings-update error:", updateErr);
    return json(500, { error: "Couldn't save changes" });
  }

  return json(200, { listing: updated });
}

export const handler = safeHandler(handlerImpl);
