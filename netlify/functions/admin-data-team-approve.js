// POST, header X-Admin-Password: <ADMIN_PASSWORD>
// body: { application_id, decision: "approved" | "rejected" }
// -> { application }

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

  const { application_id, decision } = body;
  if (!application_id || !["approved", "rejected"].includes(decision)) {
    return json(400, { error: "application_id and a valid decision are required" });
  }

  const db = supabaseAdmin();

  const { data: application } = await db.from("data_team_applications").select("*").eq("id", application_id).maybeSingle();
  if (!application || application.status !== "pending") {
    return json(400, { error: "This application isn't pending" });
  }

  const { data: updated, error } = await db
    .from("data_team_applications")
    .update({ status: decision, reviewed_at: new Date().toISOString() })
    .eq("id", application_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't update application" });
  }

  if (decision === "approved") {
    await db.from("profiles").update({ is_data_team_member: true }).eq("id", application.profile_id);
  }

  return json(200, { application: updated });
}

export const handler = safeHandler(handlerImpl);
