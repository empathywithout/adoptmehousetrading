// POST, Authorization: Bearer <token>
// body: { category, item_id, variant, potion, value_amount, value_unit }
// -> { item_value }
//
// Only Data Team members can call this. Tracked with source='data_team' —
// deliberately never merged into the 'verified' rows derived from actual
// two-sided-confirmed trades, so the trust levels stay visually distinct
// rather than blended into one falsely-precise number.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }
  if (!profile.is_data_team_member) {
    return json(403, { error: "Data Team members only" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { category, item_id, variant, potion, value_amount, value_unit } = body;

  if (!category || !item_id || !["shark", "frost"].includes(value_unit)) {
    return json(400, { error: "category, item_id, and a valid value_unit are required" });
  }
  const amount = Number(value_amount);
  if (!amount || amount <= 0) {
    return json(400, { error: "A positive value_amount is required" });
  }

  const cleanVariant = category === "adopt_me_pets" && ["regular", "neon", "mega_neon"].includes(variant) ? variant : null;
  const cleanPotion = category === "adopt_me_pets" && ["none", "ride", "fly", "fly_ride"].includes(potion) ? potion : null;

  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("item_values")
    .select("*")
    .eq("category", category)
    .eq("item_id", item_id)
    .is("variant", cleanVariant)
    .is("potion", cleanPotion)
    .eq("value_unit", value_unit)
    .eq("source", "data_team")
    .maybeSingle();

  let result;
  if (existing) {
    const { data, error } = await db
      .from("item_values")
      .update({
        value_low: Math.min(existing.value_low, amount),
        value_high: Math.max(existing.value_high, amount),
        sample_size: existing.sample_size + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't record submission" });
    }
    result = data;
  } else {
    const { data, error } = await db
      .from("item_values")
      .insert({
        category,
        item_id,
        variant: cleanVariant,
        potion: cleanPotion,
        value_unit,
        source: "data_team",
        value_low: amount,
        value_high: amount,
        sample_size: 1,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't record submission" });
    }
    result = data;
  }

  return json(200, { item_value: result });
}

export const handler = safeHandler(handlerImpl);
