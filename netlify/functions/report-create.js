// POST body: { listing_id, reason, details }
// -> { ok: true }
//
// No auth required to report — reporting shouldn't have a barrier. This
// doesn't take the listing down automatically; it just logs it for manual
// review, since photos post instantly without pre-approval.

import { supabaseAdmin, json } from "./_lib/supabase.js";

const VALID_REASONS = [
  "crosstrading",
  "proxy_trading",
  "misrepresented_clone",
  "scam_or_no_show",
  "other",
];

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { listing_id, reason, details } = body;
  if (!listing_id || !VALID_REASONS.includes(reason)) {
    return json(400, { error: "listing_id and a valid reason are required" });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("reports").insert({
    listing_id,
    reason: String(reason).slice(0, 200),
    details: details ? String(details).slice(0, 1000) : null,
  });

  if (error) {
    console.error(error);
    return json(500, { error: "Couldn't submit report" });
  }

  return json(200, { ok: true });
}
