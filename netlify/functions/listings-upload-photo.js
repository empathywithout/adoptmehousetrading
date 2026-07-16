// POST, Authorization: Bearer <token>
// body: { filename, contentType, dataBase64 }
// -> { url }
//
// Photos route through here rather than a public Storage write policy so we
// can validate type/size server-side before anything lands in the bucket.
// Netlify's synchronous function payload cap (~6MB) is the practical limit —
// have the browser downscale/compress images before base64-encoding them.

import {  supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const BUCKET = "listing-photos";
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

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

  const { filename, contentType, dataBase64 } = body;

  if (!ALLOWED_TYPES.includes(contentType)) {
    return json(400, { error: "Only PNG, JPEG, or WEBP images are allowed" });
  }

  const buffer = Buffer.from(dataBase64 || "", "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return json(400, { error: "Image must be under 5MB" });
  }

  const ext = contentType.split("/")[1];
  const path = `${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const db = supabaseAdmin();
  const { error } = await db.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });

  if (error) {
    console.error(error);
    return json(500, { error: "Upload failed" });
  }

  const { data: publicUrlData } = db.storage.from(BUCKET).getPublicUrl(path);

  return json(200, { url: publicUrlData.publicUrl });
}

export const handler = safeHandler(handlerImpl);
