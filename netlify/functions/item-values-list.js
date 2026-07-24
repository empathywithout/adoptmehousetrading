// GET ?category=adopt_me_pets
// -> { values: [{ item_id, variant, potion, value_unit, value_low, value_high, sample_size }] }
//
// Returns whatever's been computed so far — nothing special needed to
// "activate" this later. It's already live; it just returns an empty array
// until real corroborated single-item trades exist for that category.

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import { withCache } from "./_lib/cache.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const category = event.queryStringParameters?.category;
  if (!category) {
    return json(400, { error: "Missing category" });
  }

  const cacheKey = () => `item-values:${category}`;
  return withCache(cacheKey, 600, fetchValues, event);
}

async function fetchValues(event) {
  const category = event.queryStringParameters?.category;
  const db = supabaseAdmin();
  const { data, error } = await db.from("item_values").select("*").eq("category", category);

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load item values" });
  }

  return json(200, { values: data || [] });
}

export const handler = safeHandler(handlerImpl);
