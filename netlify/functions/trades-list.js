// GET ?house_id=
// -> { trades: [...] } — corroborated trades only, newest first

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const db = supabaseAdmin();
  const houseId = event.queryStringParameters?.house_id;

  // Fetch corroborated trades
  const { data: trades, error } = await db
    .from("completed_trades")
    .select("id, created_at, listing_id, offer_id, status")
    .eq("status", "corroborated")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) { console.error(error); return json(500, { error: "Couldn't load trades" }); }
  if (!trades?.length) return json(200, { trades: [] });

  // Fetch listings
  const listingIds = [...new Set(trades.map(t => t.listing_id))];
  const { data: listings } = await db
    .from("listings")
    .select("id, house_id, title, value_amount, value_unit, is_cloned, profile_id")
    .in("id", listingIds);

  const listingMap = {};
  for (const l of listings || []) listingMap[l.id] = l;

  // Filter by house_id if provided
  const filtered = houseId
    ? trades.filter(t => listingMap[t.listing_id]?.house_id === houseId)
    : trades;

  if (!filtered.length) return json(200, { trades: [] });

  // Fetch offers
  const offerIds = [...new Set(filtered.map(t => t.offer_id))];
  const { data: offers } = await db
    .from("offers")
    .select("id, items, offering_profile_id")
    .in("id", offerIds);

  const offerMap = {};
  for (const o of offers || []) offerMap[o.id] = o;

  // Fetch all profiles
  const listerIds = [...new Set(Object.values(listingMap).map(l => l.profile_id))];
  const offererIds = [...new Set((offers || []).map(o => o.offering_profile_id))];
  const allProfileIds = [...new Set([...listerIds, ...offererIds])];

  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name, rbx_avatar_url")
    .in("id", allProfileIds);

  const profileMap = {};
  for (const p of profiles || []) profileMap[p.id] = p;

  const result = filtered.map(t => {
    const listing = listingMap[t.listing_id] || {};
    const offer = offerMap[t.offer_id] || {};
    return {
      id: t.id,
      created_at: t.created_at,
      listing_id: t.listing_id,
      listings: {
        ...listing,
        profiles: profileMap[listing.profile_id] || null,
      },
      offers: {
        ...offer,
        profiles: profileMap[offer.offering_profile_id] || null,
      },
    };
  });

  return json(200, { trades: result });
}

export const handler = safeHandler(handlerImpl);
