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

// Magic bytes for each allowed image type.
// We check the actual file header regardless of what contentType the
// client claims — a renamed exe won't have JPEG bytes at the start.
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png":  [[0x89, 0x50, 0x4E, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF header (WEBP follows at bytes 8-11)
};

function validateMagicBytes(buffer, contentType) {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) return false;
  return signatures.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
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

  const { filename, contentType, dataBase64 } = body;

  if (!ALLOWED_TYPES.includes(contentType)) {
    return json(400, { error: "Only PNG, JPEG, or WEBP images are allowed" });
  }

  const buffer = Buffer.from(dataBase64 || "", "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return json(400, { error: "Image must be under 5MB" });
  }

  // Validate actual file header bytes — rejects files disguised as images
  if (!validateMagicBytes(buffer, contentType)) {
    return json(400, { error: "File doesn't appear to be a valid image" });
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
