import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "crypto";

// Service-role client: server-side only, bypasses Row Level Security.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Extracts "Bearer <token>" from the Authorization header and resolves it
// to a profile row. Returns null if missing/invalid.
export async function requireProfile(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("session_token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
