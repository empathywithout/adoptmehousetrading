// POST, Authorization: Bearer <token>
// body: { dispute_id, rebuttal }
// -> { dispute }
//
// One rebuttal per dispute — the accused builder's chance to respond before
// it's resolved. Both the original claim and this rebuttal become visible
// to everyone once the dispute is resolved (see registry-get.js); while
// pending, only the builder being disputed can see the claim at all, so
// this isn't public mudslinging before a ruling.

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

  const { dispute_id, rebuttal } = body;
  if (!dispute_id || !rebuttal?.trim()) {
    return json(400, { error: "dispute_id and a rebuttal are required" });
  }

  const db = supabaseAdmin();

  const { data: dispute } = await db
    .from("build_registry_disputes")
    .select("*, build_registry(profile_id)")
    .eq("id", dispute_id)
    .maybeSingle();

  if (!dispute) {
    return json(404, { error: "Dispute not found" });
  }
  if (dispute.build_registry.profile_id !== profile.id) {
    return json(403, { error: "Only the builder being disputed can respond to this" });
  }
  if (dispute.status !== "pending") {
    return json(400, { error: "This dispute has already been resolved" });
  }
  if (dispute.rebuttal) {
    return json(400, { error: "You've already submitted a rebuttal for this dispute" });
  }

  const { data, error } = await db
    .from("build_registry_disputes")
    .update({ rebuttal: String(rebuttal).slice(0, 2000), rebuttal_at: new Date().toISOString() })
    .eq("id", dispute_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit rebuttal" });
  }

  return json(200, { dispute: data });
}

export const handler = safeHandler(handlerImpl);
