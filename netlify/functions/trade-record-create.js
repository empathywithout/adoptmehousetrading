// POST, Authorization: Bearer <token>
// body: { trade_date, source, source_url, confidence, notes,
//         side_a: [...], side_a_value_shark,
//         side_b: [...], side_b_value_shark }
// -> { record }
// Data Team members only.

import { supabaseAdmin, requireProfile, json, safeHandler } from "./_lib/supabase.js";

const VALID_SOURCES = ["site_confirmed", "own_trade", "witnessed", "reddit", "discord"];
const VALID_CONFIDENCE = ["high", "medium", "low"];
const VALID_VARIANTS = ["regular", "neon", "mega_neon"];
const VALID_POTIONS = ["none", "ride", "fly", "fly_ride"];
const VALID_BUILD_TYPES = ["original", "speedbuild", "cloned", "glitch", "glitch_original", "glitch_cloned"];

function cleanItem(it) {
  if (!it || !it.type || !["pet", "house"].includes(it.type)) return null;
  if (!it.id || !it.name) return null;
  const base = {
    type: it.type,
    id: String(it.id).slice(0, 100),
    name: String(it.name).slice(0, 100),
    qty: Math.max(1, Math.min(99, parseInt(it.qty) || 1)),
  };
  if (it.type === "pet") {
    base.variant = VALID_VARIANTS.includes(it.variant) ? it.variant : "regular";
    base.potion = VALID_POTIONS.includes(it.potion) ? it.potion : "none";
  }
  if (it.type === "house") {
    base.build_type = VALID_BUILD_TYPES.includes(it.build_type) ? it.build_type : null;
    base.bucks_invested = it.bucks_invested > 0 ? Number(it.bucks_invested) : null;
  }
  return base;
}

async function handlerImpl(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const profile = await requireProfile(event);
  if (!profile) return json(401, { error: "Not signed in" });
  if (!profile.is_data_team_member) return json(403, { error: "Data Team members only" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const { trade_date, source, source_url, confidence, notes, side_a, side_b,
          side_a_value_shark, side_b_value_shark } = body;

  if (!VALID_SOURCES.includes(source)) return json(400, { error: "Invalid source" });

  const cleanSideA = (Array.isArray(side_a) ? side_a : []).map(cleanItem).filter(Boolean);
  const cleanSideB = (Array.isArray(side_b) ? side_b : []).map(cleanItem).filter(Boolean);

  if (!cleanSideA.length || !cleanSideB.length) {
    return json(400, { error: "Both sides of the trade are required" });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.from("trade_records").insert({
    logged_by: profile.id,
    trade_date: trade_date || new Date().toISOString().slice(0, 10),
    source,
    source_url: source_url ? String(source_url).slice(0, 500) : null,
    confidence: VALID_CONFIDENCE.includes(confidence) ? confidence : "medium",
    notes: notes ? String(notes).slice(0, 500) : null,
    side_a: cleanSideA,
    side_a_value_shark: side_a_value_shark > 0 ? Number(side_a_value_shark) : null,
    side_b: cleanSideB,
    side_b_value_shark: side_b_value_shark > 0 ? Number(side_b_value_shark) : null,
  }).select().single();

  if (error) { console.error(error); return json(500, { error: "Couldn't save trade record" }); }

  return json(200, { record: data });
}

export const handler = safeHandler(handlerImpl);
