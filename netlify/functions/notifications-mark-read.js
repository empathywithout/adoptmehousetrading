// POST, Authorization: Bearer <token>
// body: { notification_id } or { all: true }
// -> { ok: true }

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

  const db = supabaseAdmin();

  if (body.all) {
    const { error } = await db.from("notifications").update({ read: true }).eq("profile_id", profile.id).eq("read", false);
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't mark notifications read" });
    }
    return json(200, { ok: true });
  }

  if (!body.notification_id) {
    return json(400, { error: "notification_id or all is required" });
  }

  const { error } = await db
    .from("notifications")
    .update({ read: true })
    .eq("id", body.notification_id)
    .eq("profile_id", profile.id);

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't mark notification read" });
  }

  return json(200, { ok: true });
}

export const handler = safeHandler(handlerImpl);
