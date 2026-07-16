// POST { email, password, display_name, rbx_username, rbx_user_id, avatar_url }
// -> { token, profile: { id, display_name, rbx_username, rbx_avatar_url } }
//
// Email/password is a real account, hashed the same way the PIN it
// replaces was. Roblox username is still just existence-checked via
// roblox-lookup.js on the client first (not OAuth-verified ownership —
// that's a separate, bigger thing) but is now PRIVATE: display_name is
// what shows up everywhere public. The real rbx_username is only ever
// revealed to a specific counterparty once a trade/commission with them
// is accepted (see listings-get.js and profile-dashboard.js).

import { supabaseAdmin, newSessionToken, hashToken, newSecretSalt, hashSecret, json, safeHandler } from "./_lib/supabase.js";

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

  const { email, password, display_name, rbx_username, rbx_user_id, avatar_url } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "Enter a valid email address" });
  }
  if (!password || String(password).length < 8) {
    return json(400, { error: "Password must be at least 8 characters" });
  }
  const cleanDisplayName = String(display_name || "").trim();
  if (cleanDisplayName.length < 2 || cleanDisplayName.length > 24) {
    return json(400, { error: "Display name must be 2-24 characters" });
  }
  if (!rbx_username || !rbx_user_id) {
    return json(400, { error: "Missing rbx_username or rbx_user_id — look up the username first" });
  }

  const db = supabaseAdmin();

  const { data: existingEmail } = await db.from("profiles").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (existingEmail) {
    return json(409, { error: "An account with that email already exists — try logging in instead" });
  }
  const { data: existingName } = await db.from("profiles").select("id").eq("display_name", cleanDisplayName).maybeSingle();
  if (existingName) {
    return json(409, { error: "That display name is taken — try another" });
  }
  const { data: existingRbx } = await db.from("profiles").select("id").eq("rbx_username", rbx_username).maybeSingle();
  if (existingRbx) {
    return json(409, { error: "That Roblox username is already linked to an account" });
  }

  const salt = newSecretSalt();
  const { data: profile, error } = await db
    .from("profiles")
    .insert({
      email: email.toLowerCase(),
      password_hash: hashSecret(password, salt),
      password_salt: salt,
      display_name: cleanDisplayName,
      rbx_username,
      rbx_user_id,
      rbx_avatar_url: avatar_url || null,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't create account" });
  }

  const token = newSessionToken();
  const { error: sessionErr } = await db.from("sessions").insert({
    profile_id: profile.id,
    token_hash: hashToken(token),
  });
  if (sessionErr) {
    console.error(sessionErr);
    return json(500, { error: "Couldn't start session" });
  }

  return json(200, {
    token,
    profile: {
      id: profile.id,
      display_name: profile.display_name,
      rbx_username: profile.rbx_username,
      rbx_avatar_url: profile.rbx_avatar_url,
    },
  });
}

export const handler = safeHandler(handlerImpl);
