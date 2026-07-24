// POST, header X-Admin-Password: <ADMIN_PASSWORD>
// body: { submission_id, decision: "approved" | "rejected" }
// -> { submission }

import { supabaseAdmin, requireAdmin, notify, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";

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

  const { submission_id, decision, edited_body } = body;
  if (!submission_id || !["approved", "rejected"].includes(decision)) {
    return json(400, { error: "submission_id and a valid decision are required" });
  }

  const db = supabaseAdmin();

  const { data: submission } = await db.from("content_submissions").select("*").eq("id", submission_id).maybeSingle();
  if (!submission || submission.status !== "pending") {
    return json(400, { error: "This submission isn't pending" });
  }

  const patch = { status: decision, reviewed_at: new Date().toISOString() };
  if (decision === "approved") {
    patch.published_at = new Date().toISOString();
    if (edited_body && typeof edited_body === "string" && edited_body.trim()) {
      patch.body = edited_body.trim();
    }
  }

  const { data, error } = await db
    .from("content_submissions")
    .update(patch)
    .eq("id", submission_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't update submission" });
  }

  await notify(
    db,
    submission.profile_id,
    decision === "approved" ? "guide_approved" : "guide_rejected",
    decision === "approved" ? `Your guide "${submission.title}" was approved and published!` : `Your guide "${submission.title}" wasn't approved`,
    decision === "approved" ? `guides/entry.html?id=${submission.id}` : "profile.html"
  );

  await invalidate("content:list:");
  return json(200, { submission: data });
}

export const handler = safeHandler(handlerImpl);
