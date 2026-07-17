// POST, Authorization: Bearer <token>
// body: { build_registry_id, dispute_type, claim, proof_url, claimed_original_entry_id }
// -> { dispute }
//
// dispute_type: 'i_am_original' | 'this_is_speedbuild' | 'this_is_clone' | 'other'
// proof_url: required — external evidence link (YouTube, Streamable, TikTok, Reddit, etc.)
// claim: required freeform explanation (50+ chars)
//
// Filing marks the entry 'disputed' immediately so visitors see it's contested.
// A human reviews via the admin dashboard — nothing resolves automatically.

import { supabaseAdmin, requireProfile, notify, json, safeHandler } from "./_lib/supabase.js";

const VALID_DISPUTE_TYPES = ["i_am_original", "this_is_speedbuild", "this_is_clone", "other"];

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Create a profile first" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { build_registry_id, dispute_type, claim, proof_url, claimed_original_entry_id } = body;

  if (!build_registry_id) return json(400, { error: "build_registry_id is required" });
  if (!VALID_DISPUTE_TYPES.includes(dispute_type)) {
    return json(400, { error: "Select a dispute type" });
  }
  const cleanClaim = String(claim || "").trim();
  if (cleanClaim.length < 50) {
    return json(400, { error: "Explain your claim in at least 50 characters" });
  }
  const cleanProofUrl = String(proof_url || "").trim();
  if (!cleanProofUrl || !/^https?:\/\//.test(cleanProofUrl)) {
    return json(400, { error: "A proof link (YouTube, Streamable, Reddit, etc.) is required" });
  }

  const db = supabaseAdmin();

  const { data: entry } = await db
    .from("build_registry")
    .select("id, title, profile_id")
    .eq("id", build_registry_id)
    .maybeSingle();

  if (!entry) return json(404, { error: "Build not found" });
  if (entry.profile_id === profile.id) return json(400, { error: "You can't dispute your own entry" });

  // One pending dispute per person per entry
  const { data: existing } = await db
    .from("build_registry_disputes")
    .select("id")
    .eq("build_registry_id", build_registry_id)
    .eq("disputer_profile_id", profile.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) return json(400, { error: "You already have a pending dispute on this entry" });

  const { data: dispute, error } = await db
    .from("build_registry_disputes")
    .insert({
      build_registry_id,
      disputer_profile_id: profile.id,
      dispute_type,
      claim: cleanClaim.slice(0, 2000),
      proof_url: cleanProofUrl.slice(0, 500),
      claimed_original_entry_id: claimed_original_entry_id || null,
    })
    .select()
    .single();

  if (error) {
    console.error("dispute-create error:", error);
    return json(500, { error: "Couldn't file dispute" });
  }

  await db.from("build_registry").update({ status: "disputed" }).eq("id", build_registry_id);

  await notify(
    db, entry.profile_id, "dispute_filed",
    `Someone disputed your build "${entry.title}" — you can respond`,
    `registry/entry.html?id=${build_registry_id}`
  );

  return json(200, { dispute });
}

export const handler = safeHandler(handlerImpl);
