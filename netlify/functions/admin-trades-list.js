// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { trades: [...] } — all accepted offers with offer items and confirmation status

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Incorrect admin password" });

  const db = supabaseAdmin();

  // Get all accepted offers with listing + profile info
  const { data: offers, error } = await db
    .from("offers")
    .select("id, created_at, items, offering_profile_id, listing_id, listings(id, title, house_id, value_amount, value_unit, profile_id, profiles(display_name)), profiles(display_name)")
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load trades" });
  }

  // Get all completed_trades to show confirmation status
  const { data: confirmations } = await db
    .from("completed_trades")
    .select("offer_id, status, lister_confirmed, offerer_confirmed");

  const confirmMap = {};
  for (const c of confirmations || []) {
    confirmMap[c.offer_id] = c;
  }

  const trades = (offers || []).map(o => ({
    offer_id: o.id,
    created_at: o.created_at,
    listing_id: o.listing_id,
    listing_title: o.listings?.title || "Unknown",
    house_id: o.listings?.house_id || null,
    value_amount: o.listings?.value_amount || null,
    value_unit: o.listings?.value_unit || null,
    lister: o.listings?.profiles?.display_name || "Unknown",
    offerer: o.profiles?.display_name || "Unknown",
    items: o.items || [],
    confirmation: confirmMap[o.id] || null,
  }));

  return json(200, { trades });
}

export const handler = safeHandler(handlerImpl);
