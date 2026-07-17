// GET, Authorization: Bearer <token>
// -> { saved_ids: string[] }
//
// Returns the list of build_registry_ids the current user has saved.
// Used by the browse page to render the correct save button state
// without leaking who saved what publicly.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("registry_saves")
    .select("build_registry_id")
    .eq("profile_id", profile.id);

  if (error) {
    console.error("registry-saves-me error:", JSON.stringify(error));
    return json(500, { error: "Couldn't load saves" });
  }

  return json(200, { saved_ids: (data || []).map((r) => r.build_registry_id) });
}

export const handler = safeHandler(handlerImpl);
