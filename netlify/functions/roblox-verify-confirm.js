// POST { identifier }   (the Roblox username used with password-reset-start)
// -> { ok: true, token } on success, 400 otherwise
//
// Reads the user's public Roblox profile and checks their About text contains
// the code we issued. That proves control of the Roblox account, which is the
// account that actually owns the traded items — a stronger claim than an
// inbox, and the only route available to the 279 accounts with no email.
//
// Deliberately generic failures: this must not become a way to discover which
// Roblox usernames have accounts here.

import { json, safeHandler } from "./_lib/supabase.js";
import {
  readRobloxCode,
  clearRobloxCode,
  newGrantToken,
  storeGrant,
  tooManyAttempts,
} from "./_lib/reset.js";

const GENERIC =
  "We couldn't find that code on your Roblox profile. Check it's saved, then try again.";

async function robloxUserByUsername(username) {
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  if (!res.ok) throw new Error(`roblox username lookup ${res.status}`);
  const data = await res.json();
  return data?.data?.[0] || null;
}

async function robloxDescription(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error(`roblox profile fetch ${res.status}`);
  const data = await res.json();
  return typeof data?.description === "string" ? data.description : "";
}

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const identifier = String(body.identifier || "").trim();
  if (!identifier || identifier.length > 20) {
    return json(400, { error: "Enter your Roblox username" });
  }

  // Guessing a code is the attack here, so the limit is tight and fails closed.
  if (await tooManyAttempts(`verify:${identifier.toLowerCase()}`, 10, 15 * 60)) {
    return json(429, { error: "Too many attempts. Wait 15 minutes and try again." });
  }

  const pending = await readRobloxCode(identifier);
  if (!pending?.code) {
    // No code issued, expired, or no such account — all answer the same.
    return json(400, { error: GENERIC });
  }

  let description = "";
  try {
    const user = await robloxUserByUsername(identifier);
    if (!user) return json(400, { error: GENERIC });
    description = await robloxDescription(user.id);
  } catch (err) {
    console.error("[roblox-verify-confirm] Roblox API failed:", err.message);
    return json(502, { error: "Couldn't reach Roblox just now. Try again in a moment." });
  }

  if (!description.includes(pending.code)) {
    return json(400, { error: GENERIC });
  }

  // Verified. Burn the code so it can't be replayed, and hand back a
  // single-use grant for the password step.
  await clearRobloxCode(identifier);
  const token = newGrantToken();
  const stored = await storeGrant(token, pending.profile_id, "roblox");
  if (!stored) {
    return json(503, {
      error: "Can't complete that right now. Try again in a minute.",
      code: "STORE_UNAVAILABLE",
    });
  }

  return json(200, { ok: true, token });
}

export const handler = safeHandler(handlerImpl);
