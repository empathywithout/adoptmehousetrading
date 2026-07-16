// POST { email, password }
// -> { token, profile: { id, display_name, rbx_username, rbx_avatar_url } }

import { supabaseAdmin, newSessionToken, hashToken, verifySecret, json, safeHandler } from "./_lib/supabase.js";

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

  const { email, password } = body;
  if (!email || !password) {
    return json(400, { error: "Email and password are required" });
  }

  const db = supabaseAdmin();
  const { data: profile } = await db.from("profiles").select("*").eq("email", String(email).toLowerCase()).maybeSingle();

  // Deliberately the same error for "no such email" and "wrong password" —
  // distinguishing them tells an attacker which emails have accounts here.
  if (!profile || !verifySecret(password, profile.password_salt, profile.password_hash)) {
    return json(401, { error: "Incorrect email or password" });
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
