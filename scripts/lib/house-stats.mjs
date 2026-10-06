// This site's own data, per house type, read straight from Postgres at build
// time so the generated house pages carry it as real HTML.
//
// Why build-time and not a function: the house pages are already static and
// already indexed, and a crawler hitting 54 generated files costs nothing.
// Rendering them on request would wake Neon compute on every crawl, which is
// now billed per CU-hour. The cost of that choice is staleness, bounded by
// how often the site rebuilds.
//
// This never throws. A build must not fail because the database was asleep,
// unreachable, or simply not configured (there is no DATABASE_URL in a plain
// local checkout). Every failure path returns an empty map and the house
// pages render exactly as they did before, just without the extra section.

import { isTestRow } from "../../netlify/functions/_lib/testdata.js";

const MAX_TRADES_PER_HOUSE = 6;
const MAX_LISTINGS_PER_HOUSE = 6;

export function emptyStats() {
  return { byHouse: {}, ok: false, reason: "not loaded" };
}

export async function loadHouseStats() {
  if (!process.env.DATABASE_URL) {
    console.log("[house-stats] no DATABASE_URL — generating house pages without site data");
    return { ...emptyStats(), reason: "no DATABASE_URL" };
  }

  let db;
  try {
    const { supabaseAdmin } = await import("../../netlify/functions/_lib/supabase.js");
    db = supabaseAdmin();
  } catch (err) {
    console.warn("[house-stats] could not open a database connection:", err.message);
    return { ...emptyStats(), reason: "connect failed" };
  }

  try {
    const [tradesRes, listingsRes] = await Promise.all([
      db.from("completed_trades")
        .select("id, created_at, listing_id, offer_id, status")
        .eq("status", "corroborated")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("listings")
        .select("id, house_id, title, value_amount, value_unit, status, profile_id, photos, updated_at, build_type")
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(3000),
    ]);

    if (tradesRes.error || listingsRes.error) {
      console.warn("[house-stats] query failed:", JSON.stringify(tradesRes.error || listingsRes.error));
      return { ...emptyStats(), reason: "query failed" };
    }

    const activeListings = listingsRes.data || [];
    const trades = tradesRes.data || [];

    // Trades reference listings that may no longer be active, so those rows
    // have to be fetched by id rather than reused from the active set.
    const tradeListingIds = [...new Set(trades.map((t) => t.listing_id).filter(Boolean))];
    const { data: tradeListings } = tradeListingIds.length
      ? await db.from("listings").select("id, house_id, title, value_amount, value_unit, profile_id").in("id", tradeListingIds)
      : { data: [] };

    const profileIds = [...new Set([
      ...activeListings.map((l) => l.profile_id),
      ...(tradeListings || []).map((l) => l.profile_id),
    ].filter(Boolean))];

    const { data: profiles } = profileIds.length
      ? await db.from("profiles").select("id, display_name").in("id", profileIds)
      : { data: [] };

    const nameOf = {};
    for (const p of profiles || []) nameOf[p.id] = p.display_name;

    const listingById = {};
    for (const l of tradeListings || []) listingById[l.id] = l;

    const byHouse = {};
    const bucket = (houseId) => (byHouse[houseId] ||= { trades: [], listings: [], tradeCount: 0, listingCount: 0 });

    // Verified trades. This is the content nobody else has: what a house
    // actually changed hands for, confirmed by both sides.
    for (const t of trades) {
      const l = listingById[t.listing_id];
      if (!l?.house_id) continue;
      if (isTestRow({ title: l.title, names: [nameOf[l.profile_id]] })) continue;
      const b = bucket(l.house_id);
      b.tradeCount++;
      if (b.trades.length < MAX_TRADES_PER_HOUSE) {
        b.trades.push({
          id: t.id,
          at: t.created_at,
          title: l.title,
          value: l.value_amount ?? null,
          unit: l.value_unit || null,
          lister: nameOf[l.profile_id] || null,
        });
      }
    }

    for (const l of activeListings) {
      if (!l.house_id) continue;
      if (isTestRow({ title: l.title, names: [nameOf[l.profile_id]] })) continue;
      const b = bucket(l.house_id);
      b.listingCount++;
      if (b.listings.length < MAX_LISTINGS_PER_HOUSE) {
        b.listings.push({
          id: l.id,
          title: l.title,
          value: l.value_amount ?? null,
          unit: l.value_unit || null,
          lister: nameOf[l.profile_id] || null,
          photo: Array.isArray(l.photos) ? l.photos[0] || null : null,
          buildType: l.build_type || null,
        });
      }
    }

    const houses = Object.keys(byHouse).length;
    console.log(`[house-stats] loaded data for ${houses} house type(s): ${trades.length} trade(s), ${activeListings.length} active listing(s)`);
    return { byHouse, ok: true, reason: null };
  } catch (err) {
    console.warn("[house-stats] unexpected failure, continuing without site data:", err.message);
    return { ...emptyStats(), reason: "exception" };
  } finally {
    try { await db?.end?.(); } catch {}
  }
}
