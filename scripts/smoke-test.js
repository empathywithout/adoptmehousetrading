#!/usr/bin/env node
/**
 * Smoke test suite for AdoptMeHouseTrading.com
 * Tests all major user flows against a live deploy URL
 * Usage: node scripts/smoke-test.js https://deploy-preview-X--adoptmehousetrading.netlify.app
 */

const BASE_URL = process.argv[2] || "https://adoptmehousetrading.netlify.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let passed = 0, failed = 0, skipped = 0;
const results = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const url = `${BASE_URL}/.netlify/functions/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function test(name, fn) {
  return { name, fn };
}

function skip(name) {
  return { name, skip: true };
}

async function run(tests) {
  console.log(`\n🧪 Smoke tests against ${BASE_URL}\n`);

  for (const t of tests) {
    if (t.skip) {
      console.log(`  ⏭  ${t.name}`);
      skipped++;
      results.push({ name: t.name, status: "skip" });
      continue;
    }
    try {
      await t.fn();
      console.log(`  ✅  ${t.name}`);
      passed++;
      results.push({ name: t.name, status: "pass" });
    } catch (err) {
      console.log(`  ❌  ${t.name}`);
      console.log(`       ${err.message}`);
      failed++;
      results.push({ name: t.name, status: "fail", error: err.message });
    }
  }

  console.log(`\n── Results ─────────────────────────────`);
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭  Skipped: ${skipped}`);
  console.log(`────────────────────────────────────────\n`);
  if (failed > 0) process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Test data ─────────────────────────────────────────────────────────────────

const testUser = {
  display_name: `SmokeTest_${Date.now()}`,
  rbx_username: `smoketest${Date.now()}`,
  password: "SmokeTest123!",
};

let authToken = null;
let profileId = null;
let listingId = null;
let offerId = null;
let registryEntryId = null;

// ── Tests ─────────────────────────────────────────────────────────────────────

await run([

  // ── Public endpoints ──────────────────────────────────────────────────────

  test("listings-list: returns listings array", async () => {
    const { status, data } = await api("listings-list");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.listings), "Expected listings array");
  }),

  test("listings-list: filter by status=active", async () => {
    const { status, data } = await api("listings-list?status=active");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.listings), "Expected listings array");
  }),

  test("registry-list: returns entries array", async () => {
    const { status, data } = await api("registry-list");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.entries), "Expected entries array");
  }),

  test("registry-list: filter by sort=saves", async () => {
    const { status, data } = await api("registry-list?sort=saves");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.entries), "Expected entries array");
  }),

  test("trades-list: returns trades array", async () => {
    const { status, data } = await api("trades-list");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.trades), "Expected trades array");
  }),

  test("builders-list: returns builders array", async () => {
    const { status, data } = await api("builders-list");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.builders), "Expected builders array");
  }),

  test("content-list: returns submissions array", async () => {
    const { status, data } = await api("content-list");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.submissions), "Expected submissions array");
  }),

  test("item-values-list: returns values for adopt_me_pets", async () => {
    const { status, data } = await api("item-values-list?category=adopt_me_pets");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.values), "Expected values array");
  }),

  // ── Auth: signup ──────────────────────────────────────────────────────────

  test("auth-signup: creates new user", async () => {
    const { status, data } = await api("auth-signup", {
      method: "POST",
      body: {
        display_name: testUser.display_name,
        rbx_username: testUser.rbx_username,
        password: testUser.password,
      },
    });
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token in response");
    assert(data.profile?.id, "Expected profile with id");
    authToken = data.token;
    profileId = data.profile.id;
  }),

  test("auth-signup: rejects duplicate username", async () => {
    const { status, data } = await api("auth-signup", {
      method: "POST",
      body: {
        display_name: `Other_${Date.now()}`,
        rbx_username: testUser.rbx_username,
        password: testUser.password,
      },
    });
    assert(status === 409, `Expected 409, got ${status}`);
  }),

  // ── Auth: login ───────────────────────────────────────────────────────────

  test("auth-login: logs in with username + password", async () => {
    const { status, data } = await api("auth-login", {
      method: "POST",
      body: { identifier: testUser.rbx_username, password: testUser.password },
    });
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
    assert(data.token, "Expected token");
    authToken = data.token; // refresh token
  }),

  test("auth-login: rejects wrong password", async () => {
    const { status } = await api("auth-login", {
      method: "POST",
      body: { identifier: testUser.rbx_username, password: "wrongpassword" },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  }),

  // ── Profile ───────────────────────────────────────────────────────────────

  test("profile-me: returns own profile when authenticated", async () => {
    const { status, data } = await api("profile-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.profile?.display_name === testUser.display_name, "Expected correct display name");
  }),

  test("profile-me: rejects unauthenticated", async () => {
    const { status } = await api("profile-me");
    assert(status === 401, `Expected 401, got ${status}`);
  }),

  test("profile-dashboard: returns dashboard data", async () => {
    const { status, data } = await api("profile-dashboard", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
    assert(Array.isArray(data.listings), "Expected listings array");
  }),

  test("player-get: returns public profile by username", async () => {
    const { status, data } = await api(`player-get?identifier=${testUser.rbx_username}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.profile?.display_name === testUser.display_name, "Expected correct profile");
  }),

  // ── Listings ──────────────────────────────────────────────────────────────

  test("listings-create: creates a listing", async () => {
    const { status, data } = await api("listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade",
        house_id: "tiny-home",
        title: "Smoke Test Listing",
        description: "Created by automated smoke test",
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
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
    assert(data.listing?.id, "Expected listing with id");
    listingId = data.listing.id;
  }),

  test("listings-get: returns listing by id", async () => {
    assert(listingId, "Need listingId from previous test");
    const { status, data } = await api(`listings-get?id=${listingId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.listing?.id === listingId, "Expected correct listing");
  }),

  test("listings-update: updates listing title", async () => {
    assert(listingId, "Need listingId from previous test");
    const { status, data } = await api("listings-update", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        id: listingId,
        title: "Smoke Test Listing (updated)",
        description: "Updated by smoke test",
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
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
  }),

  test("listing-save: saves a listing", async () => {
    assert(listingId, "Need listingId from previous test");
    const { status, data } = await api("listing-save", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: listingId },
    });
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
  }),

  test("listing-saves-me: returns saved listings", async () => {
    const { status, data } = await api("listing-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.saves), "Expected saves array");
  }),

  // ── Offers ────────────────────────────────────────────────────────────────

  test("offers-create: creates an offer on own listing (should fail with 403 or 409)", async () => {
    // Can't offer on own listing -- expect rejection
    assert(listingId, "Need listingId from previous test");
    const { status } = await api("offers-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_id: listingId,
        items: [{ category: "adopt_me_pets", id: "dog", name: "Dog", image: "", qty: 1 }],
        message: "smoke test offer",
      },
    });
    assert([403, 409, 400].includes(status), `Expected rejection, got ${status}`);
  }),

  // ── Notifications ─────────────────────────────────────────────────────────

  test("notifications-list: returns notifications", async () => {
    const { status, data } = await api("notifications-list", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.notifications), "Expected notifications array");
  }),

  test("notifications-mark-read: marks notifications read", async () => {
    const { status } = await api("notifications-mark-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {},
    });
    assert(status === 200, `Expected 200, got ${status}`);
  }),

  // ── Registry ──────────────────────────────────────────────────────────────

  test("registry-create: creates a registry entry", async () => {
    const { status, data } = await api("registry-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        title: "Smoke Test Build",
        description: "Automated smoke test entry",
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
    assert(status === 200, `Expected 200, got ${status}: ${data.error || ""}`);
    assert(data.entry?.id, "Expected entry with id");
    registryEntryId = data.entry.id;
  }),

  test("registry-get: returns entry by id", async () => {
    assert(registryEntryId, "Need registryEntryId from previous test");
    const { status, data } = await api(`registry-get?id=${registryEntryId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.entry?.id === registryEntryId, "Expected correct entry");
  }),

  test("registry-save: saves a registry entry", async () => {
    assert(registryEntryId, "Need registryEntryId from previous test");
    const { status } = await api("registry-save", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { entry_id: registryEntryId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  }),

  test("registry-saves-me: returns saved registry entries", async () => {
    const { status, data } = await api("registry-saves-me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.saves), "Expected saves array");
  }),

  test("registry-update: updates entry", async () => {
    assert(registryEntryId, "Need registryEntryId from previous test");
    const { status } = await api("registry-update", {
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
    assert(status === 200, `Expected 200, got ${status}`);
  }),

  // ── Reports ───────────────────────────────────────────────────────────────

  test("report-create: creates a report on listing", async () => {
    assert(listingId, "Need listingId from previous test");
    const { status } = await api("report-create", {
      method: "POST",
      body: { listing_id: listingId, reason: "other", details: "smoke test report" },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  }),

  // ── Admin ─────────────────────────────────────────────────────────────────

  test("admin-stats: returns stats with correct password", async () => {
    if (!ADMIN_PASSWORD) { skipped++; throw new Error("ADMIN_PASSWORD env var not set -- skipping"); }
    const { status, data } = await api("admin-stats", {
      headers: { "X-Admin-Password": ADMIN_PASSWORD },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof data.stats.users === "number", "Expected users count");
  }),

  test("admin-stats: rejects wrong password", async () => {
    const { status } = await api("admin-stats", {
      headers: { "X-Admin-Password": "wrongpassword" },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  }),

  test("admin-trades-list: returns trades", async () => {
    if (!ADMIN_PASSWORD) { skipped++; throw new Error("ADMIN_PASSWORD env var not set -- skipping"); }
    const { status, data } = await api("admin-trades-list", {
      headers: { "X-Admin-Password": ADMIN_PASSWORD },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.trades), "Expected trades array");
  }),

  // ── Cleanup: remove test data ─────────────────────────────────────────────

  test("registry-delete: removes registry entry", async () => {
    assert(registryEntryId, "Need registryEntryId from previous test");
    const { status } = await api("registry-delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { id: registryEntryId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  }),

  test("listings-remove: removes listing", async () => {
    assert(listingId, "Need listingId from previous test");
    const { status } = await api("listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { id: listingId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  }),

]);
