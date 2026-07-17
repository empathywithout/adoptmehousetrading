import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "crypto";
import WebSocket from "ws";

// Service-role client: server-side only, bypasses Row Level Security.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
//
// supabase-js always constructs a realtime client internally (even though
// we never use realtime subscriptions), which needs a WebSocket
// implementation. Netlify's Node runtime doesn't expose one globally, so
// we hand it the `ws` package directly via the transport option — this is
// the fix suggested by supabase-js's own error message.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
}

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Generic scrypt-based secret hashing — used for account passwords. A
// fast hash (sha256) alone is fine for random 32-byte session tokens
// above, but a password has far less entropy and needs scrypt's
// deliberate slowness to resist offline cracking if the DB ever leaked.
export function newSecretSalt() {
  return randomBytes(16).toString("hex");
}

export function hashSecret(secret, salt) {
  return scryptSync(String(secret), salt, 64).toString("hex");
}

export function verifySecret(secret, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashSecret(secret, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// Extracts "Bearer <token>" from the Authorization header and resolves it
// to a profile row via the sessions table (a profile can have many active
// sessions across devices).
export async function requireProfile(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;

  const db = supabaseAdmin();
  const tokenHash = hashToken(token);

  const { data: session } = await db
    .from("sessions")
    .select("profile_id, profiles(*)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session?.profiles) return null;

  db.from("sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash).then(() => {});
  return session.profiles;
}

// Simple password-gated admin check for the dispute resolution page — not
// a real roles/permissions system, just enough to keep the resolution
// action from being public. Set ADMIN_PASSWORD in Netlify's environment
// variables; the admin page sends it back as a header on every request.
export function requireAdmin(event) {
  const provided = event.headers["x-admin-password"] || event.headers["X-Admin-Password"];
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && provided === expected;
}

// Fire-and-forget notification insert. Called directly inside the same
// function that causes the triggering event, right alongside the real DB
// write — no separate pub/sub system needed since everything already runs
// through these service-role functions. Never let a notification failure
// break the actual action the user is waiting on.
export async function notify(db, profile_id, type, message, link = null) {
  try {
    await db.from("notifications").insert({ profile_id, type, message, link });
  } catch (err) {
    console.error(`notify(${type}) failed (non-fatal):`, err);
  }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Wraps a Netlify function handler so ANY thrown error (missing env vars,
// Supabase connection failures, bad JSON, whatever) returns a real JSON
// error response instead of an opaque 502 from Netlify's gateway. Every
// function in this directory should export handler wrapped in this.
export function safeHandler(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      console.error("Unhandled function error:", err);
      const message =
        err?.message?.includes("SUPABASE_URL") || err?.message?.includes("SUPABASE_SERVICE_ROLE_KEY")
          ? "Server misconfigured: Supabase environment variables aren't set. Check Netlify's Site settings → Environment variables."
          : "Something went wrong on our end. Try again in a moment.";
      return json(500, { error: message });
    }
  };
}
