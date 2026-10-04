// Shared duplicate heuristics for the build registry.
//
// Lives in _lib so registry-create.js (at submission time) and
// admin-registry-backfill-dupes.js (over the existing rows) can never drift
// apart — they were going to be two copies of the same rules otherwise.

// Title normalisation, unicode-aware.
//
// The previous version was `.toLowerCase().replace(/[^a-z0-9]+/g, " ")`,
// which deletes every character outside the ASCII range. On the live registry
// that turned six real titles — "Домик среди леса🌳", "дом Ваниллы",
// "🍂 |*.+ 𝐂𝐨𝐳𝐲 𝐀𝐮𝐭𝐮𝐦𝐧 𝐂𝐨𝐭𝐭𝐚𝐠𝐞 +.*| 🎼" — into the empty string. Two
// unrelated Russian builds therefore looked identical to each other, while a
// genuine repost of either was unmatchable. NFKC also folds styled unicode,
// so 𝐂𝐨𝐳𝐲 and Cozy compare equal, which is how people actually dodge a
// title check.
export function normalizeTitle(t) {
  return String(t ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Do two entries share an uploaded image? These are R2 URLs, so an exact
// match means the same stored file, not merely a similar-looking build. No
// perceptual hashing needed to catch a repost of the same upload, which is
// the pattern actually present in the data (one account has eight entries
// all pointing at the same .jpeg).
export function sharesPhoto(photosA, photosB) {
  if (!Array.isArray(photosA) || !Array.isArray(photosB)) return false;
  const b = new Set(photosB.filter((p) => typeof p === "string" && p));
  if (!b.size) return false;
  return photosA.some((p) => typeof p === "string" && p && b.has(p));
}

// candidates MUST be ordered oldest-first: the earliest entry is the one that
// keeps the claim, later ones are flagged against it.
//
// Returns { duplicateOf, reason } where reason is one of:
//   "self_photo"  - this submitter already registered this exact image.
//                   The caller blocks this one; re-registering an image you
//                   already own gains nothing and is how the registry fills
//                   with noise.
//   "photo"       - someone else registered this exact image first. Flagged,
//                   never blocked: it may be a genuine ownership dispute and
//                   that is what the dispute system is for.
//   "title"       - same normalised title. Weakest signal, flag only.
export function findDuplicate({ title, photos, profileId }, candidates) {
  const normalized = normalizeTitle(title);
  let selfPhoto = null;
  let otherPhoto = null;
  let titleHit = null;

  for (const c of candidates || []) {
    if (!selfPhoto && c.profile_id === profileId && sharesPhoto(photos, c.photos)) {
      selfPhoto = c;
    }
    if (!otherPhoto && c.profile_id !== profileId && sharesPhoto(photos, c.photos)) {
      otherPhoto = c;
    }
    // An empty normalised title matches every other empty one, which is
    // meaningless — skip rather than group all of them together.
    if (!titleHit && normalized && normalizeTitle(c.title) === normalized) {
      titleHit = c;
    }
  }

  if (selfPhoto) return { duplicateOf: selfPhoto.id, reason: "self_photo" };
  if (otherPhoto) return { duplicateOf: otherPhoto.id, reason: "photo" };
  if (titleHit) return { duplicateOf: titleHit.id, reason: "title" };
  return { duplicateOf: null, reason: null };
}
