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
