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
  if (!expected || pw !== expected) return json(403, { error: "Forbidden" });

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

  // Initialize values from anchor trades first -- find all single-item-vs-ride-pot trades
  // to bootstrap scale, then fill the rest with 10.0
  const values = {};
  for (const k of allKeys) values[k] = k === anchorKey ? ANCHOR_RP : 10.0;

  // Bootstrap pass: for any trade where one side is ONLY ride pots,
  // directly set the other side's implied value
  for (const r of trades) {
    const sideA = parseItems(r.side_a);
    const sideB = parseItems(r.side_b);
    const aIsOnlyAnchor = sideA.every(it => it.key === anchorKey);
    const bIsOnlyAnchor = sideB.every(it => it.key === anchorKey);

    if (aIsOnlyAnchor && sideB.length === 1) {
      const totalAnchor = sideA.reduce((s, it) => s + it.qty, 0);
      const it = sideB[0];
      values[it.key] = totalAnchor / it.qty;
    } else if (bIsOnlyAnchor && sideA.length === 1) {
      const totalAnchor = sideB.reduce((s, it) => s + it.qty, 0);
      const it = sideA[0];
      values[it.key] = totalAnchor / it.qty;
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
        // Dampen updates to avoid oscillation: 70% new estimate, 30% old
        newValues[key] = 0.85 * estimate + 0.15 * values[key];
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
  let written = 0;
  const writeErrors = [];

  for (const r of results) {
    const { error } = await db.from("item_values").upsert({
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
    }, { onConflict: "category,item_id,variant,potion,value_unit,source" });

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
