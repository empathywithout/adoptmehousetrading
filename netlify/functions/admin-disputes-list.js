// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { disputes: [...] }
//
// Uses two separate queries instead of one complex embedded join — this table
// has two FKs to build_registry (build_registry_id AND claimed_original_entry_id)
// which causes PostgREST to choke on embedded joins even with FK hints.
// Simpler to fetch disputes first, then enrich with registry/profile data.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  const db = supabaseAdmin();

  // Step 1: fetch pending disputes — no joins, just the raw rows
  const { data: disputes, error: disputesErr } = await db
    .from("build_registry_disputes")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (disputesErr) {
    console.error("disputes query error:", JSON.stringify(disputesErr));
    return json(500, { error: `Couldn't load disputes: ${disputesErr.message || disputesErr.hint || JSON.stringify(disputesErr)}` });
  }

  if (!disputes || disputes.length === 0) {
    return json(200, { disputes: [] });
  }

  // Step 2: collect the IDs we need to look up
  const registryIds = [...new Set([
    ...disputes.map(d => d.build_registry_id),
    ...disputes.map(d => d.claimed_original_entry_id).filter(Boolean),
  ])];
  const profileIds = [...new Set(disputes.map(d => d.disputer_profile_id).filter(Boolean))];

  // Step 3: fetch registry entries and profiles in parallel
  const [{ data: entries }, { data: profiles }] = await Promise.all([
    db.from("build_registry")
      .select("id, title, photos, profile_id, profiles!build_registry_profile_id_fkey(display_name)")
      .in("id", registryIds),
    db.from("profiles")
      .select("id, display_name")
      .in("id", profileIds),
  ]);

  const entryById = Object.fromEntries((entries || []).map(e => [e.id, e]));
  const profileById = Object.fromEntries((profiles || []).map(p => [p.id, p]));

  // Step 4: enrich disputes with the fetched data
  const enriched = disputes.map(d => ({
    ...d,
    build_registry: entryById[d.build_registry_id] || null,
    profiles: profileById[d.disputer_profile_id] || null,
    claimed_original_entry: d.claimed_original_entry_id ? entryById[d.claimed_original_entry_id] || null : null,
  }));

  return json(200, { disputes: enriched });
}

export const handler = safeHandler(handlerImpl);
