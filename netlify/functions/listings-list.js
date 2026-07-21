// GET ?house_id=&status=
// -> { listings: [...] } — each with profile.display_name attached

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const params = event.queryStringParameters || {};
  const db = supabaseAdmin();

  let query = db
    .from("listings")
    .select("*, profiles(display_name, rbx_avatar_url)")
    .order("created_at", { ascending: false })
    .limit(100);

  query = query.in("status", params.status ? [params.status] : ["active", "traded"]);

  // The 'commission' listing_type is deprecated (see migration-020) — any
  // legacy rows with that value stay in the database untouched, but never
  // show up in public browse results.
  query = query.neq("listing_type", "commission");

  if (params.house_id) {
    query = query.eq("house_id", params.house_id);
  }

  if (params.listing_type) {
    query = query.eq("listing_type", params.listing_type);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't load listings" });
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      // Cache at the CDN edge for 60s — listings don't need to be real-time.
      // Individual listing pages (listings-get.js) are auth-gated so no cache there.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
    },
    body: JSON.stringify({ listings: data }),
  };
}

export const handler = safeHandler(handlerImpl);
