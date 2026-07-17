// POST, Authorization: Bearer <token>
// body: { build_registry_id, claim, claimed_original_entry_id }
// -> { dispute }
//
// Filing a dispute marks the entry 'disputed' immediately (so visitors see
// it's contested) but doesn't resolve anything automatically — a human
// (you, or a trusted reviewer, the same role the community's own mods
// already play running their build contests) reviews the dispute and the
// entry's status separately via the Supabase dashboard for now. No admin
// UI built yet — deliberately deferred until there's real dispute volume
// to justify it.

import { supabaseAdmin, requireProfile, notify, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Create a profile first" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { build_registry_id, claim, claimed_original_entry_id } = body;
  if (!build_registry_id || !claim?.trim()) {
    return json(400, { error: "build_registry_id and a claim/explanation are required" });
  }

  const db = supabaseAdmin();

  const { data: entry } = await db.from("build_registry").select("id, title, profile_id").eq("id", build_registry_id).maybeSingle();
  if (!entry) {
    return json(404, { error: "Build not found" });
  }
  if (entry.profile_id === profile.id) {
    return json(400, { error: "You can't dispute your own entry" });
  }

  const { data: dispute, error } = await db
    .from("build_registry_disputes")
    .insert({
      build_registry_id,
      disputer_profile_id: profile.id,
      claim: String(claim).slice(0, 2000),
      claimed_original_entry_id: claimed_original_entry_id || null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't file dispute" });
  }

  await db.from("build_registry").update({ status: "disputed" }).eq("id", build_registry_id);

  await notify(db, entry.profile_id, "dispute_filed", `Someone disputed your build "${entry.title}" — you can respond`, `registry/entry.html?id=${build_registry_id}`);

  return json(200, { dispute });
}

export const handler = safeHandler(handlerImpl);
