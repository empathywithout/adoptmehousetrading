// POST { token, password }
// -> { token: <session token>, profile }
//
// Exchanges a single-use grant (from the email link or Roblox verification)
// for a new password, then signs the user straight in.
//
// Every existing session for the account is destroyed first. Someone
// resetting a password may be recovering from a compromise, so old tokens
// must stop working.

import {
  supabaseAdmin,
  newSessionToken,
  hashToken,
  newSecretSalt,
  hashSecret,
  json,
  safeHandler,
} from "./_lib/supabase.js";
import { consumeGrant } from "./_lib/reset.js";

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { token, password } = body;
  if (!password || String(password).length < 8) {
    return json(400, { error: "Password must be at least 8 characters" });
  }

  // Consumed here: a replay of the same token fails even if anything below
  // goes wrong.
  const grant = await consumeGrant(token);
  if (!grant?.profile_id) {
    return json(400, {
      error: "That reset link has expired or already been used. Start again.",
      code: "GRANT_INVALID",
    });
  }

  const db = supabaseAdmin();
  const salt = newSecretSalt();

  const { error: updateErr } = await db
    .from("profiles")
    .update({ password_hash: hashSecret(password, salt), password_salt: salt })
    .eq("id", grant.profile_id);

  if (updateErr) {
    console.error("[password-reset-confirm] password update failed:", updateErr);
    return json(503, {
      error: "Can't reach the database right now. Try again in a minute.",
      code: "DB_UNAVAILABLE",
    });
  }

  // Old sessions must not survive a reset.
  const { error: wipeErr } = await db.from("sessions").delete().eq("profile_id", grant.profile_id);
  if (wipeErr) console.error("[password-reset-confirm] couldn't clear old sessions:", wipeErr);

  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, rbx_username, rbx_avatar_url")
    .eq("id", grant.profile_id)
    .maybeSingle();

  const sessionToken = newSessionToken();
  const { error: sessionErr } = await db
    .from("sessions")
    .insert({ profile_id: grant.profile_id, token_hash: hashToken(sessionToken) });

  if (sessionErr) {
    // The password did change, so say so rather than implying it failed.
    console.error("[password-reset-confirm] couldn't start session:", sessionErr);
    return json(200, {
      password_changed: true,
      error: "Your password is updated. Sign in with it now.",
    });
  }

  console.log(`[password-reset-confirm] password reset via ${grant.via}`);

  return json(200, {
    password_changed: true,
    token: sessionToken,
    profile: profile || null,
  });
}

export const handler = safeHandler(handlerImpl);
