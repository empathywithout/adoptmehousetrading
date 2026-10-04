// Simple Redis cache wrapper for Netlify functions.
// Uses Upstash REST API via @upstash/redis.
// Falls back gracefully if Redis is unavailable — never blocks a request.

import { Redis } from "@upstash/redis";

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Wrap a handler with cache-aside logic.
// keyFn(event) -> string cache key
// ttl: seconds
// computeFn(event) -> { statusCode, headers, body } (standard Netlify response)
export async function withCache(keyFn, ttl, computeFn, event) {
  const redis = getRedis();
  const key   = keyFn(event);

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        // Upstash auto-parses JSON — re-stringify for Netlify response body
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
          body: typeof cached === "string" ? cached : JSON.stringify(cached),
        };
      }
    } catch (err) {
      console.warn("Cache read failed (non-fatal):", err.message);
    }
  }

  const response = await computeFn(event);

  if (redis && response.statusCode === 200) {
    try {
      await redis.set(key, response.body, { ex: ttl });
    } catch (err) {
      console.warn("Cache write failed (non-fatal):", err.message);
    }
  }

  return response;
}

// Call this after any write that should invalidate a cache prefix.
// e.g. invalidate("listings:") clears all listing list caches.
export async function invalidate(prefix) {
  const redis = getRedis();
  if (!redis) return;
  try {
    // Upstash supports SCAN — delete all keys matching prefix*
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
      cursor = Number(next);
      if (keys.length) await redis.del(...keys);
    } while (cursor !== 0);
  } catch (err) {
    console.warn("Cache invalidation failed (non-fatal):", err.message);
  }
}

// ─── Raw key/value access ────────────────────────────────────────────────────
// Used for short-lived security material (password-reset tokens, Roblox
// verification codes, attempt counters). Deliberately NOT Postgres: these
// expire on their own, need no history, and the Neon SQL editor is locked by
// the free-tier compute cap so a new table cannot be migrated right now.
//
// Each returns null / false rather than throwing when Redis is unavailable.
// Callers must treat that as "cannot verify" and fail closed.
export async function kvGet(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get(key);
    if (v == null) return null;
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch (err) {
    console.warn("kvGet failed:", err.message);
    return null;
  }
}

export async function kvSet(key, value, ttlSeconds) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
    return true;
  } catch (err) {
    console.warn("kvSet failed:", err.message);
    return false;
  }
}

export async function kvDel(key) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.warn("kvDel failed:", err.message);
    return false;
  }
}

// Fixed-window counter. Returns the count after incrementing, or null when
// Redis is unavailable (callers fail closed).
export async function kvBump(key, ttlSeconds) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, ttlSeconds);
    return n;
  } catch (err) {
    console.warn("kvBump failed:", err.message);
    return null;
  }
}
