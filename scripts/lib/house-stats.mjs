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
import { EXPIRE_DAYS } from "../../netlify/functions/_lib/listings.js";

const MAX_TRADES_PER_HOUSE = 6;
const MAX_LISTINGS_PER_HOUSE = 6;
// How many of the newest listings and trades get written into the static
// Browse and Recent Trades pages (see page-snapshots.mjs).
const BROWSE_SNAPSHOT_LISTINGS = 24;
const RECENT_TRADES_SNAPSHOT = 18;
// A range from one or two listings is an anecdote, not a range.
export const MIN_ASKS_FOR_RANGE = 3;

export function emptyStats() {
  return { byHouse: {}, browse: null, recentTrades: [], ok: false, reason: "not loaded" };
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
    // Same visibility rules as listings-list.js, so a crawler is never shown
    // a listing that the live Browse page has already hidden: active rows
    // expire EXPIRE_DAYS after their last create/edit/renewal, and the
    // deprecated 'commission' listing type never shows publicly.
    const expireCutoff = new Date(Date.now() - EXPIRE_DAYS * 86400000).toISOString();

    const [tradesRes, listingsRes] = await Promise.all([
      db.from("completed_trades")
        .select("id, created_at, listing_id, offer_id, status")
        .eq("status", "corroborated")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("listings")
        .select("id, house_id, title, value_amount, value_unit, status, profile_id, photos, updated_at, build_type, listing_type")
        .eq("status", "active")
        .neq("listing_type", "commission")
        .filter("updated_at", ">=", expireCutoff)
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
    const recentTrades = [];
    const browseListings = [];
    const bucket = (houseId) => (byHouse[houseId] ||= { trades: [], listings: [], tradeCount: 0, listingCount: 0, asks: {} });

    // Verified trades. This is the content nobody else has: what a house
    // actually changed hands for, confirmed by both sides.
    for (const t of trades) {
      const l = listingById[t.listing_id];
      if (!l?.house_id) continue;
      if (isTestRow({ title: l.title, names: [nameOf[l.profile_id]] })) continue;
      const b = bucket(l.house_id);
      b.tradeCount++;
      if (recentTrades.length < RECENT_TRADES_SNAPSHOT) {
        recentTrades.push({
          id: t.id,
          at: t.created_at,
          houseId: l.house_id,
          title: l.title,
          value: l.value_amount ?? null,
          unit: l.value_unit || null,
          lister: nameOf[l.profile_id] || null,
        });
      }
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
      // Asking prices, kept per unit. Shark, Frost and Ride Pot are never
      // converted into each other (there is no reliable rate), so each unit
      // gets its own list and its own summary.
      if (l.value_amount !== null && l.value_amount !== undefined && l.value_unit && Number.isFinite(Number(l.value_amount))) {
        (b.asks[l.value_unit] ||= []).push(Number(l.value_amount));
      }
      if (browseListings.length < BROWSE_SNAPSHOT_LISTINGS) {
        browseListings.push({
          id: l.id,
          houseId: l.house_id,
          title: l.title,
          value: l.value_amount ?? null,
          unit: l.value_unit || null,
          lister: nameOf[l.profile_id] || null,
          photo: Array.isArray(l.photos) ? l.photos[0] || null : null,
          buildType: l.build_type || null,
          listingType: l.listing_type || "house_trade",
        });
      }
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
    // Turn the raw asking prices into a small summary per house and unit. Fewer
    // than MIN_ASKS_FOR_RANGE listings is too thin to call a range, so those
    // units are left out and the page just does not show the table.
    for (const d of Object.values(byHouse)) {
      d.askStats = Object.entries(d.asks)
        .filter(([, vals]) => vals.length >= MIN_ASKS_FOR_RANGE)
        .map(([unit, vals]) => {
          const v = [...vals].sort((x, y) => x - y);
          const mid = Math.floor(v.length / 2);
          const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
          return { unit, n: v.length, min: v[0], median, max: v[v.length - 1] };
        })
        .sort((x, y) => y.n - x.n);
      delete d.asks;
    }

    // Per-house counts for the "browse by house" block on the Browse page.
    const houseCounts = Object.entries(byHouse)
      .filter(([, d]) => d.listingCount > 0)
      .map(([id, d]) => ({ id, count: d.listingCount }))
      .sort((a, b) => b.count - a.count);
    const browse = {
      listings: browseListings,
      totalActive: houseCounts.reduce((n, h) => n + h.count, 0),
      houseCounts,
    };

    return { byHouse, browse, recentTrades, ok: true, reason: null };
  } catch (err) {
    console.warn("[house-stats] unexpected failure, continuing without site data:", err.message);
    return { ...emptyStats(), reason: "exception" };
  } finally {
    try { await db?.end?.(); } catch {}
  }
}
