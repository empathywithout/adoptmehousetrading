// ONE-TIME migration function: copies Supabase Storage photos to R2
// Trigger: GET /.netlify/functions/admin-migrate-photos?secret=ADMIN_PASSWORD
// Delete this file after migration is confirmed complete.

import { requireAdmin, json, safeHandler } from "./_lib/supabase.js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

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

function getR2Key(supabaseUrl) {
  const match = supabaseUrl.match(/\/public\/(.+)/);
  return match ? match[1] : null;
}

async function migrateUrl(s3, url) {
  if (!url || !url.includes("supabase")) return { url, migrated: false };

  const key = getR2Key(url);
  if (!key) return { url, migrated: false, error: "Could not parse key" };

  // Check if already in R2
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { url: `${R2_PUBLIC_BASE}/${key}`, migrated: false, alreadyExists: true };
  } catch {}

  // Download from Supabase
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) return { url, migrated: false, error: `Download failed: ${resp.status}` };

  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") || "image/jpeg";

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return { url: `${R2_PUBLIC_BASE}/${key}`, migrated: true };
}

async function migrateArray(s3, photos) {
  if (!Array.isArray(photos) || photos.length === 0) return { photos, changed: false };
  const results = await Promise.all(photos.map(u => migrateUrl(s3, u)));
  const changed = results.some(r => r.migrated);
  return { photos: results.map(r => r.url), changed, details: results };
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  // Auth via admin password in query string
  const secret = event.queryStringParameters?.secret;
  const expected = process.env.ADMIN_PASSWORD;
  if (!secret || secret !== expected) return json(401, { error: "Unauthorized" });

  const db = (await import("./_lib/supabase.js")).supabaseAdmin();
  const s3 = getS3();

  const stats = { listings: 0, registry: 0, commissions: 0, errors: [] };

  // ── listings ──
  const { data: listings } = await db.from("listings")
    .select("id, photos")
    .filter("photos", "not.is", "null");

  for (const listing of listings || []) {
    if (!JSON.stringify(listing.photos).includes("supabase")) continue;
    try {
      const { photos, changed } = await migrateArray(s3, listing.photos);
      if (changed) {
        await db.from("listings").update({ photos }).eq("id", listing.id);
        stats.listings++;
      }
    } catch (err) {
      stats.errors.push(`listing ${listing.id}: ${err.message}`);
    }
  }

  // ── build_registry ──
  const { data: entries } = await db.from("build_registry")
    .select("id, photos")
    .filter("photos", "not.is", "null");

  for (const entry of entries || []) {
    if (!JSON.stringify(entry.photos).includes("supabase")) continue;
    try {
      const { photos, changed } = await migrateArray(s3, entry.photos);
      if (changed) {
        await db.from("build_registry").update({ photos }).eq("id", entry.id);
        stats.registry++;
      }
    } catch (err) {
      stats.errors.push(`registry ${entry.id}: ${err.message}`);
    }
  }

  // ── commission_requests ──
  const { data: commissions } = await db.from("commission_requests")
    .select("id, delivery_photos")
    .filter("delivery_photos", "not.is", "null");

  for (const req of commissions || []) {
    if (!JSON.stringify(req.delivery_photos).includes("supabase")) continue;
    try {
      const { photos, changed } = await migrateArray(s3, req.delivery_photos);
      if (changed) {
        await db.from("commission_requests").update({ delivery_photos: photos }).eq("id", req.id);
        stats.commissions++;
      }
    } catch (err) {
      stats.errors.push(`commission ${req.id}: ${err.message}`);
    }
  }

  return json(200, { ok: true, stats });
}

export const handler = safeHandler(handlerImpl);
