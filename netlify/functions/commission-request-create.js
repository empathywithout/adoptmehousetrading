// POST, Authorization: Bearer <token>
// body: { builder_profile_id, description, themes, offered_items, offered_value_amount, offered_value_unit }
// -> { request }

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
    return json(401, { error: "Create a profile first" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { builder_profile_id, description, themes, offered_items, offered_value_amount, offered_value_unit } = body;

  if (!builder_profile_id || !description?.trim()) {
    return json(400, { error: "builder_profile_id and description are required" });
  }

  if (builder_profile_id === profile.id) {
    return json(400, { error: "You can't request a commission from yourself" });
  }

  const db = supabaseAdmin();

  const { data: builder } = await db
    .from("profiles")
    .select("id, is_builder, commission_status")
    .eq("id", builder_profile_id)
    .maybeSingle();

  if (!builder || !builder.is_builder) {
    return json(404, { error: "Builder not found" });
  }
  if (builder.commission_status !== "open") {
    return json(400, { error: "This builder isn't taking commissions right now" });
  }

  const cleanThemes = Array.isArray(themes) ? themes.filter((t) => VALID_THEMES.includes(t)) : [];
  const cleanItems = Array.isArray(offered_items)
    ? offered_items.slice(0, 20).map((it) => ({
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
  const cleanValueAmount =
    offered_value_amount !== undefined && offered_value_amount !== null && offered_value_amount !== "" && !isNaN(Number(offered_value_amount))
      ? Number(offered_value_amount)
      : null;
  const cleanValueUnit = ["shark", "frost", "rp"].includes(offered_value_unit) ? offered_value_unit : null;

  const { data, error } = await db
    .from("commission_requests")
    .insert({
      builder_profile_id,
      requester_profile_id: profile.id,
      description: String(description).slice(0, 2000),
      themes: cleanThemes,
      offered_items: cleanItems,
      offered_value_amount: cleanValueAmount,
      offered_value_unit: cleanValueAmount !== null ? cleanValueUnit : null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit request" });
  }

  return json(200, { request: data });
}

export const handler = safeHandler(handlerImpl);
