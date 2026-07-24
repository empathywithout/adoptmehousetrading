// GET ?category=build_guide
// -> { submissions: [...] } — approved only, with author display_name attached

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import { withCache } from "./_lib/cache.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const cacheKey = (e) => `content:list:${new URLSearchParams(e.queryStringParameters || {}).toString()}`;
  return withCache(cacheKey, 300, fetchContent, event);
}

async function fetchContent(event) {
  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("content_submissions")
    .select("id, category, title, photos, created_at, published_at, profiles(display_name)")
    .eq("status", "approved")
    .order("published_at", { ascending: false });

  if (params.category) {
    query = query.eq("category", params.category);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load guides" });
  }

  return json(200, { submissions: data });
}

export const handler = safeHandler(handlerImpl);
