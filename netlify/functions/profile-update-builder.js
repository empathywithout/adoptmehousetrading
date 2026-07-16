// POST, Authorization: Bearer <token>
// body: { is_builder, builder_bio, commission_status, portfolio_photos, builder_themes }
// -> { profile }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

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
    return json(401, { error: "Not signed in" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { is_builder, builder_bio, commission_status, portfolio_photos, builder_themes } = body;

  const patch = {};
  if (typeof is_builder === "boolean") patch.is_builder = is_builder;
  if (builder_bio !== undefined) patch.builder_bio = builder_bio ? String(builder_bio).slice(0, 500) : null;
  if (["open", "closed"].includes(commission_status)) patch.commission_status = commission_status;
  if (Array.isArray(portfolio_photos)) patch.portfolio_photos = portfolio_photos.filter((p) => typeof p === "string").slice(0, 20);
  if (Array.isArray(builder_themes)) patch.builder_themes = builder_themes.filter((t) => VALID_THEMES.includes(t));

  const db = supabaseAdmin();
  const { data, error } = await db.from("profiles").update(patch).eq("id", profile.id).select().single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't update builder settings" });
  }

  return json(200, {
    profile: {
      id: data.id,
      rbx_username: data.rbx_username,
      rbx_avatar_url: data.rbx_avatar_url,
      is_builder: data.is_builder,
      builder_bio: data.builder_bio,
      commission_status: data.commission_status,
      portfolio_photos: data.portfolio_photos,
      builder_themes: data.builder_themes,
    },
  });
}

export const handler = safeHandler(handlerImpl);
