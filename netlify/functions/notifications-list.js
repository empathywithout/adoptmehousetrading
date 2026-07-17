// GET, Authorization: Bearer <token>
// -> { notifications: [...], unread_count }

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("notifications")
    .select("*")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load notifications" });
  }

  const unread_count = (data || []).filter((n) => !n.read).length;

  return json(200, { notifications: data || [], unread_count });
}

export const handler = safeHandler(handlerImpl);
