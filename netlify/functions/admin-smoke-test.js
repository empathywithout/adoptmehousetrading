// Smoke test runner — hit this from your browser to test all major flows
// GET /.netlify/functions/admin-smoke-test?secret=ADMIN_PASSWORD
// Returns HTML with pass/fail results
// DELETE THIS FILE after testing is complete

import { json, safeHandler } from "./_lib/supabase.js";

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
  // Generate unique test data per run (inside function so each request gets fresh values)
  const ts = Date.now();
  const TEST_DISPLAY_NAME = `SmokeTest_${ts}`;
  const uniqueRbxUsername = `smoketest_${ts}`;
  const uniqueRbxUserId = ts;
  let testProfileId = null;

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
  await test("roblox-lookup: looks up real username", async () => {
    const { status, data } = await api(baseUrl, "roblox-lookup", {
      method: "POST",
      body: { username: TEST_RBX_USERNAME },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.rbx_user_id, "Expected rbx_user_id");
  });

  await test("auth-signup: creates new user", async () => {
    const { status, data } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: {
        display_name: TEST_DISPLAY_NAME,
        rbx_username: uniqueRbxUsername,
        rbx_user_id: uniqueRbxUserId,
        avatar_url: null,
        password: TEST_PASSWORD,
      },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token");
    assert(data.profile?.id, "Expected profile");
    authToken = data.token;
    testProfileId = data.profile.id;
    // Debug: log what we got

  });

  await test("auth-signup: rejects missing required fields", async () => {
    const { status } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: { password: TEST_PASSWORD },
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("auth-login: logs in with rbx_username", async () => {
    assert(authToken, "No authToken -- signup failed");
    // Small delay to ensure Neon write is visible across connection pool
    await new Promise(r => setTimeout(r, 500));
    const { status, data } = await api(baseUrl, "auth-login", {
      method: "POST",
      body: { identifier: uniqueRbxUsername, password: TEST_PASSWORD },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token");
    authToken = data.token;
  });

  await test("auth-login: rejects wrong password", async () => {
    const { status } = await api(baseUrl, "auth-login", {
      method: "POST",
      body: { identifier: uniqueRbxUsername, password: "wrongpassword" },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── Profile ──
  await test("profile-me: returns profile", async () => {
    const { status, data } = await api(baseUrl, "profile-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.profile?.id === testProfileId, "Wrong profile id");
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

  await test("player-get: returns public profile by id", async () => {
    assert(testProfileId, "No testProfileId -- signup failed");
    const { status, data } = await api(baseUrl, `player-get?id=${testProfileId}`);
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.player, "Expected player object");
  });

  // ── Listings ──
  await test(`listings-create (token=${authToken?.slice(0,8)} profile=${testProfileId?.slice(0,8)})`, async () => {
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
    // Debug: verify listing is owned by our profile
    const meCheck = await api(baseUrl, "profile-me", { headers: { Authorization: `Bearer ${authToken}` } });
    const myProfileId = meCheck.data?.profile?.id;
    assert(data.listing.profile_id === myProfileId, `Listing owned by ${data.listing.profile_id} but we are ${myProfileId}`);
  });

  await test("listings-get: returns listing by id", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status, data } = await api(baseUrl, `listings-get?id=${listingId}`);
    assert(status === 200, `Got ${status}: ${data.error || ""}`);
    assert(data.listing?.id === listingId, "Wrong listing");
  });

  await test("listings-update: updates listing", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status, data } = await api(baseUrl, `listings-update?id=${listingId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
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
    // Debug: check what profile-me returns for this token
    const meRes = await api(baseUrl, "profile-me", { headers: { Authorization: `Bearer ${authToken}` } });
    const profileId = meRes.data?.profile?.id;
    assert(status === 200, `Got ${status}: ${data?.error} (listingId=${listingId}, profileId=${profileId}, authToken=${authToken?.slice(0,8)}...)`);
  });

  await test("listing-save: saves another user listing", async () => {
    // Get a real listing from the DB to save (can't save own listing)
    const { data: listData } = await api(baseUrl, "listings-list");
    const otherListing = (listData.listings || []).find(l => l.profile_id !== testProfileId && l.status === "active");
    if (!otherListing) { return; } // skip if no other listings exist
    const { status } = await api(baseUrl, "listing-save", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: otherListing.id },
    });
    assert([200, 429].includes(status), `Got ${status}`);
  });

  await test("listing-saves-me: returns saved listings", async () => {
    const { status, data } = await api(baseUrl, "listing-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.saved_ids), "Expected saved_ids array");
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
      body: { all: true },
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
      body: { build_registry_id: registryEntryId },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("registry-saves-me: returns saves", async () => {
    const { status, data } = await api(baseUrl, "registry-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(data.saved_ids), "Expected saved_ids array");
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
      body: { entry_id: registryEntryId },
    });
    assert(status === 200, `Got ${status}`);
  });

  await test("listings-remove: removes test listing", async () => {
    assert(listingId, "No listingId -- previous test failed");
    const { status } = await api(baseUrl, "listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: listingId },
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
