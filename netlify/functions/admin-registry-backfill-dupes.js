// GET  ?pw=  or header X-Admin-Password  -> dry run, changes nothing
// POST with X-Admin-Password + { apply: true } -> writes possible_duplicate_of
//
// Detection only ever ran at submission time, so every entry registered
// before the check existed (or while it was failing) was never examined. On
// the live registry 21 entries matched the site's own title rule and only 2
// carried a flag. This replays the current rules over the whole table.
//
// Entries are walked oldest-first and compared only against entries that
// already existed, which is the same "earliest entry keeps the claim" rule
// used at submission.
//
// WARNING: a dismissed flag is stored as possible_duplicate_of = null, which
// is indistinguishable from never-flagged, so applying this will resurrect
// anything previously dismissed. The dry run reports the count first.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";
import { invalidate } from "./_lib/cache.js";
import { findDuplicate } from "./_lib/duplicates.js";

async function handlerImpl(event) {
  const pw = event.queryStringParameters?.pw;
  const authed =
    requireAdmin(event) || (pw && pw === process.env.ADMIN_PASSWORD);
  if (!authed) return json(401, { error: "Incorrect admin password" });

  let apply = false;
  if (event.httpMethod === "POST") {
    try {
      apply = JSON.parse(event.body || "{}").apply === true;
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
  }

  const db = supabaseAdmin();
  const { data: entries, error } = await db
    .from("build_registry")
    .select("id, title, photos, profile_id, possible_duplicate_of")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[backfill-dupes] query failed:", error);
    return json(500, { error: "Couldn't load the registry" });
  }

  const all = entries || [];
  const seen = [];
  const changes = [];

  for (const e of all) {
    const { duplicateOf, reason } = findDuplicate(
      { title: e.title, photos: e.photos, profileId: e.profile_id },
      seen
    );
    seen.push(e);
    if (!duplicateOf) continue;
    if (e.possible_duplicate_of === duplicateOf) continue; // already correct
    changes.push({
      id: e.id,
      title: e.title,
      reason,
      duplicate_of: duplicateOf,
      was: e.possible_duplicate_of,
    });
  }

  let applied = 0;
  if (apply) {
    for (const c of changes) {
      const { error: upErr } = await db
        .from("build_registry")
        .update({ possible_duplicate_of: c.duplicate_of })
        .eq("id", c.id);
      if (upErr) console.error("[backfill-dupes] update failed", c.id, upErr);
      else applied++;
    }
    await invalidate("registry:list:");
  }

  const byReason = {};
  for (const c of changes) byReason[c.reason] = (byReason[c.reason] || 0) + 1;

  return json(200, {
    dry_run: !apply,
    scanned: all.length,
    already_flagged: all.filter((e) => e.possible_duplicate_of).length,
    would_flag: changes.length,
    by_reason: byReason,
    applied,
    sample: changes.slice(0, 25),
  });
}

export const handler = safeHandler(handlerImpl);
