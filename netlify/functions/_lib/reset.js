// Shared machinery for account recovery.
//
// Recovery runs through Roblox profile verification: the user proves control
// of their Roblox account, which produces a single-use grant that
// password-reset-confirm.js exchanges for a new password. The grant lives
// here rather than inline so that a second route (email, once Resend is
// configured) can reuse the same expiry, single-use and hashing rules.
//
// Storage is Redis, not Postgres. These values expire on their own and have no
// audit value, and the Neon SQL editor is currently locked by the free-tier
// compute cap, so a new table cannot be migrated. Trade-off: if Redis is
// unavailable, recovery is unavailable. That fails closed, which is correct
// for a password reset.

import { randomBytes, createHash } from "crypto";
import { kvGet, kvSet, kvDel, kvBump } from "./cache.js";

export const GRANT_TTL_SECONDS = 15 * 60;
export const CODE_TTL_SECONDS = 20 * 60;

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

// ─── Reset grants ────────────────────────────────────────────────────────────
// The raw token goes to the user; only its hash is stored, same approach as
// session tokens.
export function newGrantToken() {
  return randomBytes(32).toString("hex");
}

export async function storeGrant(token, profileId, via) {
  return kvSet(
    `pwgrant:${sha256(token)}`,
    { profile_id: profileId, via, at: Date.now() },
    GRANT_TTL_SECONDS
  );
}

// Single use: the key is deleted as it is read, so a replayed token fails even
// if the password update later errors.
export async function consumeGrant(token) {
  if (!token || typeof token !== "string") return null;
  const key = `pwgrant:${sha256(token)}`;
  const data = await kvGet(key);
  if (!data) return null;
  await kvDel(key);
  return data;
}

// ─── Roblox verification codes ───────────────────────────────────────────────
// Short, unambiguous, easy to retype on a phone. No vowels, no 0/O/1/I/5/S.
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function newRobloxCode() {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `AMHT-${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function storeRobloxCode(rbxUsername, code, profileId) {
  return kvSet(
    `rblx:${rbxUsername.toLowerCase()}`,
    { code, profile_id: profileId, at: Date.now() },
    CODE_TTL_SECONDS
  );
}

export async function readRobloxCode(rbxUsername) {
  return kvGet(`rblx:${rbxUsername.toLowerCase()}`);
}

export async function clearRobloxCode(rbxUsername) {
  return kvDel(`rblx:${rbxUsername.toLowerCase()}`);
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Returns true when the caller should be refused. Fails closed: if Redis is
// unavailable we cannot count attempts, so we refuse rather than allow
// unlimited guessing.
export async function tooManyAttempts(bucket, limit, windowSeconds) {
  const n = await kvBump(`rl:${bucket}`, windowSeconds);
  if (n === null) return true;
  return n > limit;
}
