// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { disputes: [...] }
//
// Uses flat queries only — no PostgREST embedded joins at all, because:
// 1. build_registry_disputes has two FKs to build_registry
// 2. build_registry <-> profiles is circular (profiles.featured_registry_entry_id -> build_registry,
//    build_registry.profile_id -> profiles), which PostgREST flags as ambiguous
// Simpler and safer to fetch each table flat and join in JS.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  const db = supabaseAdmin();

  // 1. Fetch disputes — flat, no joins
  const { data: disputes, error: disputesErr } = await db
    .from("build_registry_disputes")
    .select("id, build_registry_id, disputer_profile_id, claim, rebuttal, rebuttal_at, status, created_at, claimed_original_entry_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (disputesErr) {
    console.error("disputes error:", JSON.stringify(disputesErr));
    return json(500, { error: `Couldn't load disputes: ${disputesErr.message}` });
  }

  if (!disputes || disputes.length === 0) {
    return json(200, { disputes: [] });
  }

  // 2. Collect IDs
  const registryIds = [...new Set([
    ...disputes.map(d => d.build_registry_id),
    ...disputes.map(d => d.claimed_original_entry_id).filter(Boolean),
  ])];
  const disputerProfileIds = [...new Set(disputes.map(d => d.disputer_profile_id).filter(Boolean))];

  // 3. Fetch registry entries flat (no nested profiles embed)
  const { data: entries, error: entriesErr } = await db
    .from("build_registry")
    .select("id, title, photos, profile_id")
    .in("id", registryIds);

  if (entriesErr) {
    console.error("entries error:", JSON.stringify(entriesErr));
    return json(500, { error: `Couldn't load registry entries: ${entriesErr.message}` });
  }

  // 4. Collect all profile IDs we need (disputers + builders)
  const builderProfileIds = (entries || []).map(e => e.profile_id).filter(Boolean);
  const allProfileIds = [...new Set([...disputerProfileIds, ...builderProfileIds])];

  // 5. Fetch profiles flat
  const { data: profiles, error: profilesErr } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", allProfileIds);

  if (profilesErr) {
    console.error("profiles error:", JSON.stringify(profilesErr));
    return json(500, { error: `Couldn't load profiles: ${profilesErr.message}` });
  }

  // 6. Build lookup maps and enrich
  const entryById = Object.fromEntries((entries || []).map(e => [e.id, e]));
  const profileById = Object.fromEntries((profiles || []).map(p => [p.id, p]));

  const enriched = disputes.map(d => {
    const entry = entryById[d.build_registry_id] || null;
    return {
      ...d,
      build_registry: entry ? {
        ...entry,
        profiles: entry.profile_id ? profileById[entry.profile_id] || null : null,
      } : null,
      profiles: d.disputer_profile_id ? profileById[d.disputer_profile_id] || null : null,
      claimed_original_entry: d.claimed_original_entry_id
        ? entryById[d.claimed_original_entry_id] || null
        : null,
    };
  });

  return json(200, { disputes: enriched });
}

export const handler = safeHandler(handlerImpl);
