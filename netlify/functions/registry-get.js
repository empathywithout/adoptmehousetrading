// GET ?id=<entry_id>, Authorization: Bearer <token> (optional)
// -> { entry, possible_duplicate, disputes, compare_entries }
//
// is_community_verified is computed here, not stored: an active entry with
// no disputes ever filed, older than 30 days, earns it automatically —
// confidence that doesn't require a human to individually bless every
// entry, distinct from confirmed_original (an actual human ruling after a
// dispute).
//
// Disputes: while PENDING, only the entry's own builder can see the claim
// (so they can rebut) — nobody else, to avoid public mudslinging before a
// ruling. Once resolved (upheld/rejected), the claim and rebuttal are
// visible to everyone, since at that point there's an actual outcome to
// be transparent about.
//
// compare_entries: other registered builds tied to the same house type,
// so a visitor can eyeball whether two builds look like the same thing —
// the practical answer to "what's been cloned" given we don't have image
// hashing; human comparison, made easy, instead of an algorithm guessing.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VERIFY_AFTER_DAYS = 30;

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return json(400, { error: "Missing id" });
  }

  const db = supabaseAdmin();
  const viewer = await requireProfile(event); // optional — endpoint is public

  const { data: entry, error } = await db
    .from("build_registry")
    .select("*, profiles!build_registry_profile_id_fkey(display_name, rbx_avatar_url)")
    .eq("id", id)
    .maybeSingle();

  if (error || !entry || entry.status === "removed") {
    return json(404, { error: "Build not found" });
  }

  let possibleDuplicate = null;
  if (entry.possible_duplicate_of) {
    const { data } = await db
      .from("build_registry")
      .select("id, title, created_at, profiles(display_name)")
      .eq("id", entry.possible_duplicate_of)
      .maybeSingle();
    possibleDuplicate = data || null;
  }

  const { data: allDisputes } = await db
    .from("build_registry_disputes")
    .select("*, profiles!build_registry_disputes_disputer_profile_id_fkey(display_name)")
    .eq("build_registry_id", id)
    .order("created_at", { ascending: true });

  const isOwner = viewer && viewer.id === entry.profile_id;
  const disputes = (allDisputes || []).filter((d) => d.status !== "pending" || isOwner);

  const everDisputed = (allDisputes || []).length > 0;
  const ageDays = (Date.now() - new Date(entry.created_at).getTime()) / 86400000;
  const isCommunityVerified = entry.status === "active" && !everDisputed && ageDays >= VERIFY_AFTER_DAYS;

  let compareEntries = [];
  if (entry.house_id) {
    const { data } = await db
      .from("build_registry")
      .select("id, title, photos, status, profiles(display_name)")
      .eq("house_id", entry.house_id)
      .neq("id", id)
      .order("created_at", { ascending: true })
      .limit(12);
    compareEntries = data || [];
  }

  return json(200, {
    entry: { ...entry, is_community_verified: isCommunityVerified },
    possible_duplicate: possibleDuplicate,
    disputes,
    compare_entries: compareEntries,
  });
}

export const handler = safeHandler(handlerImpl);
