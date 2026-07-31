// GET ?category=<category>&exclude=<id>&limit=3
// Returns approved guides, optionally filtered by category, excluding one id
import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const { category, exclude, limit } = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("content_submissions")
    .select("id, category, title, created_at, published_at, profile_id, profiles(display_name, rbx_avatar_url)")
    .eq("status", "approved")
    .order("published_at", { ascending: false })
    .limit(parseInt(limit) || 6);

  if (category) query = query.eq("category", category);
  if (exclude) query = query.neq("id", exclude);

  const { data, error } = await query;
  if (error) return json(500, { error: error.message });
  return json(200, { guides: data || [] });
}

export const handler = safeHandler(handlerImpl);
