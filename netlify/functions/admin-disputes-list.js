// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { disputes: [...] }

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }
  if (!requireAdmin(event)) {
    return json(401, { error: "Incorrect admin password" });
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("build_registry_disputes")
    .select(
      "*, profiles!build_registry_disputes_disputer_profile_id_fkey(display_name), build_registry!build_registry_disputes_build_registry_id_fkey(id, title, photos, profile_id, profiles(display_name))"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load disputes" });
  }

  return json(200, { disputes: data });
}

export const handler = safeHandler(handlerImpl);
