// ONE-TIME SEED — delete after use
// GET /.netlify/functions/admin-seed-trades?pw=ADMIN_PASSWORD
// Seeds realistic trade records respecting Adopt Me's 18-item-per-side limit
// Max 18 unique item slots per side, no stacking of identical items
// DELETE: same URL with &delete=true

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

// ── Realistic RP values (Ride Pot = 1.0) ─────────────────────────────────
const RP = {
  // Potions (standalone tradeable)
  "ride-a-pet-potion":  { name: "Ride-A-Pet Potion",  cat: "potions",       rp: 1    },
  "fly-a-pet-potion":   { name: "Fly-A-Pet Potion",   cat: "potions",       rp: 2    },
  "sugar-skull-potion": { name: "Sugar Skull Potion",  cat: "potions",       rp: 4    },

  // Eggs
  "farm-egg":           { name: "Farm Egg",            cat: "eggs",          rp: 15   },
  "aussie-egg":         { name: "Aussie Egg",          cat: "eggs",          rp: 12   },
  "fossil-egg":         { name: "Fossil Egg",          cat: "eggs",          rp: 8    },
  "jungle-egg":         { name: "Jungle Egg",          cat: "eggs",          rp: 10   },
  "safari-egg":         { name: "Safari Egg",          cat: "eggs",          rp: 18   },
  "ocean-egg":          { name: "Ocean Egg",           cat: "eggs",          rp: 6    },

  // Pets
  "wolf":               { name: "Wolf",                cat: "adopt_me_pets", rp: 5    },
  "dragon":             { name: "Dragon",              cat: "adopt_me_pets", rp: 3    },
  "unicorn":            { name: "Unicorn",             cat: "adopt_me_pets", rp: 3    },
  "capybara":           { name: "Capybara",            cat: "adopt_me_pets", rp: 8    },
  "axolotl":            { name: "Axolotl",             cat: "adopt_me_pets", rp: 20   },
  "monkey":             { name: "Monkey",              cat: "adopt_me_pets", rp: 20   },
  "albino-monkey":      { name: "Albino Monkey",       cat: "adopt_me_pets", rp: 25   },
  "arctic-reindeer":    { name: "Arctic Reindeer",     cat: "adopt_me_pets", rp: 30   },
  "snow-owl":           { name: "Snow Owl",            cat: "adopt_me_pets", rp: 35   },
  "turtle":             { name: "Turtle",              cat: "adopt_me_pets", rp: 40   },
  "kangaroo":           { name: "Kangaroo",            cat: "adopt_me_pets", rp: 35   },
  "t-rex":              { name: "T-Rex",               cat: "adopt_me_pets", rp: 45   },
  "dodo":               { name: "Dodo",                cat: "adopt_me_pets", rp: 55   },
  "crow":               { name: "Crow",                cat: "adopt_me_pets", rp: 50   },
  "parrot":             { name: "Parrot",              cat: "adopt_me_pets", rp: 60   },
  "owl":                { name: "Owl",                 cat: "adopt_me_pets", rp: 75   },
  "evil-unicorn":       { name: "Evil Unicorn",        cat: "adopt_me_pets", rp: 150  },
  "frost-dragon":       { name: "Frost Dragon",        cat: "adopt_me_pets", rp: 300  },
  "giraffe":            { name: "Giraffe",             cat: "adopt_me_pets", rp: 450  },
  "shadow-dragon":      { name: "Shadow Dragon",       cat: "adopt_me_pets", rp: 700  },
  "bat-dragon":         { name: "Bat Dragon",          cat: "adopt_me_pets", rp: 900  },
};

const POT_MULT = { none: 1.0, ride: 1.08, fly: 1.10, fly_ride: 1.15 };
const VAR_MULT = { regular: 1.0, neon: 3.2, mega_neon: 10.0 };

// Build a trade item
function pet(id, variant, potion) {
  const m = RP[id]; if (!m) throw new Error("Unknown: " + id);
  return { type: "pet", category: "adopt_me_pets", id, name: m.name, qty: 1, variant: variant||"regular", potion: potion||"none" };
}
function egg(id) {
  const m = RP[id]; if (!m) throw new Error("Unknown: " + id);
  return { type: "egg", category: "eggs", id, name: m.name, qty: 1 };
}
function pot(id) {
  const m = RP[id]; if (!m) throw new Error("Unknown: " + id);
  return { type: "potion", category: "potions", id, name: m.name, qty: 1 };
}

// ── Realistic trade templates ─────────────────────────────────────────────
// All respect 18-item max per side. No stacking.
// Potions used as individual adds (1 slot each), max a few per side.

const TRADES = [
  // ── Potion-only trades ────────────────────────────────────────────────
  // 2 fly pots for sugar skull (4 vs 4)
  [[pot("fly-a-pet-potion"), pot("fly-a-pet-potion")], [pot("sugar-skull-potion")], "high"],
  // Sugar skull + ride for 3 fly (5 vs 6 -- slight under)
  [[pot("sugar-skull-potion"), pot("ride-a-pet-potion")], [pot("fly-a-pet-potion"), pot("fly-a-pet-potion"), pot("fly-a-pet-potion")], "medium"],

  // ── Egg trades ────────────────────────────────────────────────────────
  // Farm for Aussie + Ocean (15 vs 18 -- slight under)
  [[egg("farm-egg")], [egg("aussie-egg"), egg("ocean-egg")], "high"],
  // Safari for Farm + Jungle (18 vs 25 -- needs adds)
  [[egg("safari-egg")], [egg("farm-egg"), egg("jungle-egg")], "medium"],
  // 2 Ocean for Fossil (12 vs 8 -- over, common)
  [[egg("ocean-egg"), egg("ocean-egg")], [egg("fossil-egg")], "medium"],
  // Jungle + Fossil for Safari (18 vs 18)
  [[egg("jungle-egg"), egg("fossil-egg")], [egg("safari-egg")], "high"],
  // Aussie + fly pot for Farm + ride pot (14 vs 16 -- slight under)
  [[egg("aussie-egg"), pot("fly-a-pet-potion")], [egg("farm-egg"), pot("ride-a-pet-potion")], "medium"],

  // ── Low-tier pet trades ───────────────────────────────────────────────
  // Axolotl for monkey + capybara + fly pot (20 vs 30 -- under)
  [[pet("axolotl")], [pet("monkey"), pet("capybara"), pot("fly-a-pet-potion")], "medium"],
  // Arctic reindeer for snow owl (30 vs 35 -- slight under, common)
  [[pet("arctic-reindeer")], [pet("snow-owl")], "medium"],
  // Arctic reindeer + fly for snow owl + ride (32 vs 36 -- fair)
  [[pet("arctic-reindeer"), pot("fly-a-pet-potion")], [pet("snow-owl"), pot("ride-a-pet-potion")], "high"],
  // 2 arctic reindeer for snow owl + turtle (60 vs 75 -- under)
  [[pet("arctic-reindeer"), pet("arctic-reindeer")], [pet("snow-owl"), pet("turtle")], "medium"],
  // Kangaroo FR for turtle NP (40 vs 40 -- fair)
  [[pet("kangaroo", "regular", "fly_ride")], [pet("turtle")], "high"],
  // Turtle FR for owl NP (46 vs 75 -- under, needs adds)
  [[pet("turtle", "regular", "fly_ride"), pet("crow")], [pet("owl")], "medium"],
  // Albino monkey + farm egg for crow (40 vs 50 -- under)
  [[pet("albino-monkey"), egg("farm-egg")], [pet("crow")], "medium"],
  // 2 crow for parrot + fly pot (100 vs 62 -- over)
  [[pet("crow"), pet("crow")], [pet("parrot"), pot("fly-a-pet-potion")], "medium"],

  // ── Mid-tier pet trades ───────────────────────────────────────────────
  // Dodo + crow for parrot + sugar skull (105 vs 64 -- over, shows demand)
  [[pet("dodo"), pet("crow")], [pet("parrot"), pot("sugar-skull-potion")], "medium"],
  // Owl for parrot + dodo (75 vs 115 -- under, common lowball)
  [[pet("owl")], [pet("parrot"), pet("dodo")], "medium"],
  // Owl for parrot + crow + fly pot (75 vs 112 -- fair-ish)
  [[pet("owl")], [pet("parrot"), pet("crow"), pot("fly-a-pet-potion")], "high"],
  // Parrot FR for owl NP (69 vs 75 -- slight under)
  [[pet("parrot", "regular", "fly_ride")], [pet("owl")], "medium"],
  // 2 owl for evil unicorn + farm egg (150 vs 165 -- fair)
  [[pet("owl"), pet("owl")], [pet("evil-unicorn"), egg("farm-egg")], "high"],

  // ── FR/potion pet trades ──────────────────────────────────────────────
  // Frost dragon NP for evil unicorn + owl + parrot (300 vs 285 -- fair)
  [[pet("frost-dragon")], [pet("evil-unicorn"), pet("owl"), pet("parrot")], "high"],
  // Frost dragon NP for 2 evil unicorn (300 vs 300 -- exact)
  [[pet("frost-dragon")], [pet("evil-unicorn"), pet("evil-unicorn")], "high"],
  // Frost dragon FR for frost dragon NP + fly pot (345 vs 302 -- fair)
  [[pet("frost-dragon", "regular", "fly_ride")], [pet("frost-dragon"), pot("fly-a-pet-potion")], "high"],
  // Giraffe for frost dragon + owl + parrot (450 vs 435 -- fair)
  [[pet("giraffe")], [pet("frost-dragon"), pet("owl"), pet("parrot")], "high"],
  // Giraffe for frost dragon + 2 owl (450 vs 450 -- exact)
  [[pet("giraffe")], [pet("frost-dragon"), pet("owl"), pet("owl")], "high"],
  // 2 frost dragon for giraffe (600 vs 450 -- over, demand premium)
  [[pet("frost-dragon"), pet("frost-dragon")], [pet("giraffe")], "medium"],
  // Shadow dragon for giraffe + frost dragon + owl (700 vs 825 -- under)
  [[pet("shadow-dragon")], [pet("giraffe"), pet("frost-dragon"), pet("owl")], "medium"],
  // Shadow dragon for giraffe + frost dragon (700 vs 750 -- slight under)
  [[pet("shadow-dragon")], [pet("giraffe"), pet("frost-dragon")], "medium"],
  // Shadow dragon FR for shadow dragon NP + fly pot (805 vs 302 -- wrong, use pets)
  [[pet("shadow-dragon", "regular", "fly_ride")], [pet("shadow-dragon"), pet("parrot"), pot("fly-a-pet-potion")], "high"],
  // Bat dragon for shadow dragon + giraffe (900 vs 1150 -- under, needs adds)
  [[pet("bat-dragon")], [pet("shadow-dragon"), pet("giraffe")], "medium"],
  // Bat dragon for shadow dragon + owl + parrot (900 vs 835 -- fair)
  [[pet("bat-dragon")], [pet("shadow-dragon"), pet("owl"), pet("parrot")], "high"],
  // Bat dragon FR for bat dragon NP + fly pot + parrot (1035 vs 962 -- fair)
  [[pet("bat-dragon", "regular", "fly_ride")], [pet("bat-dragon"), pot("fly-a-pet-potion"), pet("parrot")], "high"],

  // ── Neon trades ───────────────────────────────────────────────────────
  // Neon turtle for 3 regular turtle + fly pot (128 vs 122 -- fair)
  [[pet("turtle", "neon")], [pet("turtle"), pet("turtle"), pet("turtle"), pot("fly-a-pet-potion")], "high"],
  // Neon owl for 3 owl + crow (240 vs 275 -- fair)
  [[pet("owl", "neon")], [pet("owl"), pet("owl"), pet("owl"), pet("crow")], "high"],
  // Neon frost dragon for 3 frost + owl (960 vs 975 -- fair)
  [[pet("frost-dragon", "neon")], [pet("frost-dragon"), pet("frost-dragon"), pet("frost-dragon"), pet("owl")], "high"],
  // Neon giraffe for 3 giraffe + frost dragon (1440 vs 1650 -- under)
  [[pet("giraffe", "neon")], [pet("giraffe"), pet("giraffe"), pet("giraffe"), pet("frost-dragon")], "medium"],
  // Neon shadow dragon for shadow dragon + giraffe + frost dragon + owl (2240 vs 1525 -- demand premium)
  [[pet("shadow-dragon", "neon")], [pet("shadow-dragon"), pet("giraffe"), pet("frost-dragon"), pet("owl")], "medium"],

  // ── Mixed variant + potion trades ────────────────────────────────────
  // Frost dragon FR for frost dragon NP + crow + fly pot (345 vs 352 -- fair)
  [[pet("frost-dragon", "regular", "fly_ride")], [pet("frost-dragon"), pet("crow"), pot("fly-a-pet-potion")], "high"],
  // NFR owl for neon owl + fly pot (247 vs 242 -- fair)
  [[pet("owl", "neon", "fly_ride")], [pet("owl", "neon"), pot("fly-a-pet-potion")], "high"],
  // No-pot shadow for FR shadow + crow (700 vs 855 -- collector premium on NP)
  [[pet("shadow-dragon")], [pet("shadow-dragon", "regular", "fly_ride"), pet("crow")], "medium"],

  // ── Egg + pet combos ─────────────────────────────────────────────────
  // Turtle + farm egg + fly pot for owl (57 vs 75 -- under)
  [[pet("turtle"), egg("farm-egg"), pot("fly-a-pet-potion")], [pet("owl")], "medium"],
  // Parrot + 3 farm eggs for evil unicorn (105 vs 105 -- exact)
  [[pet("parrot"), egg("farm-egg"), egg("farm-egg"), egg("farm-egg")], [pet("evil-unicorn")], "high"],
  // Frost dragon + 3 farm eggs for giraffe + owl (345 vs 525 -- under)
  [[pet("frost-dragon"), egg("farm-egg"), egg("farm-egg"), egg("farm-egg")], [pet("giraffe"), pet("owl")], "medium"],
  // Giraffe + crow for shadow dragon (500 vs 700 -- under, common)
  [[pet("giraffe"), pet("crow")], [pet("shadow-dragon")], "medium"],
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
  if (!process.env.ADMIN_PASSWORD || pw !== process.env.ADMIN_PASSWORD) return json(403, { error: "Wrong password" });

  const db = supabaseAdmin();

  if (params.get("delete") === "true") {
    const { error } = await db.from("trade_records").delete().eq("notes", "__seeded_fake__");
    if (error) return json(500, { error: "Delete failed: " + error.message });
    return json(200, { deleted: true });
  }

  const { data: member } = await db.from("profiles").select("id").eq("is_data_team_member", true).limit(1).maybeSingle();
  const { data: anyProfile } = !member ? await db.from("profiles").select("id").limit(1).maybeSingle() : { data: null };
  const loggedBy = member?.id || anyProfile?.id;
  if (!loggedBy) return json(400, { error: "No profiles found" });

  let inserted = 0;
  const errors = [];

  for (const [sideA, sideB, confidence] of TRADES) {
    // Validate 18 item limit
    if (sideA.length > 18 || sideB.length > 18) {
      errors.push("Trade exceeds 18 items: " + JSON.stringify(sideA.map(i=>i.name)));
      continue;
    }
    // Insert 2 copies of each template
    for (let i = 0; i < 2; i++) {
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
    templates: TRADES.length,
    errors: errors.length ? errors.slice(0, 5) : undefined,
    delete_url: "/.netlify/functions/admin-seed-trades?pw=YOUR_PW&delete=true",
  });
}

export const handler = safeHandler(handlerImpl);
