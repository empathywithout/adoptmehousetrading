// POST, Authorization: Bearer <token>
// body: { entry_id }
// -> { ok: true }
//
// Soft delete (status='removed'), not a hard delete — preserves any
// dispute history and avoids foreign-key issues if another entry
// references this one as a possible_duplicate_of. A removed entry stops
// showing up everywhere (public registry, the builder's own portfolio,
// their public builder page) but the row itself stays intact.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { entry_id } = body;
  if (!entry_id) {
    return json(400, { error: "entry_id is required" });
  }

  const db = supabaseAdmin();

  const { data: entry } = await db.from("build_registry").select("id, profile_id, status").eq("id", entry_id).maybeSingle();
  if (!entry) {
    return json(404, { error: "Build not found" });
  }
  if (entry.profile_id !== profile.id) {
    return json(403, { error: "Only the person who registered this build can remove it" });
  }
  if (entry.status === "removed") {
    return json(400, { error: "Already removed" });
  }

  const { error } = await db.from("build_registry").update({ status: "removed" }).eq("id", entry_id);
  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't remove this build" });
  }

  return json(200, { ok: true });
}

export const handler = safeHandler(handlerImpl);
