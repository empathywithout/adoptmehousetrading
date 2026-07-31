// Smoke test runner — hit this from your browser to test all major flows
// GET /.netlify/functions/admin-smoke-test?secret=ADMIN_PASSWORD
// Returns HTML with pass/fail results
// DELETE THIS FILE after testing is complete

import { json, safeHandler } from "./_lib/supabase.js";

// Uses a real Roblox account for signup testing (Roblox's own test account)
const TEST_DISPLAY_NAME = `SmokeTest_${Date.now()}`;
const TEST_PASSWORD = "SmokeTest123!";
const TEST_RBX_USERNAME = "Roblox"; // official Roblox account, always exists

async function api(baseUrl, path, opts = {}) {
  const url = `${baseUrl}/.netlify/functions/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests(baseUrl, adminPassword) {
  const results = [];
  let authToken = null;
  let listingId = null;
  let registryEntryId = null;

  async function test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: "pass", ms: Date.now() - start });
    } catch (err) {
      results.push({ name, status: "fail", error: err.message, ms: Date.now() - start });
    }
  }

  // ── Public endpoints ──
  await test("listings-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "listings-list");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.listings), "Expected listings array");
  });

  await test("registry-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "registry-list");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.entries), "Expected entries array");
  });

  await test("registry-list: sort by saves", async () => {
    const { status, data } = await api(baseUrl, "registry-list?sort=saves");
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.entries), "Expected entries array");
  });

  await test("trades-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "trades-list");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.trades), "Expected trades array");
  });

  await test("builders-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "builders-list");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.builders), "Expected builders array");
  });

  await test("content-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "content-list");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.submissions), "Expected submissions array");
  });

  await test("item-values-list: returns values", async () => {
    const { status, data } = await api(baseUrl, "item-values-list?category=adopt_me_pets");
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.values), "Expected values array");
  });

  // ── Auth ──
  // Roblox lookup first -- required before signup
  let rbxUserId = null;
  let rbxUsername = null;
  let rbxAvatarUrl = null;

  await test("roblox-lookup: looks up real username", async () => {
    const { status, data } = await api(baseUrl, "roblox-lookup", {
      method: "POST",
      body: { username: TEST_RBX_USERNAME },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.rbx_user_id, "Expected rbx_user_id");
    rbxUserId = data.rbx_user_id;
    rbxUsername = data.rbx_username;
    rbxAvatarUrl = data.avatar_url;
  });

  await test("auth-signup: creates new user", async () => {
    assert(rbxUserId, "No rbxUserId -- roblox-lookup failed");
    const { status, data } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: {
        display_name: TEST_DISPLAY_NAME,
        rbx_username: rbxUsername,
        rbx_user_id: rbxUserId,
        avatar_url: rbxAvatarUrl,
        password: TEST_PASSWORD,
      },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token");
    assert(data.profile?.id, "Expected profile");
    authToken = data.token;
  });

  await test("auth-signup: rejects duplicate", async () => {
    assert(rbxUserId, "No rbxUserId -- roblox-lookup failed");
    const { status } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: {
        display_name: `Other_${Date.now()}`,
        rbx_username: rbxUsername,
        rbx_user_id: rbxUserId,
        avatar_url: rbxAvatarUrl,
        password: TEST_PASSWORD,
      },
    });
    assert(status === 409, `Expected 409, got ${status}`);
  });

  await test("auth-login: logs in successfully", async () => {
    assert(rbxUsername, "No rbxUsername -- roblox-lookup failed");
    const { status, data } = await api(baseUrl, "auth-login", {
      method: "POST",
      body: { identifier: rbxUsername, password: TEST_PASSWORD },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token");
    authToken = data.token;
  });

  await test("auth-login: rejects wrong password", async () => {
    assert(rbxUsername, "No rbxUsername -- roblox-lookup failed");
    const { status } = await api(baseUrl, "auth-login", {
      method: "POST",
      body: { identifier: rbxUsername, password: "wrongpassword" },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── Profile ──
  await test("profile-me: returns profile", async () => {
    const { status, data } = await api(baseUrl, "profile-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.profile?.display_name === TEST_DISPLAY_NAME, "Wrong display name");
  });

  await test("profile-me: rejects unauthenticated", async () => {
    const { status } = await api(baseUrl, "profile-me");
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test("profile-dashboard: returns dashboard", async () => {
    const { status, data } = await api(baseUrl, "profile-dashboard", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.listings), "Expected listings array");
  });

  await test("player-get: returns public profile", async () => {
    assert(rbxUsername, "No rbxUsername -- roblox-lookup failed");
    const { status, data } = await api(baseUrl, `player-get?identifier=${rbxUsername}`);
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.profile?.display_name === TEST_DISPLAY_NAME, "Wrong profile");
  });

  // ── Listings ──
  await test("listings-create: creates listing", async () => {
    const { status, data } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade",
        house_id: "tiny-home",
        title: "Smoke Test Listing",
        description: "Automated smoke test",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test2.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test3.jpg",
        ],
        looking_for: ["adopt_me_pets"],
        themes: ["cozy"],
        build_type: "original",
        value_amount: 1,
        value_unit: "shark",
      },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.listing?.id, "Expected listing id");
    listingId = data.listing.id;
  });

  await test("listings-get: returns listing by id", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status, data } = await api(baseUrl, `listings-get?id=${listingId}`);
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.listing?.id === listingId, "Wrong listing");
  });

  await test("listings-update: updates listing", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status } = await api(baseUrl, "listings-update", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        id: listingId,
        title: "Smoke Test Listing (updated)",
        description: "Updated",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test2.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test3.jpg",
        ],
        looking_for: ["adopt_me_pets"],
        themes: ["cozy"],
        build_type: "original",
        value_amount: 2,
        value_unit: "shark",
      },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("listing-save: saves a listing", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status } = await api(baseUrl, "listing-save", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: listingId },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("listing-saves-me: returns saved listings", async () => {
    const { status, data } = await api(baseUrl, "listing-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.saves), "Expected saves array");
  });

  // ── Notifications ──
  await test("notifications-list: returns array", async () => {
    const { status, data } = await api(baseUrl, "notifications-list", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.notifications), "Expected notifications array");
  });

  await test("notifications-mark-read: marks read", async () => {
    const { status } = await api(baseUrl, "notifications-mark-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {},
    });
    assert(status === 200, `Got ${status}`);
  });

  // ── Registry ──
  await test("registry-create: creates entry", async () => {
    const { status, data } = await api(baseUrl, "registry-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        title: "Smoke Test Build",
        description: "Automated test",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test2.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test3.jpg",
        ],
        themes: ["cozy"],
        house_id: "tiny-home",
        included_items: [],
      },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.entry?.id, "Expected entry id");
    registryEntryId = data.entry.id;
  });

  await test("registry-get: returns entry by id", async () => {
    assert(registryEntryId, "No registryEntryId -- previous test failed");
    const { status, data } = await api(baseUrl, `registry-get?id=${registryEntryId}`);
    assert(status === 200, `Got ${status}`);
    assert(data.entry?.id === registryEntryId, "Wrong entry");
  });

  await test("registry-save: saves entry", async () => {
    assert(registryEntryId, "No registryEntryId -- previous test failed");
    const { status } = await api(baseUrl, "registry-save", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { entry_id: registryEntryId },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("registry-saves-me: returns saves", async () => {
    const { status, data } = await api(baseUrl, "registry-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.saves), "Expected saves array");
  });

  await test("registry-update: updates entry", async () => {
    assert(registryEntryId, "No registryEntryId -- previous test failed");
    const { status } = await api(baseUrl, "registry-update", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        id: registryEntryId,
        title: "Smoke Test Build (updated)",
        description: "Updated",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test2.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/test3.jpg",
        ],
        themes: ["cozy", "modern"],
        included_items: [],
      },
    });
    assert(status === 200, `Got ${status}`);
  });

  // ── Report ──
  await test("report-create: creates report", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status } = await api(baseUrl, "report-create", {
      method: "POST",
      body: { listing_id: listingId, reason: "other", details: "smoke test" },
    });
    assert(status === 200, `Got ${status}`);
  });

  // ── Admin ──
  await test("admin-stats: returns stats", async () => {
    const { status, data } = await api(baseUrl, "admin-stats", {
      headers: { "X-Admin-Password": adminPassword },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(typeof data.stats?.users === "number", "Expected users count");
  });

  await test("admin-stats: rejects wrong password", async () => {
    const { status } = await api(baseUrl, "admin-stats", {
      headers: { "X-Admin-Password": "wrongpassword" },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test("admin-trades-list: returns trades", async () => {
    const { status, data } = await api(baseUrl, "admin-trades-list", {
      headers: { "X-Admin-Password": adminPassword },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.trades), "Expected trades array");
  });

  // ── Cleanup ──
  await test("registry-delete: removes test entry", async () => {
    assert(registryEntryId, "No registryEntryId -- previous test failed");
    const { status } = await api(baseUrl, "registry-delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { id: registryEntryId },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("listings-remove: removes test listing", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status } = await api(baseUrl, "listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { id: listingId },
    });
    assert(status === 200, `Got ${status}`);
  });

  return results;
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const secret = event.queryStringParameters?.secret;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!secret || secret !== adminPassword) return json(401, { error: "Unauthorized" });

  const baseUrl = `${event.headers["x-forwarded-proto"] || "https"}://${event.headers.host}`;
  const results = await runTests(baseUrl, adminPassword);

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smoke Tests — AMHT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1117; color: #e2e8f0; padding: 32px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .summary { display: flex; gap: 12px; margin-bottom: 28px; }
    .pill { padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 700; }
    .pill.pass { background: #14532d; color: #4ade80; }
    .pill.fail { background: #450a0a; color: #f87171; }
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
  <h1>🧪 Smoke Tests</h1>
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

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: html,
  };
}

export const handler = safeHandler(handlerImpl);
