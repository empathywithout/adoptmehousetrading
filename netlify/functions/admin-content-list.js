// GET, header X-Admin-Password: <ADMIN_PASSWORD>
// -> { submissions: [...] }

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
    .from("content_submissions")
    .select("*, profiles(display_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("netlify/functions/admin-content-list.js error:", JSON.stringify(error));
    return json(500, { error: `Couldn't load submissions: ${error.message || JSON.stringify(error)}` });
  }

  return json(200, { submissions: data });
}

export const handler = safeHandler(handlerImpl);
