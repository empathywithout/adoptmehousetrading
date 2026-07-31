// ONE-TIME SEED — delete after use
// GET /.netlify/functions/admin-seed-trades?pw=ADMIN_PASSWORD
// GET /.netlify/functions/admin-seed-trades?pw=ADMIN_PASSWORD&delete=true
//
// Generates realistic trade records reflecting actual Adopt Me market values.
// All rows identifiable by notes="__seeded_fake__" for easy cleanup.
//
// Value anchor: Ride-A-Pet Potion = 1 RP
// Approximate real market values used to generate plausible trades:
//   Shadow Dragon FR    ~500 RP
//   Giraffe FR          ~400 RP
//   Bat Dragon FR       ~300 RP
//   Frost Dragon FR     ~80 RP
//   Owl FR              ~60 RP
//   Parrot FR           ~50 RP
//   Turtle FR           ~40 RP
//   Kangaroo FR         ~35 RP
//   Crow FR             ~30 RP
//   Evil Unicorn FR     ~25 RP
//   Arctic Reindeer FR  ~20 RP
//   Ride-A-Pet Potion   1 RP  (anchor)
//   Fly-A-Pet Potion    ~2 RP
//   Farm Egg            ~8 RP
//   Fossil Egg          ~10 RP
//   Aussie Egg          ~12 RP
//   Ocean Egg           ~15 RP

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

// ── Item definitions ──────────────────────────────────────────────────────────

const P = (id, name, variant = "regular", potion = "none") => ({
  type: "pet", category: "adopt_me_pets", id, name, qty: 1, variant, potion,
});
const E = (id, name) => ({ type: "egg", category: "eggs", id, name, qty: 1 });
const POT = (id, name, qty = 1) => ({ type: "potion", category: "potions", id, name, qty });

// Shorthand helpers
const fr = (id, name) => P(id, name, "regular", "fly_ride");
const r  = (id, name) => P(id, name, "regular", "ride");
const f  = (id, name) => P(id, name, "regular", "fly");
const np = (id, name) => P(id, name, "regular", "none");
const neon = (id, name, pot = "none") => P(id, name, "neon", pot);
const mn   = (id, name, pot = "none") => P(id, name, "mega_neon", pot);

const shadow   = (pot = "fly_ride") => P("shadow-dragon",     "Shadow Dragon",     "regular", pot);
const giraffe  = (pot = "fly_ride") => P("giraffe",           "Giraffe",           "regular", pot);
const bat      = (pot = "fly_ride") => P("bat-dragon",        "Bat Dragon",        "regular", pot);
const frost    = (pot = "fly_ride") => P("frost-dragon",      "Frost Dragon",      "regular", pot);
const owl      = (pot = "fly_ride") => P("owl",               "Owl",               "regular", pot);
const parrot   = (pot = "fly_ride") => P("parrot",            "Parrot",            "regular", pot);
const turtle   = (pot = "fly_ride") => P("turtle",            "Turtle",            "regular", pot);
const kanga    = (pot = "fly_ride") => P("kangaroo",          "Kangaroo",          "regular", pot);
const crow     = (pot = "fly_ride") => P("crow",              "Crow",              "regular", pot);
const evilunic = (pot = "fly_ride") => P("evil-unicorn",      "Evil Unicorn",      "regular", pot);
const arcticr  = (pot = "fly_ride") => P("arctic-reindeer",   "Arctic Reindeer",   "regular", pot);
const dodo     = (pot = "fly_ride") => P("dodo",              "Dodo",              "regular", pot);
const dragon   = (pot = "fly_ride") => P("dragon",            "Dragon",            "regular", pot);
const unicorn  = (pot = "fly_ride") => P("unicorn",           "Unicorn",           "regular", pot);
const kitsune  = (pot = "fly_ride") => P("kitsune",           "Kitsune",           "regular", pot);
const trex     = (pot = "fly_ride") => P("t-rex",             "T-Rex",             "regular", pot);
const snowOwl  = (pot = "fly_ride") => P("snow-owl",          "Snow Owl",          "regular", pot);

const ridePot  = (qty = 1) => POT("ride-a-pet-potion", "Ride-A-Pet Potion", qty);
const flyPot   = (qty = 1) => POT("fly-a-pet-potion",  "Fly-A-Pet Potion",  qty);
const farmEgg  = (qty = 1) => E("farm-egg",   "Farm Egg");
const fossilEgg= (qty = 1) => E("fossil-egg", "Fossil Egg");
const aussieEgg= (qty = 1) => E("aussie-egg", "Aussie Egg");
const oceanEgg = (qty = 1) => E("ocean-egg",  "Ocean Egg");

const SOURCES    = ["own_trade", "own_trade", "witnessed", "reddit", "discord"];
const CONFIDENCE = ["high", "medium", "medium", "low"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function jitter(base, pct = 0.15) {
  // Return base ± pct% — used to create natural variance across similar trades
  return base; // trades themselves encode the variance, no need to modify items
}

function randomDate(daysBack = 120) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  return d.toISOString().slice(0, 10);
}

// ── Trade templates ───────────────────────────────────────────────────────────
// Each entry is [side_a_items, side_b_items]
// Designed to produce consistent value signals across the solver

const TRADE_TEMPLATES = [
  // ── Shadow Dragon trades (~500 RP) ────────────────────────────────────────
  [[shadow()], [giraffe(), frost(), crow()]],
  [[shadow()], [bat(), frost(), frost()]],
  [[shadow()], [giraffe(), parrot(), ridePot(5)]],
  [[shadow()], [bat(), owl(), crow()]],
  [[shadow("none")], [giraffe("none"), frost("none"), ridePot(2)]],
  [[shadow("ride")], [giraffe(), parrot()]],
  [[neon("shadow-dragon","Shadow Dragon","fly_ride")], [shadow(), shadow(), frost(), frost()]],

  // ── Giraffe trades (~400 RP) ───────────────────────────────────────────────
  [[giraffe()], [bat(), owl(), crow()]],
  [[giraffe()], [frost(), frost(), owl(), ridePot(5)]],
  [[giraffe()], [bat(), parrot(), evilunic()]],
  [[giraffe("ride")], [bat("none"), crow(), ridePot(3)]],
  [[giraffe()], [owl(), owl(), evilunic(), ridePot(10)]],

  // ── Bat Dragon trades (~300 RP) ────────────────────────────────────────────
  [[bat()], [frost(), frost(), owl()]],
  [[bat()], [frost(), parrot(), crow(), ridePot(5)]],
  [[bat()], [owl(), turtle(), kanga()]],
  [[bat("none")], [frost("fly_ride"), frost("none"), ridePot(2)]],
  [[bat()], [frost(), owl(), evilunic()]],
  [[neon("bat-dragon","Bat Dragon")], [bat(), bat(), frost()]],

  // ── Frost Dragon trades (~80 RP) ───────────────────────────────────────────
  [[frost()], [owl(), ridePot(15)]],
  [[frost()], [parrot(), crow(), ridePot(5)]],
  [[frost()], [turtle(), kanga(), crow()]],
  [[frost()], [owl(), evilunic()]],
  [[frost("none")], [owl("none"), ridePot(10)]],
  [[frost("ride")], [parrot(), ridePot(3)]],
  [[frost()], [parrot(), turtle()]],
  [[neon("frost-dragon","Frost Dragon","fly_ride")], [frost(), frost(), frost(), frost()]],

  // ── Owl trades (~60 RP) ────────────────────────────────────────────────────
  [[owl()], [parrot(), crow(), ridePot(5)]],
  [[owl()], [turtle(), kanga(), ridePot(5)]],
  [[owl()], [parrot(), evilunic()]],
  [[owl("none")], [parrot("none"), ridePot(5)]],
  [[owl()], [crow(), crow(), arcticr(), ridePot(5)]],

  // ── Parrot trades (~50 RP) ─────────────────────────────────────────────────
  [[parrot()], [turtle(), crow(), ridePot(5)]],
  [[parrot()], [kanga(), crow(), ridePot(8)]],
  [[parrot()], [evilunic(), ridePot(5)]],
  [[parrot("none")], [turtle("none"), ridePot(8)]],

  // ── Turtle trades (~40 RP) ─────────────────────────────────────────────────
  [[turtle()], [kanga(), crow(), ridePot(5)]],
  [[turtle()], [arcticr(), crow(), ridePot(8)]],
  [[turtle("none")], [kanga("none"), ridePot(5)]],
  [[turtle()], [dodo(), crow(), ridePot(10)]],

  // ── Kangaroo trades (~35 RP) ───────────────────────────────────────────────
  [[kanga()], [crow(), arcticr(), ridePot(5)]],
  [[kanga()], [dodo(), ridePot(10)]],
  [[kanga("none")], [crow("none"), ridePot(8)]],

  // ── Crow trades (~30 RP) ───────────────────────────────────────────────────
  [[crow()], [arcticr(), ridePot(8)]],
  [[crow()], [evilunic(), ridePot(5)]],
  [[crow("none")], [arcticr("none"), ridePot(5)]],
  [[{ ...crow(), qty: 2 }], [turtle()]],

  // ── Potions as trade currency ──────────────────────────────────────────────
  [[ridePot(10)], [arcticr()]],
  [[ridePot(20)], [crow()]],
  [[ridePot(80)], [frost()]],
  [[flyPot(5)], [ridePot(10)]],
  [[flyPot(1)], [ridePot(2), arcticr()]],

  // ── Egg trades ────────────────────────────────────────────────────────────
  [[farmEgg()], [ridePot(8)]],
  [[fossilEgg()], [ridePot(10)]],
  [[aussieEgg()], [ridePot(12)]],
  [[oceanEgg()], [ridePot(15)]],
  [[aussieEgg(), farmEgg()], [crow()]],
  [[oceanEgg(), aussieEgg()], [turtle("none")]],
  [[fossilEgg(), fossilEgg()], [crow(), ridePot(5)]],

  // ── Mixed multi-item trades ────────────────────────────────────────────────
  [[frost(), parrot()], [bat(), ridePot(5)]],
  [[owl(), crow(), ridePot(10)], [bat()]],
  [[turtle(), kanga(), arcticr()], [parrot(), ridePot(5)]],
  [[frost(), crow(), ridePot(10)], [owl(), ridePot(5)]],
  [[parrot(), evilunic()], [frost(), ridePot(5)]],
  [[aussieEgg(), ridePot(10)], [crow(), ridePot(5)]],
  [[ridePot(50), crow()], [owl()]],
];

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const params = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams;
  const pw = params.get("pw");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || pw !== expected) return json(403, { error: "Wrong password" });

  const doDelete = params.get("delete") === "true";
  const db = supabaseAdmin();

  if (doDelete) {
    const { error } = await db.from("trade_records").delete().eq("notes", "__seeded_fake__");
    if (error) return json(500, { error: "Delete failed: " + error.message });
    return json(200, { deleted: true, message: "All seeded trades removed" });
  }

  // Find a profile to log as
  const { data: member } = await db.from("profiles").select("id").eq("is_data_team_member", true).limit(1).maybeSingle();
  let loggedBy = member?.id;
  if (!loggedBy) {
    const { data: any } = await db.from("profiles").select("id").limit(1).maybeSingle();
    loggedBy = any?.id;
  }
  if (!loggedBy) return json(400, { error: "No profiles found — sign up first" });

  // Insert all templates, some multiple times with date/source variation
  const records = [];
  for (const [sideA, sideB] of TRADE_TEMPLATES) {
    // Insert each template 2-3 times with different dates/sources for volume
    const repeats = Math.random() < 0.4 ? 3 : 2;
    for (let i = 0; i < repeats; i++) {
      records.push({
        logged_by: loggedBy,
        trade_date: randomDate(),
        source: pick(SOURCES),
        confidence: pick(CONFIDENCE),
        notes: "__seeded_fake__",
        side_a: sideA,
        side_b: sideB,
        status: "active",
      });
    }
  }

  let inserted = 0;
  const errors = [];
  for (const r of records) {
    const { error } = await db.from("trade_records").insert(r);
    if (error) errors.push(error.message.slice(0, 100));
    else inserted++;
  }

  return json(200, {
    inserted,
    templates: TRADE_TEMPLATES.length,
    errors: errors.length ? errors.slice(0, 5) : undefined,
    delete_url: "/.netlify/functions/admin-seed-trades?pw=YOUR_PW&delete=true",
  });
}

export const handler = safeHandler(handlerImpl);
