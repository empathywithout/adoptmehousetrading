// Photo fingerprints for spotting the same picture uploaded twice.
//
// Every upload gets a fresh R2 filename, so a person who registers the same
// build again with the same screenshots produces new URLs and the exact-URL
// check in duplicates.js never sees it. Comparing what the image looks like
// catches that.
//
// How: ask the Netlify Image CDN (already allowed to read the R2 bucket, see
// [images] in netlify.toml) for a 17x16 PNG of the photo, then take a
// difference hash: for each of 16 rows, is each pixel brighter than the one
// to its right? 256 bits, stored as 64 hex characters.
//
// Measured on the live registry (Nov 2026), across the 27 flagged pairs whose
// original still existed: a re-uploaded copy of a photo hashed to distance 0
// from the original every time, and the nearest non-matching photo was 41+
// bits away. MATCH_DISTANCE leaves plenty of room either side.
//
// No image library needed: the CDN does the decoding and resizing, and the
// tiny PNG it returns is unpacked below with node's own zlib.

import { inflateSync } from "zlib";

export const MATCH_DISTANCE = 10; // of 256 bits

const GRID_W = 17;
const GRID_H = 16;
const R2_PREFIX = "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/";

function siteBase() {
  return (process.env.URL || "https://adoptmehousetrading.com").replace(/\/$/, "");
}

// ── Minimal PNG decoder ─────────────────────────────────────────────────────
// Handles 8-bit grey, RGB, palette, grey+alpha and RGBA, non-interlaced,
// which covers anything the CDN sends back for fm=png. Returns
// { width, height, gray: Float64Array } with one luminance value per pixel.
export function decodePngToGray(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error("not a PNG");

  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("palette PNG without PLTE");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }

  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    let r, g, b;
    if (colorType === 0 || colorType === 4) {
      r = g = b = out[i * channels];
    } else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
    } else {
      r = out[i * channels]; g = out[i * channels + 1]; b = out[i * channels + 2];
    }
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { width, height, gray };
}

export function differenceHash({ width, height, gray }) {
  if (width !== GRID_W || height !== GRID_H) throw new Error(`expected ${GRID_W}x${GRID_H}, got ${width}x${height}`);
  let hex = "";
  let nibble = 0, bits = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W - 1; x++) {
      const i = y * GRID_W + x;
      nibble = (nibble << 1) | (gray[i] > gray[i + 1] ? 1 : 0);
      if (++bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0; }
    }
  }
  return hex;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

export function hammingHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

// One photo URL -> 64-char hex fingerprint, or null if it can't be read.
// Only photos in our own R2 bucket are fingerprinted; the CDN refuses others.
export async function fingerprintPhoto(url, { timeoutMs = 8000 } = {}) {
  if (typeof url !== "string" || !url.startsWith(R2_PREFIX)) return null;
  const cdn = `${siteBase()}/.netlify/images?url=${encodeURIComponent(url)}&w=${GRID_W}&h=${GRID_H}&fit=fill&fm=png`;
  try {
    const res = await fetch(cdn, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`CDN ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return differenceHash(decodePngToGray(buf));
  } catch (err) {
    console.error("[photo-fingerprint] failed for", url, err.message);
    return null;
  }
}

// Fingerprints a list of URLs a few at a time, keeping order. Stops starting
// new work once `deadline` (a Date.now() value) passes; anything not reached
// comes back as undefined so callers can tell "not tried" from "failed" (null).
export async function fingerprintPhotos(urls, { concurrency = 8, deadline = Infinity } = {}) {
  const out = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length && Date.now() < deadline) {
      const i = next++;
      out[i] = await fingerprintPhoto(urls[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}

// True when every photo in `a` looks like some photo in `b`. A null or
// missing fingerprint anywhere in `a` means "can't tell", so false: this
// drives automatic removal and must never guess.
export function allPhotosFoundIn(a, b) {
  if (!Array.isArray(a) || !a.length || !Array.isArray(b) || !b.length) return false;
  return a.every((h) => typeof h === "string" && b.some((o) => hammingHex(h, o) <= MATCH_DISTANCE));
}

export function isComplete(hashes, photos) {
  return Array.isArray(hashes) && Array.isArray(photos) && hashes.length === photos.length && hashes.every((h) => typeof h === "string");
}

// Makes sure a build_registry row has a complete set of fingerprints,
// computing and saving them if not. Mutates entry.photo_hashes. Returns true
// when the entry ends up complete. Incomplete results aren't saved, so a
// photo that failed to load gets another try next time.
export async function ensureEntryHashes(db, entry, { deadline = Infinity } = {}) {
  if (isComplete(entry.photo_hashes, entry.photos)) return true;
  const photos = Array.isArray(entry.photos) ? entry.photos : [];
  if (!photos.length) return false;
  const hashes = await fingerprintPhotos(photos, { deadline });
  if (!isComplete(hashes, photos)) return false;
  const { error } = await db.from("build_registry").update({ photo_hashes: hashes }).eq("id", entry.id);
  if (error) console.error("[photo-fingerprint] couldn't save hashes for", entry.id, error);
  entry.photo_hashes = hashes;
  return true;
}
