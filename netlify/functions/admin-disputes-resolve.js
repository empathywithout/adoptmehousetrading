// POST, header X-Admin-Password: <ADMIN_PASSWORD>
// body: { dispute_id, ruling: "upheld" | "rejected" }
// -> { dispute, entry }
//
// "upheld" means the dispute was right (the entry is a clone/misattributed)
// -> build_registry.status becomes confirmed_clone.
// "rejected" means the original entry's claim stands
// -> build_registry.status becomes confirmed_original.
// Updates both rows together so they can't drift out of sync, which was
// the actual problem with resolving this by hand in two separate places.

import { supabaseAdmin, requireAdmin, notify, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { dispute_id, ruling } = body;
  if (!dispute_id || !["upheld", "rejected"].includes(ruling)) {
    return json(400, { error: "dispute_id and a valid ruling are required" });
  }

  const db = supabaseAdmin();

  const { data: dispute } = await db.from("build_registry_disputes").select("*").eq("id", dispute_id).maybeSingle();
  if (!dispute) {
    return json(404, { error: "Dispute not found" });
  }
  if (dispute.status !== "pending") {
    return json(400, { error: "This dispute has already been resolved" });
  }

  const { data: updatedDispute, error: disputeErr } = await db
    .from("build_registry_disputes")
    .update({ status: ruling, resolved_at: new Date().toISOString() })
    .eq("id", dispute_id)
    .select()
    .single();

  if (disputeErr) {
    console.error(disputeErr);
    return json(500, { error: "Couldn't update dispute" });
  }

  const newEntryStatus = ruling === "upheld" ? "confirmed_clone" : "confirmed_original";
  const { data: updatedEntry, error: entryErr } = await db
    .from("build_registry")
    .update({ status: newEntryStatus })
    .eq("id", dispute.build_registry_id)
    .select()
    .single();

  if (entryErr) {
    console.error(entryErr);
    return json(500, { error: "Dispute resolved, but couldn't update the registry entry's status" });
  }

  const rulingText = ruling === "upheld" ? "confirmed as a clone" : "confirmed as original";
  await notify(db, updatedEntry.profile_id, "dispute_resolved", `The dispute on your build "${updatedEntry.title}" was resolved — ${rulingText}`, `registry/entry.html?id=${updatedEntry.id}`);
  await notify(db, dispute.disputer_profile_id, "dispute_resolved", `Your dispute on "${updatedEntry.title}" was ${ruling === "upheld" ? "upheld" : "rejected"}`, `registry/entry.html?id=${updatedEntry.id}`);

  return json(200, { dispute: updatedDispute, entry: updatedEntry });
}

export const handler = safeHandler(handlerImpl);
