// GET, Authorization: Bearer <token>
// -> { saved_ids: [listing_id, ...], listings: [...] }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("listing_saves")
    .select("listing_id, listings(id, title, house_id, photos, value_amount, value_unit, status, listing_type, themes)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  if (error) return json(500, { error: "Couldn't load saved listings" });

  const saved_ids = (data || []).map(r => r.listing_id);
  const listings = (data || []).map(r => r.listings).filter(Boolean).filter(l => l.status !== "removed");

  return json(200, { saved_ids, listings });
}

export const handler = safeHandler(handlerImpl);
