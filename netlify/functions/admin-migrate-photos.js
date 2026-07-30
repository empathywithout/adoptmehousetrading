// ONE-TIME migration function: copies Supabase Storage photos to R2
// Trigger: GET /.netlify/functions/admin-migrate-photos?secret=ADMIN_PASSWORD
// Delete this file after migration is confirmed complete.

import { json, safeHandler } from "./_lib/supabase.js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import pkg from "pg";
const { Pool } = pkg;

const R2_ACCOUNT_ID = "8edf48959988dcde96953a5dfd766c18";
const R2_BUCKET = "adoptme-listing-photos";
const R2_PUBLIC_BASE = "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev";

function getS3() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

function getR2Key(supabaseUrl) {
  const match = supabaseUrl.match(/\/public\/(.+)/);
  return match ? match[1] : null;
}

async function migrateUrl(s3, url) {
  if (!url || !url.includes("supabase")) return url;
  const key = getR2Key(url);
  if (!key) return url;

  // Check if already in R2
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return `${R2_PUBLIC_BASE}/${key}`;
  } catch {}

  // Download from Supabase and upload to R2
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) return url;
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return `${R2_PUBLIC_BASE}/${key}`;
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const secret = event.queryStringParameters?.secret;
  if (!secret || secret !== process.env.ADMIN_PASSWORD) return json(401, { error: "Unauthorized" });

  const s3 = getS3();
  const pool = getPool();
  const stats = { listings: 0, registry: 0, errors: [] };

  try {
    // Process listings -- 10 at a time, always from the start (already migrated ones skip fast)
    const { rows: listings } = await pool.query(
      `SELECT id, photos FROM listings WHERE photos::text LIKE '%supabase%' LIMIT 1`
    );

    for (const row of listings) {
      try {
        const photos = Array.isArray(row.photos) ? row.photos : JSON.parse(row.photos);
        const newPhotos = []; for (const u of photos) newPhotos.push(await migrateUrl(s3, u));
        if (JSON.stringify(newPhotos) !== JSON.stringify(photos)) {
          await pool.query(`UPDATE listings SET photos = $1 WHERE id = $2`, [JSON.stringify(newPhotos), row.id]);
          stats.listings++;
        }
      } catch (err) {
        stats.errors.push(`listing ${row.id}: ${err.message}`);
      }
    }

    // Process build_registry
    const { rows: entries } = await pool.query(
      `SELECT id, photos FROM build_registry WHERE photos::text LIKE '%supabase%' LIMIT 1`
    );

    for (const row of entries) {
      try {
        const photos = Array.isArray(row.photos) ? row.photos : JSON.parse(row.photos);
        const newPhotos = []; for (const u of photos) newPhotos.push(await migrateUrl(s3, u));
        if (JSON.stringify(newPhotos) !== JSON.stringify(photos)) {
          await pool.query(`UPDATE build_registry SET photos = $1 WHERE id = $2`, [JSON.stringify(newPhotos), row.id]);
          stats.registry++;
        }
      } catch (err) {
        stats.errors.push(`registry ${row.id}: ${err.message}`);
      }
    }

    const hasMore = listings.length === 10 || entries.length === 10;
    return json(200, { ok: true, stats, hasMore, nextOffset: offset + 10 });
  } finally {
    await pool.end();
  }
}

export const handler = safeHandler(handlerImpl);
