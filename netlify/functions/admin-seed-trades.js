// ONE-TIME SEED — delete after use
// GET /.netlify/functions/admin-seed-trades?pw=ADMIN_PASSWORD
// Inserts ~50 realistic fake trade records then returns how many were inserted.
// All rows get seeded_fake=true so they can be bulk-deleted cleanly.

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

const PETS = [
  { id: "shadow-dragon",      name: "Shadow Dragon" },
  { id: "bat-dragon",         name: "Bat Dragon" },
  { id: "frost-dragon",       name: "Frost Dragon" },
  { id: "evil-unicorn",       name: "Evil Unicorn" },
  { id: "giraffe",            name: "Giraffe" },
  { id: "parrot",             name: "Parrot" },
  { id: "owl",                name: "Owl" },
  { id: "dodo",               name: "Dodo" },
  { id: "golden-dragon",      name: "Golden Dragon" },
  { id: "diamond-dragon",     name: "Diamond Dragon" },
  { id: "crow",               name: "Crow" },
  { id: "arctic-reindeer",    name: "Arctic Reindeer" },
  { id: "kangaroo",           name: "Kangaroo" },
  { id: "turtle",             name: "Turtle" },
  { id: "monkey",             name: "Monkey" },
  { id: "albino-monkey",      name: "Albino Monkey" },
  { id: "queen-bee",          name: "Queen Bee" },
  { id: "dragon",             name: "Dragon" },
  { id: "unicorn",            name: "Unicorn" },
  { id: "wolf",               name: "Wolf" },
  { id: "kitsune",            name: "Kitsune" },
  { id: "t-rex",              name: "T-Rex" },
  { id: "golden-unicorn",     name: "Golden Unicorn" },
  { id: "diamond-unicorn",    name: "Diamond Unicorn" },
  { id: "axolotl",            name: "Axolotl" },
  { id: "capybara",           name: "Capybara" },
  { id: "snow-owl",           name: "Snow Owl" },
  { id: "peacock",            name: "Peacock" },
  { id: "bat",                name: "Bat" },
  { id: "cloud-dragon",       name: "Cloud Dragon" },
];

const VARIANTS = ["regular", "regular", "regular", "neon", "mega_neon"];
const POTIONS  = ["none", "none", "ride", "fly", "fly_ride"];
const SOURCES  = ["own_trade", "own_trade", "witnessed", "reddit", "discord"];
const CONFIDENCE = ["high", "medium", "medium", "low"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomPet() {
  return {
    type: "pet",
    ...pick(PETS),
    qty: 1,
    variant: pick(VARIANTS),
    potion: pick(POTIONS),
  };
}

function randomSide(count = null) {
  const n = count ?? (Math.random() < 0.7 ? 1 : Math.random() < 0.6 ? 2 : 3);
  return Array.from({ length: n }, randomPet);
}

function randomDate() {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * 90));
  return d.toISOString().slice(0, 10);
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const pw = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams.get("pw");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || pw !== expected) return json(403, { error: "Wrong password" });

  // Check for ?delete=true to clean up
  const doDelete = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams.get("delete") === "true";
  const db = supabaseAdmin();

  if (doDelete) {
    // Raw delete via pg pool — QueryBuilder doesn't support JSONB filtering easily
    const pool = db._pool || (await import("pg").then(m => null)); // fallback
    // Use the QueryBuilder with a notes filter
    const { error } = await db
      .from("trade_records")
      .delete()
      .eq("notes", "__seeded_fake__");
    if (error) return json(500, { error: "Delete failed: " + error.message });
    return json(200, { deleted: true });
  }

  // Generate 50 fake trade records
  // We need a real profile ID to use as logged_by — find the first data team member
  const { data: member } = await db
    .from("profiles")
    .select("id")
    .eq("is_data_team_member", true)
    .limit(1)
    .maybeSingle();

  // If no data team member exists, use any profile
  let loggedBy = member?.id;
  if (!loggedBy) {
    const { data: anyProfile } = await db
      .from("profiles")
      .select("id")
      .limit(1)
      .maybeSingle();
    loggedBy = anyProfile?.id;
  }

  if (!loggedBy) return json(400, { error: "No profiles found — sign up first" });

  const records = Array.from({ length: 50 }, () => ({
    logged_by: loggedBy,
    trade_date: randomDate(),
    source: pick(SOURCES),
    confidence: pick(CONFIDENCE),
    notes: "__seeded_fake__",
    side_a: randomSide(),
    side_b: randomSide(),
    status: "active",
  }));

  let inserted = 0;
  const errors = [];
  for (const r of records) {
    const { error } = await db.from("trade_records").insert(r);
    if (error) errors.push(error.message);
    else inserted++;
  }

  return json(200, {
    inserted,
    errors: errors.length ? errors : undefined,
    delete_url: "/.netlify/functions/admin-seed-trades?pw=YOUR_PW&delete=true",
  });
}

export const handler = safeHandler(handlerImpl);
