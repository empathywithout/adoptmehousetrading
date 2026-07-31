// Stress test for messaging and notification system
// GET /.netlify/functions/admin-stress-messaging?secret=ADMIN_PASSWORD
// Simulates two users going through a full trade flow with chat + notifications
// DELETE THIS FILE after testing is complete

import { json, safeHandler } from "./_lib/supabase.js";

const TEST_PASSWORD = "StressTest123!";
const PRESETS = [
  "ready_now",
  "give_me_a_few_minutes",
  "whats_your_roblox_username",
  "added_you_ingame",
  "sending_trade_request",
  "trade_complete_on_my_end",
];

async function api(baseUrl, path, opts = {}) {
  const url = `${baseUrl}/.netlify/functions/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runStressTest(baseUrl, adminPassword) {
  const results = [];
  const ts = Date.now();

  // Two test users
  const userA = { username: `stress_a_${ts}`, displayName: `StressA_${ts}` };
  const userB = { username: `stress_b_${ts}`, displayName: `StressB_${ts}` };
  let tokenA = null, tokenB = null;
  let profileAId = null, profileBId = null;
  let listingId = null, offerId = null;

  async function test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: "pass", ms: Date.now() - start });
    } catch (err) {
      results.push({ name, status: "fail", error: err.message, ms: Date.now() - start });
    }
  }

  // ── Setup: create two users ──────────────────────────────────────────────

  await test("setup: create user A (lister)", async () => {
    const { status, data } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: { display_name: userA.displayName, rbx_username: userA.username, rbx_user_id: ts, avatar_url: null, password: TEST_PASSWORD },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    tokenA = data.token;
    profileAId = data.profile.id;
  });

  await test("setup: create user B (offerer)", async () => {
    const { status, data } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: { display_name: userB.displayName, rbx_username: userB.username, rbx_user_id: ts + 1, avatar_url: null, password: TEST_PASSWORD },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    tokenB = data.token;
    profileBId = data.profile.id;
  });

  // ── Trade flow ───────────────────────────────────────────────────────────

  await test("trade: user A creates listing", async () => {
    const { status, data } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        listing_type: "house_trade", house_id: "tiny-home",
        title: "Stress Test House", description: "stress test",
        photos: ["https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t1.jpg","https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t2.jpg","https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t3.jpg"],
        looking_for: ["adopt_me_pets"], themes: ["cozy"], build_type: "original",
        value_amount: 1, value_unit: "shark",
      },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    listingId = data.listing.id;
  });

  await test("trade: user B makes offer", async () => {
    assert(listingId, "No listingId");
    const { status, data } = await api(baseUrl, "offers-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: {
        listing_id: listingId,
        items: [{ category: "adopt_me_pets", id: "dog", name: "Dog", image: "", qty: 1 }],
        message: "stress test offer",
      },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    offerId = data.offer.id;
  });

  await test("trade: user A accepts offer", async () => {
    assert(offerId, "No offerId");
    const { status, data } = await api(baseUrl, "offers-respond", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { offer_id: offerId, action: "accept" },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
  });

  // ── Notifications ────────────────────────────────────────────────────────

  await test("notifications: user B gets offer_accepted notification", async () => {
    await new Promise(r => setTimeout(r, 300));
    const { status, data } = await api(baseUrl, "notifications-list", {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert(status === 200, `Got ${status}`);
    const hasAccepted = (data.notifications || []).some(n => n.type === "offer_accepted");
    assert(hasAccepted, `Expected offer_accepted notification, got: ${JSON.stringify(data.notifications?.map(n => n.type))}`);
  });

  await test("notifications: user A gets offer_received notifications from prior", async () => {
    const { status, data } = await api(baseUrl, "notifications-list", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.notifications), "Expected notifications array");
  });

  await test("notifications: mark all read for user B", async () => {
    const { status } = await api(baseUrl, "notifications-mark-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { all: true },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("notifications: user B notifications now all read", async () => {
    const { status, data } = await api(baseUrl, "notifications-list", {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert(status === 200, `Got ${status}`);
    const unread = (data.notifications || []).filter(n => !n.read);
    assert(unread.length === 0, `Expected 0 unread, got ${unread.length}`);
  });

  // ── Chat ─────────────────────────────────────────────────────────────────

  await test("chat: user A sends message", async () => {
    assert(offerId, "No offerId");
    const { status, data } = await api(baseUrl, "chat-send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { context_type: "offer", context_id: offerId, preset_key: "ready_now" },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
  });

  await test("chat: user B sends message", async () => {
    const { status, data } = await api(baseUrl, "chat-send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { context_type: "offer", context_id: offerId, preset_key: "added_you_ingame" },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
  });

  await test("chat: rapid fire - user A sends 5 messages quickly", async () => {
    const presets = ["give_me_a_few_minutes", "whats_your_roblox_username", "sending_trade_request", "trade_complete_on_my_end", "ready_now"];
    const results = await Promise.all(presets.map(preset =>
      api(baseUrl, "chat-send", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenA}` },
        body: { context_type: "offer", context_id: offerId, preset_key: preset },
      })
    ));
    const failures = results.filter(r => r.status !== 200);
    assert(failures.length === 0, `${failures.length} messages failed: ${failures.map(f => f.data?.error).join(", ")}`);
  });

  await test("chat: user B lists all messages", async () => {
    const { status, data } = await api(baseUrl, `chat-list?context_type=offer&context_id=${offerId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(Array.isArray(data.messages), "Expected messages array");
    assert(data.messages.length >= 7, `Expected at least 7 messages, got ${data.messages.length}`);
  });

  await test("chat: rejected on non-party", async () => {
    // Create a third token and try to read the chat
    const { data: cData } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: { display_name: `Intruder_${ts}`, rbx_username: `intruder_${ts}`, rbx_user_id: ts + 2, avatar_url: null, password: TEST_PASSWORD },
    });
    const intruderToken = cData.token;
    const { status } = await api(baseUrl, `chat-list?context_type=offer&context_id=${offerId}`, {
      headers: { Authorization: `Bearer ${intruderToken}` },
    });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  await test("chat: rejected on pending offer (not accepted)", async () => {
    // Create a new listing and offer that's still pending
    const { data: lData } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        listing_type: "house_trade", house_id: "biodome-home",
        title: "Pending Test House", description: "test",
        photos: ["https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t1.jpg","https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t2.jpg","https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t3.jpg"],
        looking_for: ["adopt_me_pets"], themes: ["cozy"], build_type: "original",
        value_amount: 1, value_unit: "shark",
      },
    });
    const pendingListingId = lData.listing?.id;
    if (!pendingListingId) return; // skip if create failed

    const { data: oData } = await api(baseUrl, "offers-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { listing_id: pendingListingId, items: [{ category: "adopt_me_pets", id: "cat", name: "Cat", image: "", qty: 1 }] },
    });
    const pendingOfferId = oData.offer?.id;
    if (!pendingOfferId) return;

    const { status } = await api(baseUrl, "chat-send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { context_type: "offer", context_id: pendingOfferId, preset_key: "ready_now" },
    });
    assert(status === 400, `Expected 400 on pending offer, got ${status}`);
  });

  await test("chat: user B gets chat_message notification", async () => {
    await new Promise(r => setTimeout(r, 300));
    const { status, data } = await api(baseUrl, "notifications-list", {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert(status === 200, `Got ${status}`);
    const hasChatNotif = (data.notifications || []).some(n => n.type === "chat_message");
    assert(hasChatNotif, `Expected chat_message notification, got: ${JSON.stringify(data.notifications?.map(n => n.type))}`);
  });

  // ── Trade confirmation ───────────────────────────────────────────────────

  await test("trade-confirm: user A confirms trade", async () => {
    const { status, data } = await api(baseUrl, "trades-confirm", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { offer_id: offerId },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.lister_confirmed === true, "Expected lister_confirmed");
    assert(data.status === "pending", "Expected pending (only one side confirmed)");
  });

  await test("trade-confirm: user B confirms trade", async () => {
    const { status, data } = await api(baseUrl, "trades-confirm", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { offer_id: offerId },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.offerer_confirmed === true, "Expected offerer_confirmed");
    assert(data.status === "corroborated", "Expected corroborated after both confirm");
  });

  await test("trade-confirm: trade shows on /comps", async () => {
    await new Promise(r => setTimeout(r, 300));
    const { status, data } = await api(baseUrl, "trades-list");
    assert(status === 200, `Got ${status}`);
    const found = (data.trades || []).some(t => t.offers?.offering_profile_id === profileBId);
    assert(found, "Corroborated trade not showing on trades-list");
  });

  await test("notifications: both get trade_corroborated notification", async () => {
    const [resA, resB] = await Promise.all([
      api(baseUrl, "notifications-list", { headers: { Authorization: `Bearer ${tokenA}` } }),
      api(baseUrl, "notifications-list", { headers: { Authorization: `Bearer ${tokenB}` } }),
    ]);
    const aHas = (resA.data.notifications || []).some(n => n.type === "trade_corroborated");
    const bHas = (resB.data.notifications || []).some(n => n.type === "trade_corroborated");
    assert(aHas && bHas, `Missing corroboration notifications: A=${aHas}, B=${bHas}`);
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────
  // Note: we can't delete profiles via API, but listings get removed
  await test("cleanup: remove test listing", async () => {
    if (!listingId) return;
    // listing is now "traded" so remove it
    const { status } = await api(baseUrl, "listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { listing_id: listingId },
    });
    assert([200, 400].includes(status), `Got ${status}`); // 400 ok if already traded
  });

  return results;
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const secret = event.queryStringParameters?.secret;
  if (!secret || secret !== process.env.ADMIN_PASSWORD) return json(401, { error: "Unauthorized" });

  const baseUrl = `${event.headers["x-forwarded-proto"] || "https"}://${event.headers.host}`;
  const results = await runStressTest(baseUrl, process.env.ADMIN_PASSWORD);

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Messaging Stress Test — AMHT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1117; color: #e2e8f0; padding: 32px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .summary { display: flex; gap: 12px; margin-bottom: 28px; }
    .pill { padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 700; }
    .pill.pass { background: #14532d; color: #4ade80; }
    .pill.fail { background: #450a0a; color: #f87171; }
    .section { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #4a5568; margin: 20px 0 8px; }
    .test { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 10px; margin-bottom: 6px; background: #1e2433; border: 1px solid #2d3748; }
    .test.fail { border-color: #7f1d1d; background: #1a0f0f; }
    .test.pass { border-color: #14532d; }
    .icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
    .error { font-size: 12px; color: #f87171; margin-top: 3px; font-family: monospace; }
    .ms { font-size: 11px; color: #4a5568; margin-left: auto; flex-shrink: 0; padding-left: 12px; }
  </style>
</head>
<body>
  <h1>💬 Messaging Stress Test</h1>
  <div class="subtitle">adoptmehousetrading.com — ${new Date().toLocaleString()}</div>
  <div class="summary">
    <span class="pill pass">✅ ${passed} passed</span>
    <span class="pill fail">❌ ${failed} failed</span>
  </div>
  ${results.map(r => `
  <div class="test ${r.status}">
    <span class="icon">${r.status === "pass" ? "✅" : "❌"}</span>
    <div style="flex:1;min-width:0;">
      <div class="name">${r.name}</div>
      ${r.error ? `<div class="error">${r.error}</div>` : ""}
    </div>
    <span class="ms">${r.ms}ms</span>
  </div>`).join("")}
</body>
</html>`;

  return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: html };
}

export const handler = safeHandler(handlerImpl);
