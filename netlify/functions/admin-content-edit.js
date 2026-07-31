// POST, X-Admin-Password header
// body: { id, body?, title?, status? }
// Allows admin to edit guide content and status

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Forbidden" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

  const { id, ...updates } = body;
  if (!id) return json(400, { error: "id required" });

  const allowed = ["body", "title", "status", "category"];
  const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(patch).length) return json(400, { error: "Nothing to update" });

  if (patch.status === "approved") patch.published_at = new Date().toISOString();

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("content_submissions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });
  return json(200, { submission: data });
}

export const handler = safeHandler(handlerImpl);
