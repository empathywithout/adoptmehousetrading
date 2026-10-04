// POST { identifier }   (a Roblox username)
// -> { ok: true, code, instructions, expires_in_minutes }   always
//
// Starts account recovery. Verification is done against the user's Roblox
// profile rather than email: 279 of 957 accounts have no email address at
// all (it became optional in migration-026), while rbx_username is NOT NULL
// on every profile, so this is the only route that covers everybody. It is
// also the stronger claim here, since the Roblox account is what actually
// owns the items being traded.
//
// A code comes back whether or not the username belongs to an account, but
// one is only STORED when a profile matched. An unknown username therefore
// gets a code that can never verify, and this endpoint cannot be used to
// discover which Roblox players have accounts here.

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";
import {
  newRobloxCode,
  storeRobloxCode,
  tooManyAttempts,
  CODE_TTL_SECONDS,
} from "./_lib/reset.js";

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

  // Per-username limit. Fails closed when Redis is unavailable.
  if (await tooManyAttempts(`start:roblox:${identifier.toLowerCase()}`, 5, 15 * 60)) {
    return json(429, { error: "Too many attempts. Wait 15 minutes and try again." });
  }

  const db = supabaseAdmin();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, rbx_username")
    .eq("rbx_username", identifier)
    .maybeSingle();

  if (error) {
    console.error("[password-reset-start] profile lookup failed:", error);
    return json(503, {
      error: "Can't reach the database right now. Try again in a minute.",
      code: "DB_UNAVAILABLE",
    });
  }

  const code = newRobloxCode();
  if (profile) await storeRobloxCode(profile.rbx_username, code, profile.id);

  return json(200, {
    ok: true,
    code,
    expires_in_minutes: Math.round(CODE_TTL_SECONDS / 60),
    instructions: [
      "Open Roblox and go to your profile.",
      "Edit your About section and paste the code below into it.",
      "Come back here and press Verify.",
      "Once you're verified you can remove the code from your profile.",
    ],
  });
}

export const handler = safeHandler(handlerImpl);
