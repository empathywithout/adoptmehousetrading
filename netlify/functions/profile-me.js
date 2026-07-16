// GET, Authorization: Bearer <token>
// -> { profile }

import { requireProfile, json } from "./_lib/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Not signed in" });
  }

  return json(200, {
    profile: {
      id: profile.id,
      rbx_username: profile.rbx_username,
      rbx_user_id: profile.rbx_user_id,
      rbx_avatar_url: profile.rbx_avatar_url,
    },
  });
}
