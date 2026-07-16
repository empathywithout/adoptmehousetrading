// POST { rbx_username, rbx_user_id, avatar_url, pin }
// -> { token, profile: { id, rbx_username, rbx_user_id, rbx_avatar_url } }
//
// First time this username is claimed: instant, no verification — same
// trust level as Traderie/AMTV signup — but the provided `pin` becomes
// this profile's PIN going forward.
//
// Re-claiming an existing username: the PIN must match. This is the only
// friction in the whole system, and it's deliberately placed only here —
// at the exact point where someone could otherwise type in a username
// that isn't theirs and take over the profile. A correct PIN adds a NEW
// session (via the sessions table) rather than invalidating other active
// sessions, so signing in on a second device doesn't sign you out of the
// first.
//
// Legacy profiles created before PINs existed have pin_hash = null; the
// first re-claim after this shipped sets their PIN from what's provided
// here rather than rejecting them.

import { supabaseAdmin, newSessionToken, hashToken, newPinSalt, hashPin, verifyPin, json, safeHandler } from "./_lib/supabase.js";

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

  const { rbx_username, rbx_user_id, avatar_url, pin } = body;
  if (!rbx_username || !rbx_user_id) {
    return json(400, { error: "Missing rbx_username or rbx_user_id — look up the username first" });
  }

  const cleanPin = String(pin || "").trim();
  if (!/^\d{4,6}$/.test(cleanPin)) {
    return json(400, { error: "PIN must be 4-6 digits" });
  }

  const db = supabaseAdmin();

  const { data: existing } = await db.from("profiles").select("*").eq("rbx_username", rbx_username).maybeSingle();

  let profile;

  if (!existing) {
    // Brand new username — instant, PIN becomes this profile's PIN.
    const salt = newPinSalt();
    const { data, error } = await db
      .from("profiles")
      .insert({
        rbx_username,
        rbx_user_id,
        rbx_avatar_url: avatar_url || null,
        pin_hash: hashPin(cleanPin, salt),
        pin_salt: salt,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't create profile" });
    }
    profile = data;
  } else if (!existing.pin_hash) {
    // Legacy profile from before PINs existed — allow the claim, set the
    // PIN they provided as this profile's PIN going forward.
    const salt = newPinSalt();
    const { data, error } = await db
      .from("profiles")
      .update({
        rbx_user_id,
        rbx_avatar_url: avatar_url || null,
        pin_hash: hashPin(cleanPin, salt),
        pin_salt: salt,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't update profile" });
    }
    profile = data;
  } else {
    // Existing profile with a PIN already set — must match.
    if (!verifyPin(cleanPin, existing.pin_salt, existing.pin_hash)) {
      return json(401, { error: "Incorrect PIN for this username" });
    }
    const { data, error } = await db
      .from("profiles")
      .update({ rbx_user_id, rbx_avatar_url: avatar_url || null })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error(error);
      return json(500, { error: "Couldn't update profile" });
    }
    profile = data;
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
      rbx_username: profile.rbx_username,
      rbx_user_id: profile.rbx_user_id,
      rbx_avatar_url: profile.rbx_avatar_url,
    },
  });
}

export const handler = safeHandler(handlerImpl);
