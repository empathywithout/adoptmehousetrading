// POST { identifier, password }
// identifier: email address OR Roblox username
// -> { token, profile: { id, display_name, rbx_username, rbx_avatar_url } }
//
// Disambiguation: if identifier contains '@' → email lookup (existing users unaffected)
//                 otherwise              → rbx_username lookup (new no-email users)
//
// Deliberately the same error message for "not found" and "wrong password" —
// distinguishing them tells an attacker which accounts exist.
//
// BACKWARD COMPAT: also accepts { email, password } from old clients
// (the frontend sends { identifier } now, but any cached/bookmarked forms
// sending { email } still work since email always contains '@').

import { supabaseAdmin, newSessionToken, hashToken, verifySecret, json, safeHandler } from "./_lib/supabase.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  // Accept both { identifier } (new) and { email } (legacy)
  const identifier = String(body.identifier || body.email || "").trim();
  const { password } = body;

  if (!identifier || !password) {
    return json(400, { error: "Username/email and password are required" });
  }

  const db = supabaseAdmin();
  const isEmail = identifier.includes("@");

  // Look up by email or rbx_username depending on identifier format
  const { data: profile } = isEmail
    ? await db.from("profiles").select("*").eq("email", identifier.toLowerCase()).maybeSingle()
    : await db.from("profiles").select("*").eq("rbx_username", identifier).maybeSingle();

  // Same error for "not found" and "wrong password" — security by ambiguity
  if (!profile || !verifySecret(password, profile.password_salt, profile.password_hash)) {
    return json(401, { error: "Incorrect username/email or password" });
  }

  const token = newSessionToken();
  const { error: sessionErr } = await db.from("sessions").insert({
    profile_id: profile.id,
    token_hash: hashToken(token),
  });
  if (sessionErr) {
    console.error("auth-login session error:", sessionErr);
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
