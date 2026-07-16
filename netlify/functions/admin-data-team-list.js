// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { applications: [...] }

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
    .from("data_team_applications")
    .select("*, profiles(display_name, created_at)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load applications" });
  }

  return json(200, { applications: data });
}

export const handler = safeHandler(handlerImpl);
