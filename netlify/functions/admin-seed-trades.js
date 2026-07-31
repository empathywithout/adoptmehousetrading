// ONE-TIME SEED — delete after use
// GET /.netlify/functions/admin-seed-trades?pw=ADMIN_PASSWORD
// Seeds ~100 realistic trade records reflecting actual Adopt Me market values
// All rows marked notes="__seeded_fake__" for easy cleanup
// DELETE: same URL with &delete=true

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

// ── Realistic RP values (Ride Pot = 1.0) ─────────────────────────────────
// Used to construct balanced trades the solver can learn from

const ITEMS = {
  // Potions
  "ride-a-pet-potion":  { name: "Ride-A-Pet Potion",  category: "potions",       rp: 1    },
  "fly-a-pet-potion":   { name: "Fly-A-Pet Potion",   category: "potions",       rp: 2    },
  "sugar-skull-potion": { name: "Sugar Skull Potion",  category: "potions",       rp: 4    },

  // Eggs
  "farm-egg":           { name: "Farm Egg",            category: "eggs",          rp: 15   },
  "aussie-egg":         { name: "Aussie Egg",          category: "eggs",          rp: 12   },
  "fossil-egg":         { name: "Fossil Egg",          category: "eggs",          rp: 8    },
  "jungle-egg":         { name: "Jungle Egg",          category: "eggs",          rp: 10   },
  "safari-egg":         { name: "Safari Egg",          category: "eggs",          rp: 18   },
  "ocean-egg":          { name: "Ocean Egg",           category: "eggs",          rp: 6    },

  // Pets — regular NP value
  "dragon":             { name: "Dragon",              category: "adopt_me_pets", rp: 3    },
  "unicorn":            { name: "Unicorn",             category: "adopt_me_pets", rp: 3    },
  "griffin":            { name: "Griffin",             category: "adopt_me_pets", rp: 2    },
  "turtle":             { name: "Turtle",              category: "adopt_me_pets", rp: 40   },
  "kangaroo":           { name: "Kangaroo",            category: "adopt_me_pets", rp: 35   },
  "monkey":             { name: "Monkey",              category: "adopt_me_pets", rp: 20   },
  "albino-monkey":      { name: "Albino Monkey",       category: "adopt_me_pets", rp: 25   },
  "parrot":             { name: "Parrot",              category: "adopt_me_pets", rp: 60   },
  "crow":               { name: "Crow",                category: "adopt_me_pets", rp: 50   },
  "owl":                { name: "Owl",                 category: "adopt_me_pets", rp: 75   },
  "arctic-reindeer":    { name: "Arctic Reindeer",     category: "adopt_me_pets", rp: 30   },
  "evil-unicorn":       { name: "Evil Unicorn",        category: "adopt_me_pets", rp: 150  },
  "bat-dragon":         { name: "Bat Dragon",          category: "adopt_me_pets", rp: 900  },
  "shadow-dragon":      { name: "Shadow Dragon",       category: "adopt_me_pets", rp: 700  },
  "frost-dragon":       { name: "Frost Dragon",        category: "adopt_me_pets", rp: 300  },
  "giraffe":            { name: "Giraffe",             category: "adopt_me_pets", rp: 450  },
  "dodo":               { name: "Dodo",                category: "adopt_me_pets", rp: 55   },
  "t-rex":              { name: "T-Rex",               category: "adopt_me_pets", rp: 45   },
  "axolotl":            { name: "Axolotl",             category: "adopt_me_pets", rp: 20   },
  "wolf":               { name: "Wolf",                category: "adopt_me_pets", rp: 5    },
  "capybara":           { name: "Capybara",            category: "adopt_me_pets", rp: 8    },
  "snow-owl":           { name: "Snow Owl",            category: "adopt_me_pets", rp: 35   },
};

// Potion multipliers on pet value
const POT_MULT = { none: 1.0, ride: 1.08, fly: 1.10, fly_ride: 1.15 };
// Variant multipliers (market doesn't follow perfect 4x/16x)
const VAR_MULT = { regular: 1.0, neon: 3.2, mega_neon: 10.0 };

function petRP(id, variant = "regular", potion = "none") {
  const base = ITEMS[id]?.rp || 1;
  return base * (VAR_MULT[variant] || 1) * (POT_MULT[potion] || 1);
}

function nonPetRP(id) {
  return ITEMS[id]?.rp || 1;
}

function item(id, opts = {}) {
  const meta = ITEMS[id];
  if (!meta) throw new Error(`Unknown item: ${id}`);
  const out = {
    type: meta.category === "adopt_me_pets" ? "pet" : meta.category === "eggs" ? "egg" : "potion",
    category: meta.category,
    id,
    name: meta.name,
    qty: opts.qty || 1,
  };
  if (meta.category === "adopt_me_pets") {
    out.variant = opts.variant || "regular";
    out.potion  = opts.potion  || "none";
  }
  return out;
}

// ── Realistic trade scenarios ─────────────────────────────────────────────
// Each trade is balanced within ~15% variance (real trades aren't perfect)
// Format: [sideA_items, sideB_items, confidence]

const TRADE_TEMPLATES = [
  // ── Potion trades ────────────────────────────────────────────
  // 2 ride pots for a fly pot (2 RP vs 2 RP)
  [[item("ride-a-pet-potion",{qty:2})], [item("fly-a-pet-potion")], "high"],
  // 3 ride pots for a fly pot + 1 ride (3 RP vs 3 RP)
  [[item("ride-a-pet-potion",{qty:3})], [item("fly-a-pet-potion"), item("ride-a-pet-potion")], "high"],
  // Sugar skull for 4 ride pots
  [[item("sugar-skull-potion")], [item("ride-a-pet-potion",{qty:4})], "medium"],
  // Fly pot + ride pot for sugar skull (3 RP vs 4 RP — slight overpay common)
  [[item("fly-a-pet-potion"), item("ride-a-pet-potion")], [item("sugar-skull-potion")], "medium"],

  // ── Egg trades ───────────────────────────────────────────────
  // Farm egg for Aussie egg + ride pot (15 vs 13)
  [[item("farm-egg")], [item("aussie-egg"), item("ride-a-pet-potion")], "high"],
  // Safari egg for farm egg + 3 ride pots (18 vs 18)
  [[item("safari-egg")], [item("farm-egg"), item("ride-a-pet-potion",{qty:3})], "high"],
  // Jungle egg + ride for fossil egg + aussie egg (11 vs 14 — common slight loss)
  [[item("jungle-egg"), item("ride-a-pet-potion")], [item("fossil-egg"), item("aussie-egg")], "medium"],
  // 2 ocean eggs for fossil egg (12 vs 8 — slight overpay)
  [[item("ocean-egg",{qty:2})], [item("fossil-egg")], "medium"],
  // Farm egg for 2 monkey + 5 ride pots (15 vs 45 — monkey is ~20 each)
  [[item("farm-egg")], [item("monkey"), item("ride-a-pet-potion",{qty:5})], "medium"],

  // ── Low-tier pet trades ──────────────────────────────────────
  // Axolotl for capybara + 12 ride pots (20 vs 20)
  [[item("axolotl")], [item("capybara"), item("ride-a-pet-potion",{qty:12})], "high"],
  // 3 wolves + fly pot for axolotl (17 vs 20 — slight under)
  [[item("wolf",{qty:3}), item("fly-a-pet-potion")], [item("axolotl")], "medium"],
  // Arctic reindeer for snow owl (30 vs 35 — slight under, common)
  [[item("arctic-reindeer")], [item("snow-owl")], "medium"],
  // 2 arctic reindeer for snow owl + 30 ride (60 vs 65 — fair)
  [[item("arctic-reindeer",{qty:2})], [item("snow-owl"), item("ride-a-pet-potion",{qty:30})], "high"],
  // Albino monkey + farm egg for crow (40 vs 50 — under)
  [[item("albino-monkey"), item("farm-egg")], [item("crow")], "medium"],
  // Monkey + 15 ride for albino monkey (35 vs 25 — slight over)
  [[item("monkey"), item("ride-a-pet-potion",{qty:15})], [item("albino-monkey")], "medium"],

  // ── Mid-tier pet trades ──────────────────────────────────────
  // T-rex + 5 fly for turtle (49 vs 40 — slight over)
  [[item("t-rex"), item("fly-a-pet-potion",{qty:5})], [item("turtle")], "medium"],
  // 2 crow for parrot (100 vs 60 — over, but common)
  [[item("crow",{qty:2})], [item("parrot")], "medium"],
  // Dodo + crow for parrot + 45 ride (105 vs 105)
  [[item("dodo"), item("crow")], [item("parrot"), item("ride-a-pet-potion",{qty:45})], "high"],
  // Owl for parrot + 15 ride (75 vs 75)
  [[item("owl")], [item("parrot"), item("ride-a-pet-potion",{qty:15})], "high"],
  // Owl + crow for 2 parrot (125 vs 120 — fair)
  [[item("owl"), item("crow")], [item("parrot",{qty:2})], "high"],
  // Kangaroo FR for turtle NP (38 vs 40 — fair)
  [[item("kangaroo",{potion:"fly_ride"})], [item("turtle")], "high"],
  // Turtle FR for owl NP (46 vs 75 — under, needs adds)
  [[item("turtle",{potion:"fly_ride"}), item("crow")], [item("owl")], "medium"],

  // ── FR pet trades ────────────────────────────────────────────
  // Parrot FR for owl NP (69 vs 75 — slight under, common)
  [[item("parrot",{potion:"fly_ride"})], [item("owl")], "medium"],
  // Owl FR for evil unicorn NP (86 vs 150 — needs big adds)
  [[item("owl",{potion:"fly_ride"}), item("parrot")], [item("evil-unicorn")], "medium"],
  // 2 owl FR for evil unicorn FR (172 vs 172)
  [[item("owl",{potion:"fly_ride",qty:2})], [item("evil-unicorn",{potion:"fly_ride"})], "high"],

  // ── High-tier pet trades ─────────────────────────────────────
  // Evil unicorn + owl for frost dragon NP (225 vs 300 — under, needs adds)
  [[item("evil-unicorn"), item("owl"), item("parrot")], [item("frost-dragon")], "medium"],
  // Frost dragon NP for evil unicorn FR + 100 ride (300 vs 272 — slight over)
  [[item("frost-dragon")], [item("evil-unicorn",{potion:"fly_ride"}), item("ride-a-pet-potion",{qty:100})], "medium"],
  // Frost dragon FR for frost dragon NP + 90 ride (345 vs 390 — slight under)
  [[item("frost-dragon",{potion:"fly_ride"})], [item("frost-dragon"), item("ride-a-pet-potion",{qty:90})], "high"],
  // 2 frost dragon for giraffe (600 vs 450 — over, shows demand premium)
  [[item("frost-dragon",{qty:2})], [item("giraffe")], "medium"],
  // Giraffe for frost dragon + owl + parrot (450 vs 435 — fair)
  [[item("giraffe")], [item("frost-dragon"), item("owl"), item("parrot")], "high"],
  // Shadow dragon for giraffe + frost dragon (700 vs 750 — slight under)
  [[item("shadow-dragon")], [item("giraffe"), item("frost-dragon")], "medium"],
  // Shadow dragon FR for giraffe FR + frost dragon (805 vs 967 — under, needs more)
  [[item("shadow-dragon",{potion:"fly_ride"}), item("owl")], [item("giraffe",{potion:"fly_ride"}), item("frost-dragon")], "medium"],
  // Bat dragon for shadow dragon + owl (900 vs 775 — fair demand premium)
  [[item("bat-dragon")], [item("shadow-dragon"), item("owl")], "high"],
  // Bat dragon for shadow dragon + giraffe (900 vs 1150 — under, needs adds)
  [[item("bat-dragon"), item("frost-dragon")], [item("shadow-dragon"), item("giraffe")], "medium"],
  // Bat dragon FR for bat dragon NP + 90 fly (1035 vs 1080 — fair)
  [[item("bat-dragon",{potion:"fly_ride"})], [item("bat-dragon"), item("fly-a-pet-potion",{qty:90})], "high"],

  // ── Neon trades ──────────────────────────────────────────────
  // Neon turtle for 3 regular turtle + adds (128 vs 135 — fair)
  [[item("turtle",{variant:"neon"})], [item("turtle",{qty:3}), item("owl")], "high"],
  // Neon owl for 3 owl + 15 ride (240 vs 240)
  [[item("owl",{variant:"neon"})], [item("owl",{qty:3}), item("ride-a-pet-potion",{qty:15})], "high"],
  // Neon frost dragon for 3 frost + 45 ride (960 vs 945 — fair)
  [[item("frost-dragon",{variant:"neon"})], [item("frost-dragon",{qty:3}), item("ride-a-pet-potion",{qty:45})], "high"],
  // Neon giraffe for 3 giraffe + adds (1440 vs 1395 — fair)
  [[item("giraffe",{variant:"neon"})], [item("giraffe",{qty:3}), item("frost-dragon")], "high"],
  // Neon shadow for shadow + giraffe + frost (2240 vs 1450 — demand premium, common)
  [[item("shadow-dragon",{variant:"neon"})], [item("shadow-dragon"), item("giraffe"), item("frost-dragon")], "medium"],

  // ── Mixed potion+variant trades ──────────────────────────────
  // FR frost dragon for NP frost + 90 ride (345 vs 390)
  [[item("frost-dragon",{potion:"fly_ride"})], [item("frost-dragon"), item("ride-a-pet-potion",{qty:90})], "high"],
  // NFR owl for NP owl + 85 fly (247 vs 245 — fair)
  [[item("owl",{variant:"neon",potion:"fly_ride"})], [item("owl",{variant:"neon"}), item("fly-a-pet-potion",{qty:85})], "high"],
  // No-pot shadow for FR shadow + 60 ride (700 vs 865 — collector premium on NP)
  [[item("shadow-dragon",{potion:"none"})], [item("shadow-dragon",{potion:"fly_ride"}), item("ride-a-pet-potion",{qty:60})], "medium"],

  // ── Egg + pet combos ─────────────────────────────────────────
  // Turtle + farm egg for owl (55 vs 75 — under, common)
  [[item("turtle"), item("farm-egg"), item("ride-a-pet-potion",{qty:5})], [item("owl")], "medium"],
  // Parrot + 3 farm egg for evil unicorn (105 vs 150 — needs more)
  [[item("parrot"), item("farm-egg",{qty:3}), item("ride-a-pet-potion",{qty:10})], [item("evil-unicorn")], "medium"],
  // Frost dragon + 5 farm egg for giraffe (375 vs 450 — under)
  [[item("frost-dragon"), item("farm-egg",{qty:5})], [item("giraffe")], "medium"],
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
const SOURCES = ["own_trade","own_trade","witnessed","reddit","discord"];

function randomDate() {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * 60));
  return d.toISOString().slice(0, 10);
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const params = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams;
  const pw = params.get("pw");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || pw !== expected) return json(403, { error: "Wrong password" });

  const db = supabaseAdmin();

  if (params.get("delete") === "true") {
    const { error } = await db.from("trade_records").delete().eq("notes", "__seeded_fake__");
    if (error) return json(500, { error: "Delete failed: " + error.message });
    return json(200, { deleted: true });
  }

  // Find a profile to log as
  const { data: member } = await db.from("profiles").select("id").eq("is_data_team_member", true).limit(1).maybeSingle();
  const { data: anyProfile } = !member ? await db.from("profiles").select("id").limit(1).maybeSingle() : { data: null };
  const loggedBy = member?.id || anyProfile?.id;
  if (!loggedBy) return json(400, { error: "No profiles found — sign up first" });

  let inserted = 0;
  const errors = [];

  for (const [sideA, sideB, confidence] of TRADE_TEMPLATES) {
    // Insert 2-3 variations of each template with slight noise
    const copies = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < copies; i++) {
      const { error } = await db.from("trade_records").insert({
        logged_by: loggedBy,
        trade_date: randomDate(),
        source: pick(SOURCES),
        confidence,
        notes: "__seeded_fake__",
        side_a: sideA,
        side_b: sideB,
        status: "active",
      });
      if (error) errors.push(error.message);
      else inserted++;
    }
  }

  return json(200, {
    inserted,
    templates: TRADE_TEMPLATES.length,
    errors: errors.length ? errors.slice(0, 5) : undefined,
    delete_url: "/.netlify/functions/admin-seed-trades?pw=YOUR_PW&delete=true",
  });
}

export const handler = safeHandler(handlerImpl);
