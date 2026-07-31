// GET ?category=build_guide
// -> { submissions: [...] } — approved only, with author display_name attached

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import { withCache } from "./_lib/cache.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const cacheKey = (e) => `content:list:${new URLSearchParams(e.queryStringParameters || {}).toString()}`;
  return withCache(cacheKey, 300, fetchContent, event);
}

async function fetchContent(event) {
  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("content_submissions")
    .select("id, category, title, cover_photo, created_at, published_at, profile_id")
    .eq("status", "approved")
    .order("published_at", { ascending: false });

  if (params.category) query = query.eq("category", params.category);

  const { data, error } = await query;
  if (error) { console.error(error); return json(500, { error: "Couldn't load guides" }); }
  if (!data?.length) return json(200, { submissions: [] });

  // Fetch profiles separately
  const profileIds = [...new Set(data.map(s => s.profile_id))];
  const { data: profiles } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", profileIds);

  const profileMap = {};
  for (const p of profiles || []) profileMap[p.id] = p;

  const submissions = data.map(s => ({
    ...s,
    profiles: profileMap[s.profile_id] || null,
  }));

  return json(200, { submissions });
}

export const handler = safeHandler(handlerImpl);
