// POST, Authorization: Bearer <token>
// body: { filename, contentType, dataBase64 }
// -> { url }
//
// Photos route through here rather than a public Storage write policy so we
// can validate type/size server-side before anything lands in the bucket.
// Netlify's synchronous function payload cap (~6MB) is the practical limit —
// have the browser downscale/compress images before base64-encoding them.
//
// Images are stored in Cloudflare R2 (free egress) rather than Supabase
// Storage to avoid burning through Supabase's egress quota.

import { requireProfile, json, safeHandler } from "./_lib/supabase.js";
import { createHash, createHmac } from "crypto";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

const R2_ACCOUNT_ID   = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY   = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY   = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET       = process.env.R2_BUCKET_NAME;         // adoptme-listing-photos
const R2_PUBLIC_URL   = process.env.R2_PUBLIC_URL;          // https://pub-xxx.r2.dev

// Magic bytes for each allowed image type.
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png":  [[0x89, 0x50, 0x4E, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

function validateMagicBytes(buffer, contentType) {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) return false;
  return signatures.some(sig => sig.every((byte, i) => buffer[i] === byte));
}

// AWS Signature V4 helpers — R2 speaks S3-compatible auth.
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

async function uploadToR2(buffer, path, contentType) {
  const region  = "auto";
  const service = "s3";
  const host    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${R2_BUCKET}/${path}`;

  const now = new Date();
  const amzDate  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z"; // 20260721T123456Z
  const dateStamp = amzDate.slice(0, 8); // 20260721

  const payloadHash = sha256hex(buffer);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${R2_BUCKET}/${path}`,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(R2_SECRET_KEY, dateStamp, region, service);
  const signature  = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type":          contentType,
      "x-amz-content-sha256":  payloadHash,
      "x-amz-date":            amzDate,
      "Authorization":          authHeader,
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed: ${res.status} ${text}`);
  }
}

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const profile = await requireProfile(event);
  if (!profile) {
    return json(401, { error: "Create a profile first" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { contentType, dataBase64 } = body;

  if (!ALLOWED_TYPES.includes(contentType)) {
    return json(400, { error: "Only PNG, JPEG, or WEBP images are allowed" });
  }

  const buffer = Buffer.from(dataBase64 || "", "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return json(400, { error: "Image must be under 5MB" });
  }

  if (!validateMagicBytes(buffer, contentType)) {
    return json(400, { error: "File doesn't appear to be a valid image" });
  }

  const ext  = contentType.split("/")[1];
  const path = `${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    await uploadToR2(buffer, path, contentType);
  } catch (err) {
    console.error(err);
    return json(500, { error: "Upload failed" });
  }

  const url = `${R2_PUBLIC_URL.replace(/\/$/, "")}/${path}`;
  return json(200, { url });
}

export const handler = safeHandler(handlerImpl);
