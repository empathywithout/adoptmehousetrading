// POST { username }
// -> { token, profile: { id, rbx_username, rbx_user_id, rbx_avatar_url } }
//
// Anyone can create a profile for any real Roblox username (there's no
// verification that you own the account — same trust level as Traderie/AMTV
// profile creation, since the real trade always happens in-game between two
// consenting players). Re-submitting the same username issues a NEW token
// and invalidates the old one, so if someone else "steals" your username's
// profile here, creating it again with your own browser takes it back.

import {  supabaseAdmin, newSessionToken, hashToken, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { rbx_username, rbx_user_id, avatar_url } = body;
  if (!rbx_username || !rbx_user_id) {
    return json(400, { error: "Missing rbx_username or rbx_user_id — look up the username first" });
  }

  const db = supabaseAdmin();
  const token = newSessionToken();

  const { data, error } = await db
    .from("profiles")
    .upsert(
      {
        rbx_username,
        rbx_user_id,
        rbx_avatar_url: avatar_url || null,
        session_token_hash: hashToken(token),
      },
      { onConflict: "rbx_username" }
    )
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't create profile" });
  }

  return json(200, {
    token,
    profile: {
      id: data.id,
      rbx_username: data.rbx_username,
      rbx_user_id: data.rbx_user_id,
      rbx_avatar_url: data.rbx_avatar_url,
    },
  });
}

export const handler = safeHandler(handlerImpl);
