// ONE-TIME admin function — delete after running.
// GET /.netlify/functions/admin-registry-backfill-dupes?secret=BACKFILL_SECRET
//
// Scans all active build_registry entries and sets possible_duplicate_of
// on any entry that matches an earlier entry by:
//   1. Exact normalized title (case/punctuation insensitive)
//   2. Same house_id + ≥2 overlapping themes
//
// Earlier entry (by created_at) always wins — later one gets flagged.
// Entries that already have possible_duplicate_of set are skipped.

import { supabaseAdmin, json, safeHandler } from "./_lib/supabase.js";

function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const secret = new URLSearchParams(event.rawQuery || "").get("secret");
  if (!secret || secret !== process.env.BACKFILL_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  const db = supabaseAdmin();

  const { data: entries, error } = await db
    .from("build_registry")
    .select("id, title, created_at, house_id, themes, possible_duplicate_of")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) return json(500, { error: error.message });

  const updates = [];
  const processed = new Set();

  for (const entry of entries) {
    if (entry.possible_duplicate_of) continue; // already flagged

    let matchId = null;

    // Check against all earlier entries
    for (const earlier of entries) {
      if (earlier.id === entry.id) break; // only compare against earlier ones
      if (processed.has(earlier.id) && earlier.possible_duplicate_of) continue;

      // 1. Normalized title match
      if (normalizeTitle(earlier.title) === normalizeTitle(entry.title)) {
        matchId = earlier.id;
        break;
      }

      // 2. Same house_id + ≥2 overlapping themes
      if (entry.house_id && earlier.house_id === entry.house_id) {
        const overlap = (earlier.themes || []).filter((t) => (entry.themes || []).includes(t));
        if (overlap.length >= 2) {
          matchId = earlier.id;
          break;
        }
      }
    }

    if (matchId) {
      updates.push({ id: entry.id, possible_duplicate_of: matchId });
    }
    processed.add(entry.id);
  }

  // Apply updates
  let updated = 0;
  for (const u of updates) {
    const { error: updateErr } = await db
      .from("build_registry")
      .update({ possible_duplicate_of: u.possible_duplicate_of })
      .eq("id", u.id);
    if (!updateErr) updated++;
    else console.error("Failed to update", u.id, updateErr);
  }

  return json(200, {
    message: `Backfill complete. ${updated} of ${updates.length} entries flagged.`,
    flagged: updates,
  });
}

export const handler = safeHandler(handlerImpl);
