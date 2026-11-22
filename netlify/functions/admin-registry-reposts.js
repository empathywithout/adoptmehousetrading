// POST with X-Admin-Password:
//   { apply: false } -> preview, changes nothing except saving photo fingerprints
//   { apply: true }  -> removes the reposts and clears stale flags
//
// Driven from the Registry Dupes tab on the admin dashboard.
//
// Two clean-ups that don't need a person to look at them:
//
// 1. Reposts. The same person registered the same build again under the same
//    title, and every photo on the newer entry is a re-upload of one on the
//    older entry (see findRepost in _lib/duplicates.js). The newer entry is
//    soft-removed (status = 'removed', same as registry-delete.js), so the
//    oldest one keeps its date, hearts and claim. New submissions like this
//    are blocked in registry-create.js; this handles the ones that got in
//    before that check existed.
//
// 2. Stale flags. An entry flagged as a possible duplicate of something that
//    has since been removed. There's nothing left to compare it with, so the
//    flag is cleared.
//
// Fingerprints are only computed for entries that share an owner and title
// with another active entry, since nothing else can be a repost. That is
// still a few hundred photos the first time, more than one function call can
// fetch, so each call works until a time budget runs out, saves what it got,
// and returns { incomplete: true }. The dashboard calls again until it isn't.
// Saved fingerprints are reused, so later runs are quick.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";
import { findRepost, normalizeTitle } from "./_lib/duplicates.js";
import { ensureEntryHashes, isComplete } from "./_lib/photo-fingerprint.js";

const TIME_BUDGET_MS = 7000;

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Incorrect admin password" });

  let apply = false;
  try {
    apply = JSON.parse(event.body || "{}").apply === true;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const db = supabaseAdmin();

  const { data: entries, error } = await db
    .from("build_registry")
    .select("id, title, photos, photo_hashes, profile_id, possible_duplicate_of, created_at, profiles!build_registry_profile_id_fkey(display_name)")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[registry-reposts] query failed:", error);
    return json(500, { error: "Couldn't load the registry" });
  }
  const all = entries || [];

  // Same owner + same title groups, oldest first within each.
  const groups = new Map();
  for (const e of all) {
    const t = normalizeTitle(e.title);
    if (!t) continue;
    const key = `${e.profile_id}||${t}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const candidates = [...groups.values()].filter((g) => g.length > 1).flat();

  // Fill in fingerprints, a few entries at a time, until time runs out.
  const missing = candidates.filter((e) => !isComplete(e.photo_hashes, e.photos));
  let idx = 0;
  async function worker() {
    while (idx < missing.length && Date.now() < deadline) {
      const e = missing[idx++];
      await ensureEntryHashes(db, e, { deadline });
    }
  }
  await Promise.all([worker(), worker()]);
  const stillMissing = candidates.filter((e) => !isComplete(e.photo_hashes, e.photos));
  // An entry whose photos can't be read at all (deleted file, a URL from
  // outside our bucket) will never complete. Only keep looping while the last
  // pass actually made progress.
  const progressed = stillMissing.length < missing.length;
  if (stillMissing.length && progressed && Date.now() >= deadline) {
    return json(200, {
      incomplete: true,
      fingerprinted: candidates.length - stillMissing.length,
      to_fingerprint: candidates.length,
    });
  }

  // Walk each group oldest-first; a later entry is a repost if it matches an
  // earlier one that is itself being kept.
  const reposts = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const kept = [];
    for (const e of group) {
      const original = isComplete(e.photo_hashes, e.photos)
        ? findRepost({ title: e.title, profileId: e.profile_id, hashes: e.photo_hashes }, kept)
        : null;
      if (original) {
        reposts.push({
          id: e.id,
          title: e.title,
          by: e.profiles?.display_name || null,
          created_at: e.created_at,
          photo: e.photos?.[0] || null,
          original_id: original.id,
          original_created_at: original.created_at,
        });
      } else {
        kept.push(e);
      }
    }
  }

  // Flags pointing at an entry that is no longer active.
  const repostIds = new Set(reposts.map((r) => r.id));
  const activeIds = new Set(all.map((e) => e.id));
  const flagged = all.filter((e) => e.possible_duplicate_of && !repostIds.has(e.id));
  const targetIds = [...new Set(flagged.map((e) => e.possible_duplicate_of).filter((id) => !activeIds.has(id)))];
  let goneIds = new Set();
  if (targetIds.length) {
    const { data: targets, error: tErr } = await db
      .from("build_registry")
      .select("id, status")
      .in("id", targetIds);
    if (tErr) {
      console.error("[registry-reposts] target lookup failed:", tErr);
      return json(500, { error: "Couldn't check flagged originals" });
    }
    const byId = new Map((targets || []).map((t) => [t.id, t.status]));
    // Only 'removed' (or a row that no longer exists) counts as gone. A
    // disputed or confirmed original still matters to the flag.
    goneIds = new Set(targetIds.filter((id) => !byId.has(id) || byId.get(id) === "removed"));
  }
  const stale = flagged
    .filter((e) => goneIds.has(e.possible_duplicate_of))
    .map((e) => ({ id: e.id, title: e.title, by: e.profiles?.display_name || null }));

  let removed = 0;
  let cleared = 0;
  if (apply) {
    for (const r of reposts) {
      const { error: upErr } = await db
        .from("build_registry")
        .update({ status: "removed", possible_duplicate_of: r.original_id })
        .eq("id", r.id)
        .eq("status", "active");
      if (upErr) console.error("[registry-reposts] remove failed", r.id, upErr);
      else removed++;
    }
    for (const s of stale) {
      const { error: upErr } = await db
        .from("build_registry")
        .update({ possible_duplicate_of: null })
        .eq("id", s.id);
      if (upErr) console.error("[registry-reposts] clear failed", s.id, upErr);
      else cleared++;
    }
    if (removed || cleared) await invalidate("registry:list:");
  }

  return json(200, {
    incomplete: false,
    dry_run: !apply,
    scanned: all.length,
    unreadable: stillMissing.length,
    reposts,
    stale,
    removed,
    cleared,
  });
}

export const handler = safeHandler(handlerImpl);
