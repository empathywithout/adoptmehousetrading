// GET ?id=<entry_id>
// -> { entry, possible_duplicate: {...} | null, dispute_count }

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return json(400, { error: "Missing id" });
  }

  const db = supabaseAdmin();

  const { data: entry, error } = await db
    .from("build_registry")
    .select("*, profiles(display_name, rbx_avatar_url)")
    .eq("id", id)
    .maybeSingle();

  if (error || !entry) {
    return json(404, { error: "Build not found" });
  }

  let possibleDuplicate = null;
  if (entry.possible_duplicate_of) {
    const { data } = await db
      .from("build_registry")
      .select("id, title, created_at, profiles(display_name)")
      .eq("id", entry.possible_duplicate_of)
      .maybeSingle();
    possibleDuplicate = data || null;
  }

  const { count } = await db
    .from("build_registry_disputes")
    .select("id", { count: "exact", head: true })
    .eq("build_registry_id", id);

  return json(200, { entry, possible_duplicate: possibleDuplicate, dispute_count: count || 0 });
}

export const handler = safeHandler(handlerImpl);
