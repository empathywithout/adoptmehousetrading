// POST, Authorization: Bearer <token>
// body: { is_builder, builder_bio, commission_status, builder_themes, featured_registry_entry_id }
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

  const { is_builder, builder_bio, commission_status, builder_themes, featured_registry_entry_id } = body;

  const patch = {};
  if (typeof is_builder === "boolean") patch.is_builder = is_builder;
  if (builder_bio !== undefined) patch.builder_bio = builder_bio ? String(builder_bio).slice(0, 500) : null;
  if (["open", "closed"].includes(commission_status)) patch.commission_status = commission_status;
  if (Array.isArray(builder_themes)) patch.builder_themes = builder_themes.filter((t) => VALID_THEMES.includes(t));

  const db = supabaseAdmin();

  if (featured_registry_entry_id !== undefined) {
    if (featured_registry_entry_id === null) {
      patch.featured_registry_entry_id = null;
    } else {
      // Must actually be one of this profile's own registered builds —
      // otherwise someone could feature another builder's build as their own.
      const { data: owned } = await db
        .from("build_registry")
        .select("id")
        .eq("id", featured_registry_entry_id)
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (!owned) {
        return json(400, { error: "That build isn't one of yours" });
      }
      patch.featured_registry_entry_id = featured_registry_entry_id;
    }
  }

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
      builder_themes: data.builder_themes,
      featured_registry_entry_id: data.featured_registry_entry_id,
    },
  });
}

export const handler = safeHandler(handlerImpl);
