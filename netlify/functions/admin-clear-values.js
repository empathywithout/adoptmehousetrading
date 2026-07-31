// GET /.netlify/functions/admin-clear-values?pw=ADMIN_PASSWORD
// Deletes all computed item values from the DB

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const pw = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams.get("pw");
  const headerPw = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || (pw !== expected && headerPw !== expected)) return json(403, { error: "Forbidden" });

  const db = supabaseAdmin();
  const { error } = await db.from("item_values").delete().eq("source", "computed");
  if (error) return json(500, { error: error.message });

  return json(200, { cleared: true });
}

export const handler = safeHandler(handlerImpl);
