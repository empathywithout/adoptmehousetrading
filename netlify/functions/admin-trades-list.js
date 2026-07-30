// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { trades: [...] } — all accepted offers with offer items and confirmation status

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Incorrect admin password" });

  const db = supabaseAdmin();

  // Get all accepted offers
  const { data: offers, error } = await db
    .from("offers")
    .select("id, created_at, items, offering_profile_id, listing_id")
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load trades" });
  }

  if (!offers || offers.length === 0) return json(200, { trades: [] });

  // Fetch listings
  const listingIds = [...new Set(offers.map(o => o.listing_id))];
  const { data: listings } = await db
    .from("listings")
    .select("id, title, house_id, value_amount, value_unit, profile_id")
    .in("id", listingIds);

  const listingMap = {};
  for (const l of listings || []) listingMap[l.id] = l;

  // Fetch all relevant profiles (listers + offerers)
  const listerIds = [...new Set((listings || []).map(l => l.profile_id))];
  const offererIds = [...new Set(offers.map(o => o.offering_profile_id))];
  const allProfileIds = [...new Set([...listerIds, ...offererIds])];

  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", allProfileIds);

  const profileMap = {};
  for (const p of profiles || []) profileMap[p.id] = p;

  // Fetch confirmations
  const offerIds = offers.map(o => o.id);
  const { data: confirmations } = await db
    .from("completed_trades")
    .select("offer_id, status, lister_confirmed, offerer_confirmed")
    .in("offer_id", offerIds);

  const confirmMap = {};
  for (const c of confirmations || []) confirmMap[c.offer_id] = c;

  const trades = offers.map(o => {
    const listing = listingMap[o.listing_id] || {};
    return {
      offer_id: o.id,
      created_at: o.created_at,
      listing_id: o.listing_id,
      listing_title: listing.title || "Unknown",
      house_id: listing.house_id || null,
      value_amount: listing.value_amount || null,
      value_unit: listing.value_unit || null,
      lister: profileMap[listing.profile_id]?.display_name || "Unknown",
      offerer: profileMap[o.offering_profile_id]?.display_name || "Unknown",
      items: o.items || [],
      confirmation: confirmMap[o.id] || null,
    };
  });

  return json(200, { trades });
}

export const handler = safeHandler(handlerImpl);
