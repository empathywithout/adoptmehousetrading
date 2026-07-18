// POST { password, display_name, rbx_username, rbx_user_id, avatar_url, email? }
// -> { token, profile: { id, display_name, rbx_username, rbx_avatar_url } }
//
// Email is optional. If omitted the user is warned they can't reset their password.
// If provided it must be a valid address and is stored for password recovery only
// (never shown publicly).
//
// Login identifier:
//   - With email:    login with email + password
//   - Without email: login with rbx_username + password
//
// Roblox username is still existence-checked via roblox-lookup.js on the client
// before this endpoint is called. rbx_user_id is Roblox's stable numeric ID —
// stored so that if a user later renames their Roblox account we can still
// identify them.

import { supabaseAdmin, newSessionToken, hashToken, newSecretSalt, hashSecret, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const { email, password, display_name, rbx_username, rbx_user_id, avatar_url } = body;

  // Password
  if (!password || String(password).length < 8) {
    return json(400, { error: "Password must be at least 8 characters" });
  }

  // Display name
  const cleanDisplayName = String(display_name || "").trim();
  if (cleanDisplayName.length < 2 || cleanDisplayName.length > 24) {
    return json(400, { error: "Display name must be 2–24 characters" });
  }

  // Roblox username + user ID always required
  if (!rbx_username || !rbx_user_id) {
    return json(400, { error: "Missing rbx_username or rbx_user_id — look up the username first" });
  }

  // Email: optional but must be valid if provided
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json(400, { error: "Enter a valid email address" });
  }

  const db = supabaseAdmin();

  // Uniqueness checks — run in parallel
  const [emailCheck, nameCheck, rbxCheck] = await Promise.all([
    cleanEmail
      ? db.from("profiles").select("id").eq("email", cleanEmail).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("profiles").select("id").eq("display_name", cleanDisplayName).maybeSingle(),
    db.from("profiles").select("id").eq("rbx_username", rbx_username).maybeSingle(),
  ]);

  if (emailCheck.data) {
    return json(409, { error: "An account with that email already exists — try logging in instead" });
  }
  if (nameCheck.data) {
    return json(409, { error: "That display name is taken — try another" });
  }
  if (rbxCheck.data) {
    return json(409, { error: "That Roblox username is already linked to an account — try logging in instead" });
  }

  const salt = newSecretSalt();
  const { data: profile, error } = await db
    .from("profiles")
    .insert({
      email: cleanEmail,          // null if not provided — column is now nullable
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
    console.error("auth-signup error:", error);
    return json(500, { error: "Couldn't create account" });
  }

  const token = newSessionToken();
  const { error: sessionErr } = await db.from("sessions").insert({
    profile_id: profile.id,
    token_hash: hashToken(token),
  });
  if (sessionErr) {
    console.error("auth-signup session error:", sessionErr);
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
