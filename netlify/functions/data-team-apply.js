// POST, Authorization: Bearer <token>
// body: { message }
// -> { application }

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

  const { message } = body;
  if (!message?.trim()) {
    return json(400, { error: "Tell us why you'd be a good fit" });
  }

  const db = supabaseAdmin();

  if (profile.is_data_team_member) {
    return json(400, { error: "You're already on the Data Team" });
  }

  const { data: existing } = await db
    .from("data_team_applications")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    return json(400, { error: "You already have a pending application" });
  }

  const { data, error } = await db
    .from("data_team_applications")
    .insert({ profile_id: profile.id, message: String(message).slice(0, 1000) })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit application" });
  }

  return json(200, { application: data });
}

export const handler = safeHandler(handlerImpl);
