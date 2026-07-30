import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";
import WebSocket from "ws";

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Service-role client: server-side only, bypasses Row Level Security.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
//
// Realtime is explicitly disabled — we never use subscriptions in these
// Netlify functions, and leaving it enabled spins up a WebSocket connection
// on every cold start for no reason, wasting both time and Supabase quota.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });
}

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

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

export async function requireProfile(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;

  const db = supabaseAdmin();
  const tokenHash = hashToken(token);
  const cacheKey  = `session:${tokenHash}`;

  // Check Redis cache first — avoids a Supabase round-trip on every authed request
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
    } catch (err) {
      console.warn("Session cache read failed (non-fatal):", err.message);
    }
  }

  const { data: session } = await db
    .from("sessions")
    .select("profile_id, profiles(*)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session?.profiles) return null;

  // Cache for 5 minutes — short enough that profile changes propagate quickly
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(session.profiles), { ex: 300 });
    } catch (err) {
      console.warn("Session cache write failed (non-fatal):", err.message);
    }
  }

  db.from("sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash).then(() => {});
  return session.profiles;
}

export function requireAdmin(event) {
  const provided = event.headers["x-admin-password"] || event.headers["X-Admin-Password"];
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && provided === expected;
}

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
