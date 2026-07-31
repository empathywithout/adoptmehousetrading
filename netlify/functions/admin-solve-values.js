// GET /.netlify/functions/admin-solve-values?pw=ADMIN_PASSWORD
// Runs the iterative RP value solver over all trade records
// and writes results to item_values table (source='computed')
// Optional: &dry=true to return results without writing to DB
// Optional: &exclude_fake=false to include seeded fake records (default: excluded)

import { supabaseAdmin, requireAdmin, json, safeHandler } from "./_lib/supabase.js";

const ANCHOR = { id: "ride-a-pet-potion", category: "potions", variant: null, potion: null };
const ANCHOR_RP = 1.0;

const ITERATIONS = 500;
const CONVERGENCE_THRESHOLD = 0.001;

// Confidence weights
const CONF_WEIGHT = { high: 1.0, medium: 0.7, low: 0.4 };
// Source weights
const SRC_WEIGHT = { own_trade: 1.0, site_confirmed: 1.2, witnessed: 0.8, reddit: 0.6, discord: 0.5 };
// Recency weight: trades from last 30 days get full weight, older decay
function recencyWeight(tradeDateStr) {
  const days = (Date.now() - new Date(tradeDateStr).getTime()) / 86400000;
  return Math.max(0.3, 1.0 - (days / 180));
}

function itemKey(item) {
  if (item.category === "adopt_me_pets") {
    return `${item.id}|${item.variant || "regular"}|${item.potion || "none"}`;
  }
  return `${item.id}|${item.category}`;
}

function parseItems(side) {
  if (!Array.isArray(side)) return [];
  return side.map(it => ({
    key: itemKey(it),
    id: it.id,
    category: it.category || (it.type === "pet" ? "adopt_me_pets" : it.type),
    variant: it.variant || null,
    potion: it.potion || null,
    qty: Math.max(1, parseInt(it.qty) || 1),
  }));
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const params = new URL(event.rawUrl || `http://x${event.path}?${event.rawQuery || ""}`).searchParams;
  const pw = params.get("pw");
  const expected = process.env.ADMIN_PASSWORD;
  // Support both query param (browser URL) and X-Admin-Password header (dashboard button)
  const headerPw = event.headers?.["x-admin-password"] || event.headers?.["X-Admin-Password"];
  if (!expected || (pw !== expected && headerPw !== expected)) return json(403, { error: "Forbidden" });

  const dryRun = params.get("dry") === "true";
  const excludeFake = params.get("exclude_fake") !== "false"; // default true

  const db = supabaseAdmin();

  // Load all active trade records
  const { data: records, error: recErr } = await db
    .from("trade_records")
    .select("id, trade_date, source, confidence, notes, side_a, side_b")
    .eq("status", "active")
    .limit(5000);

  if (recErr) return json(500, { error: recErr.message });

  const trades = (records || []).filter(r => !excludeFake || r.notes !== "__seeded_fake__");

  if (!trades.length) return json(200, { message: "No trade records found", values: {} });

  // ── Build item universe ───────────────────────────────────────────────────
  const allKeys = new Set();
  const anchorKey = itemKey({ id: ANCHOR.id, category: ANCHOR.category, variant: null, potion: null });

  for (const r of trades) {
    for (const it of [...parseItems(r.side_a), ...parseItems(r.side_b)]) {
      allKeys.add(it.key);
    }
  }

  // Initialize with known market priors (RP = ride pot = 1.0)
  // Solver refines from these starting points rather than discovering from scratch
  const PRIORS = {
    "ride-a-pet-potion|potions":           1,
    "fly-a-pet-potion|potions":            2,
    "sugar-skull-potion|potions":          4,
    "ocean-egg|eggs":                      6,
    "fossil-egg|eggs":                     8,
    "jungle-egg|eggs":                     10,
    "aussie-egg|eggs":                     12,
    "farm-egg|eggs":                       15,
    "safari-egg|eggs":                     18,
    "wolf|regular|none":          5,
    "dragon|regular|none":        3,
    "unicorn|regular|none":       3,
    "capybara|regular|none":      8,
    "axolotl|regular|none":       20,
    "monkey|regular|none":        20,
    "albino-monkey|regular|none": 25,
    "arctic-reindeer|regular|none": 30,
    "snow-owl|regular|none":      35,
    "kangaroo|regular|none":      35,
    "turtle|regular|none":        40,
    "t-rex|regular|none":         45,
    "crow|regular|none":          50,
    "dodo|regular|none":          55,
    "parrot|regular|none":        60,
    "owl|regular|none":           75,
    "evil-unicorn|regular|none":  150,
    "frost-dragon|regular|none":  300,
    "giraffe|regular|none":       450,
    "shadow-dragon|regular|none": 700,
    "bat-dragon|regular|none":    900,
  };
  const PM = { none: 1.0, ride: 1.08, fly: 1.10, fly_ride: 1.15 };
  const VM = { regular: 1.0, neon: 3.2, mega_neon: 10.0 };

  const values = {};
  for (const k of allKeys) {
    if (PRIORS[k] !== undefined) {
      values[k] = PRIORS[k];
    } else {
      const parts = k.split("|");
      if (parts.length === 4) {
        const baseKey = parts[0] + "|regular|none";
        const base = PRIORS[baseKey];
        values[k] = base ? base * (VM[parts[2]] || 1) * (PM[parts[3]] || 1) : 10.0;
      } else {
        values[k] = PRIORS[k] || 10.0;
      }
    }
  }

  // Bootstrap pass: for any trade where one side is ONLY anchors,
  // directly compute the other side's total implied value
  for (const r of trades) {
    const sideA = parseItems(r.side_a);
    const sideB = parseItems(r.side_b);
    const aIsOnlyAnchor = sideA.every(it => it.key === anchorKey);
    const bIsOnlyAnchor = sideB.every(it => it.key === anchorKey);
    const confW = CONF_WEIGHT[r.confidence] || 0.5;

    // One side is all anchors -- the other side's total value = anchor count
    if (aIsOnlyAnchor || bIsOnlyAnchor) {
      const anchorSide = aIsOnlyAnchor ? sideA : sideB;
      const otherSide = aIsOnlyAnchor ? sideB : sideA;
      const anchorTotal = anchorSide.reduce((s, it) => s + it.qty * ANCHOR_RP, 0);

      if (otherSide.length === 1) {
        // Single item on other side -- direct value
        const it = otherSide[0];
        if (it.key !== anchorKey) {
          const implied = anchorTotal / it.qty;
          // Weighted average with existing value
          values[it.key] = (values[it.key] * 0.3 + implied * 0.7 * confW + implied * 0.3) / (0.3 + confW * 0.7 + 0.3);
          values[it.key] = implied; // Just set directly for bootstrap
        }
      }
    }
  }

  // Second bootstrap pass: propagate from known values one hop
  for (let pass = 0; pass < 10; pass++) {
    for (const r of trades) {
      const sideA = parseItems(r.side_a);
      const sideB = parseItems(r.side_b);
      // If all items on one side have known (non-default) values, estimate unknowns on other side
      const knownKeys = new Set([anchorKey, ...Object.entries(values).filter(([k,v]) => v !== 10.0).map(([k]) => k)]);
      const aAllKnown = sideA.every(it => knownKeys.has(it.key));
      const bAllKnown = sideB.every(it => knownKeys.has(it.key));
      if (aAllKnown && !bAllKnown && sideB.filter(it => !knownKeys.has(it.key)).length === 1) {
        const sumA = sideA.reduce((s, it) => s + it.qty * values[it.key], 0);
        const knownB = sideB.filter(it => knownKeys.has(it.key)).reduce((s, it) => s + it.qty * values[it.key], 0);
        const unknown = sideB.find(it => !knownKeys.has(it.key));
        values[unknown.key] = Math.max(0.01, (sumA - knownB) / unknown.qty);
        knownKeys.add(unknown.key);
      }
      if (bAllKnown && !aAllKnown && sideA.filter(it => !knownKeys.has(it.key)).length === 1) {
        const sumB = sideB.reduce((s, it) => s + it.qty * values[it.key], 0);
        const knownA = sideA.filter(it => knownKeys.has(it.key)).reduce((s, it) => s + it.qty * values[it.key], 0);
        const unknown = sideA.find(it => !knownKeys.has(it.key));
        values[unknown.key] = Math.max(0.01, (sumB - knownA) / unknown.qty);
        knownKeys.add(unknown.key);
      }
    }
  }

  // ── Build trade constraints ───────────────────────────────────────────────
  // Each trade is: sum(qty * value[item]) side_a == sum(qty * value[item]) side_b
  // Weight = confidence * source * recency
  const constraints = trades.map(r => {
    const sideA = parseItems(r.side_a);
    const sideB = parseItems(r.side_b);
    const weight = (CONF_WEIGHT[r.confidence] || 0.5)
                 * (SRC_WEIGHT[r.source] || 0.5)
                 * recencyWeight(r.trade_date);
    return { sideA, sideB, weight };
  }).filter(c => c.sideA.length && c.sideB.length);

  // ── Iterative solver ──────────────────────────────────────────────────────
  // For each non-anchor item, estimate its value from all trades containing it:
  //   implied_value = (sum of other side) / qty_of_this_item
  // Weighted average of all such estimates.

  let maxDelta = Infinity;
  let iters = 0;

  while (iters < ITERATIONS && maxDelta > CONVERGENCE_THRESHOLD) {
    const newValues = { ...values };
    maxDelta = 0;

    for (const key of allKeys) {
      if (key === anchorKey) continue; // anchor is fixed
      if (PRIORS[key] !== undefined) continue; // known market values are fixed priors -- don't move them

      let weightedSum = 0;
      let totalWeight = 0;

      for (const { sideA, sideB, weight } of constraints) {
        // Check if this item appears on side A
        const aItems = sideA.filter(it => it.key === key);
        const bItems = sideB.filter(it => it.key === key);

        if (aItems.length === 0 && bItems.length === 0) continue;

        // If on side A: implied = (sum B value - sum of other A items) / qty_A
        if (aItems.length > 0) {
          const qtyA = aItems.reduce((s, it) => s + it.qty, 0);
          const sumB = sideB.reduce((s, it) => s + it.qty * (values[it.key] || 1), 0);
          const sumOtherA = sideA.filter(it => it.key !== key).reduce((s, it) => s + it.qty * (values[it.key] || 1), 0);
          const implied = (sumB - sumOtherA) / qtyA;
          if (implied > 0) {
            weightedSum += weight * implied;
            totalWeight += weight;
          }
        }

        // If on side B: implied = (sum A value - sum of other B items) / qty_B
        if (bItems.length > 0) {
          const qtyB = bItems.reduce((s, it) => s + it.qty, 0);
          const sumA = sideA.reduce((s, it) => s + it.qty * (values[it.key] || 1), 0);
          const sumOtherB = sideB.filter(it => it.key !== key).reduce((s, it) => s + it.qty * (values[it.key] || 1), 0);
          const implied = (sumA - sumOtherB) / qtyB;
          if (implied > 0) {
            weightedSum += weight * implied;
            totalWeight += weight;
          }
        }
      }

      if (totalWeight > 0) {
        const estimate = weightedSum / totalWeight;
        // Heavy damping -- 30% new estimate, 70% old to prevent divergence
        const rawNew = 0.30 * estimate + 0.70 * values[key];
        // Sanity cap: value can't exceed 10x the highest known prior
        const maxAllowed = 900 * 12; // bat dragon * MN multiplier
        newValues[key] = Math.min(maxAllowed, Math.max(0.01, rawNew));
        maxDelta = Math.max(maxDelta, Math.abs(newValues[key] - values[key]));
      }
    }

    Object.assign(values, newValues);
    iters++;
  }

  // ── Build output ──────────────────────────────────────────────────────────
  // Count how many trades each item appeared in (sample size)
  const sampleCounts = {};
  const impliedRanges = {}; // track variance for value_low/value_high

  for (const { sideA, sideB, weight } of constraints) {
    for (const it of [...sideA, ...sideB]) {
      sampleCounts[it.key] = (sampleCounts[it.key] || 0) + 1;
    }
  }

  // Compute value_low/value_high as ±15% of solved value (tighten with more samples)
  const results = [];
  for (const [key, val] of Object.entries(values)) {
    if (val <= 0 || !isFinite(val)) continue;
    const samples = sampleCounts[key] || 0;
    const variance = Math.max(0.05, 0.20 - (samples * 0.005)); // narrows with more data
    const parts = key.split("|");
    const id = parts[0];
    const category = parts.length === 3 ? "adopt_me_pets" : parts[1];
    const variant = parts.length === 3 ? parts[1] : null;
    const potion  = parts.length === 3 ? parts[2] : null;

    results.push({
      key,
      id,
      category,
      variant: variant === "null" ? null : variant,
      potion:  potion  === "null" ? null : potion,
      value_rp: Math.round(val * 100) / 100,
      value_low:  Math.round(val * (1 - variance) * 100) / 100,
      value_high: Math.round(val * (1 + variance) * 100) / 100,
      sample_size: samples,
    });
  }

  results.sort((a, b) => b.value_rp - a.value_rp);

  if (dryRun) {
    return json(200, {
      iterations: iters,
      converged: maxDelta <= CONVERGENCE_THRESHOLD,
      max_delta: Math.round(maxDelta * 10000) / 10000,
      trade_count: trades.length,
      constraint_count: constraints.length,
      items_solved: results.length,
      values: results.slice(0, 50), // top 50 for preview
    });
  }

  // ── Write to DB ───────────────────────────────────────────────────────────
  // Delete all existing computed values then insert fresh
  const { error: delErr } = await db.from("item_values").delete().eq("source", "computed");
  if (delErr) return json(500, { error: "Failed to clear old computed values: " + delErr.message });

  let written = 0;
  const writeErrors = [];

  for (const r of results) {
    const { error } = await db.from("item_values").insert({
      category: r.category,
      item_id: r.id,
      variant: r.variant,
      potion: r.potion,
      value_unit: "rp",
      source: "computed",
      value_low: r.value_low,
      value_high: r.value_high,
      sample_size: r.sample_size,
      updated_at: new Date().toISOString(),
    });

    if (error) writeErrors.push(`${r.id}: ${error.message}`);
    else written++;
  }

  return json(200, {
    iterations: iters,
    converged: maxDelta <= CONVERGENCE_THRESHOLD,
    trade_count: trades.length,
    items_solved: results.length,
    written,
    write_errors: writeErrors.length ? writeErrors.slice(0, 5) : undefined,
    top_values: results.slice(0, 20),
  });
}

export const handler = safeHandler(handlerImpl);
