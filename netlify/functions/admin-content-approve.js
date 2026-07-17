// POST, header X-Admin-Password: <ADMIN_PASSWORD>
// body: { submission_id, decision: "approved" | "rejected" }
// -> { submission }

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

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

  const { submission_id, decision } = body;
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

  return json(200, { submission: data });
}

export const handler = safeHandler(handlerImpl);
