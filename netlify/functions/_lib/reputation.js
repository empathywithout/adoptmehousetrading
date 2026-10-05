// Reputation: what a person has actually done on the site.
//
// Confirming a trade, getting a build hearted and finishing a commission all
// used to cost effort and show nothing in return, which is a large part of
// why so few people bothered. These numbers are the payback, and they appear
// on every card so the effort is visible to the person who made it.
//
// Computed as ONE site-wide map rather than per profile, for two reasons.
// Cards show many people at once, so per-profile lookups would mean dozens of
// round trips per page. And Neon bills compute by time awake, so a handful of
// queries every few minutes is far cheaper than a trickle of small ones.
//
// The map is deliberately sparse: profiles with nothing to show are omitted
// entirely, which keeps the payload small and means "no entry" renders as no
// badge rather than a row of zeros.

import { kvGet, kvSet } from "./cache.js";
import { isTestDisplayName } from "./testdata.js";

const CACHE_KEY = "rep:map:v1";
const CACHE_TTL = 300;

// Builds that count toward a builder's standing. A build confirmed to be a
// clone of someone else's, or currently disputed, does not.
const COUNTED_BUILD_STATUSES = new Set(["active", "confirmed_original"]);

function bump(map, profileId, key, by = 1) {
  if (!profileId || !by) return;
  const row = (map[profileId] ||= { t: 0, h: 0, b: 0, c: 0 });
  row[key] += by;
}

// { profileId: { t: verified trades, h: hearts received,
//                b: builds registered, c: commissions completed } }
export async function computeReputationMap(db) {
  const map = {};

  // ── Verified trades ───────────────────────────────────────────────────
  // Both sides of a corroborated trade earn it. Note this cannot be done as
  // a filtered join: the query builder renders .eq("listings.profile_id", x)
  // as a column named "listings.profile_id", which does not exist. That is
  // exactly the bug that made player-get report 0 trades for everyone.
  const { data: trades, error: tradesErr } = await db
    .from("completed_trades")
    .select("listing_id, offer_id")
    .eq("status", "corroborated")
    .limit(5000);
  if (tradesErr) throw tradesErr;

  if (trades?.length) {
    const listingIds = [...new Set(trades.map((t) => t.listing_id).filter(Boolean))];
    const offerIds = [...new Set(trades.map((t) => t.offer_id).filter(Boolean))];

    const [{ data: listings }, { data: offers }] = await Promise.all([
      listingIds.length
        ? db.from("listings").select("id, profile_id").in("id", listingIds)
        : Promise.resolve({ data: [] }),
      offerIds.length
        ? db.from("offers").select("id, offering_profile_id").in("id", offerIds)
        : Promise.resolve({ data: [] }),
    ]);

    const listerOf = {};
    for (const l of listings || []) listerOf[l.id] = l.profile_id;
    const offererOf = {};
    for (const o of offers || []) offererOf[o.id] = o.offering_profile_id;

    for (const t of trades) {
      bump(map, listerOf[t.listing_id], "t");
      bump(map, offererOf[t.offer_id], "t");
    }
  }

  // ── Builds registered, and hearts on them ─────────────────────────────
  const { data: builds, error: buildsErr } = await db
    .from("build_registry")
    .select("profile_id, save_count, status")
    .neq("status", "removed")
    .limit(5000);
  if (buildsErr) throw buildsErr;

  for (const b of builds || []) {
    if (!COUNTED_BUILD_STATUSES.has(b.status)) continue;
    bump(map, b.profile_id, "b");
    bump(map, b.profile_id, "h", b.save_count || 0);
  }

  // ── Commissions completed ─────────────────────────────────────────────
  // 'verified' means both the builder and the requester confirmed it, the
  // same two-sided rule as trades. Both earn it.
  const { data: commissions, error: commErr } = await db
    .from("commission_requests")
    .select("builder_profile_id, requester_profile_id")
    .eq("status", "verified")
    .limit(5000);
  if (commErr) throw commErr;

  for (const c of commissions || []) {
    bump(map, c.builder_profile_id, "c");
    bump(map, c.requester_profile_id, "c");
  }

  // Drop anyone with nothing to show.
  for (const [id, row] of Object.entries(map)) {
    if (!row.t && !row.h && !row.b && !row.c) delete map[id];
  }

  // Drop the stress/smoke test accounts. Their trades were being counted,
  // which is why the site-wide total read 56 when there are 27 real trades.
  const ids = Object.keys(map);
  if (ids.length) {
    const { data: named } = await db
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    for (const p of named || []) {
      if (isTestDisplayName(p.display_name)) delete map[p.id];
    }
  }

  return map;
}

// Cached read. Returns {} rather than throwing if the database is briefly
// unavailable — reputation is decoration on a card, never a blocker.
export async function getReputationMap(db) {
  const cached = await kvGet(CACHE_KEY);
  if (cached) return cached;
  try {
    const map = await computeReputationMap(db);
    await kvSet(CACHE_KEY, map, CACHE_TTL);
    return map;
  } catch (err) {
    console.error("[reputation] compute failed:", err.message || err);
    return {};
  }
}

export async function getReputationFor(db, profileId) {
  if (!profileId) return null;
  const map = await getReputationMap(db);
  return map[profileId] || null;
}
