// Stress test for image upload system
// GET /.netlify/functions/admin-stress-uploads?secret=ADMIN_PASSWORD
// Tests R2 upload pipeline: valid images, invalid types, size limits, concurrent uploads, URL accessibility
// DELETE THIS FILE after testing is complete

import { json, safeHandler } from "./_lib/supabase.js";

const TEST_PASSWORD = "StressTest123!";

// Minimal valid images as base64
// 1x1 JPEG
const JPEG_1X1 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";
// 1x1 PNG
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
// 1x1 WebP
const WEBP_1X1 = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAkA4JZQCdAEO/gHOAAA=";
// Invalid: PDF header
const FAKE_PDF = "JVBERi0xLjQKJeLjz9MKCjEgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cK";
// Too small to be real but valid magic bytes
const JPEG_TINY = "/9j/4AAQSkZJRgAB";

async function api(baseUrl, path, opts = {}) {
  const url = `${baseUrl}/.netlify/functions/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15000),
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
  let authToken = null;
  const uploadedUrls = [];

  async function test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: "pass", ms: Date.now() - start });
    } catch (err) {
      results.push({ name, status: "fail", error: err.message, ms: Date.now() - start });
    }
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  await test("setup: create test user", async () => {
    const { status, data } = await api(baseUrl, "auth-signup", {
      method: "POST",
      body: {
        display_name: `UploadTest_${ts}`,
        rbx_username: `uploadtest_${ts}`,
        rbx_user_id: ts,
        avatar_url: null,
        password: TEST_PASSWORD,
      },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    authToken = data.token;
  });

  await test("upload: rejects unauthenticated request", async () => {
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      body: { filename: "test.jpg", contentType: "image/jpeg", dataBase64: JPEG_1X1 },
    });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── Valid uploads ────────────────────────────────────────────────────────

  await test("upload: valid JPEG", async () => {
    const { status, data } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "test.jpg", contentType: "image/jpeg", dataBase64: JPEG_1X1 },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.url?.startsWith("https://"), `Expected URL, got: ${data.url}`);
    assert(data.url?.includes("r2.dev"), `Expected R2 URL, got: ${data.url}`);
    uploadedUrls.push(data.url);
  });

  await test("upload: valid PNG", async () => {
    const { status, data } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "test.png", contentType: "image/png", dataBase64: PNG_1X1 },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.url?.includes("r2.dev"), `Expected R2 URL`);
    uploadedUrls.push(data.url);
  });

  await test("upload: valid WebP", async () => {
    const { status, data } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "test.webp", contentType: "image/webp", dataBase64: WEBP_1X1 },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.url?.includes("r2.dev"), `Expected R2 URL`);
    uploadedUrls.push(data.url);
  });

  // ── Invalid type rejections ──────────────────────────────────────────────

  await test("upload: rejects GIF content type", async () => {
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "test.gif", contentType: "image/gif", dataBase64: JPEG_1X1 },
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("upload: rejects PDF content type", async () => {
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "malware.pdf", contentType: "application/pdf", dataBase64: FAKE_PDF },
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("upload: rejects fake JPEG (wrong magic bytes)", async () => {
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "fake.jpg", contentType: "image/jpeg", dataBase64: FAKE_PDF },
    });
    assert(status === 400, `Expected 400 on magic byte mismatch, got ${status}`);
  });

  await test("upload: rejects empty body", async () => {
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "empty.jpg", contentType: "image/jpeg", dataBase64: "" },
    });
    assert(status === 400, `Expected 400 on empty file, got ${status}`);
  });

  await test("upload: rejects oversized file (>5MB)", async () => {
    // Generate ~6MB of base64 data (fake, won't pass magic bytes but tests size check)
    const bigData = "A".repeat(8 * 1024 * 1024); // 8MB base64 = ~6MB decoded
    const { status } = await api(baseUrl, "listings-upload-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { filename: "huge.jpg", contentType: "image/jpeg", dataBase64: bigData },
    });
    assert(status === 400, `Expected 400 on oversized file, got ${status}`);
  });

  // ── Concurrent uploads ───────────────────────────────────────────────────

  await test("upload: 5 concurrent uploads succeed", async () => {
    const uploads = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api(baseUrl, "listings-upload-photo", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: { filename: `concurrent_${i}.jpg`, contentType: "image/jpeg", dataBase64: JPEG_1X1 },
        })
      )
    );
    const failures = uploads.filter(r => r.status !== 200);
    assert(failures.length === 0, `${failures.length} concurrent uploads failed: ${failures.map(f => f.data?.error).join(", ")}`);
    const urls = uploads.map(r => r.data.url).filter(Boolean);
    assert(new Set(urls).size === 5, `Expected 5 unique URLs, got ${new Set(urls).size}`);
    uploadedUrls.push(...urls);
  });

  await test("upload: 10 rapid sequential uploads", async () => {
    const urls = [];
    for (let i = 0; i < 10; i++) {
      const { status, data } = await api(baseUrl, "listings-upload-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: { filename: `seq_${i}.png`, contentType: "image/png", dataBase64: PNG_1X1 },
      });
      assert(status === 200, `Upload ${i} failed: ${data.error}`);
      urls.push(data.url);
    }
    assert(new Set(urls).size === 10, `Expected 10 unique URLs, got ${new Set(urls).size}`);
    uploadedUrls.push(...urls);
  });

  // ── Bulk upload for listing/registry (8 photos) ────────────────────────

  await test("upload: 12 photos for a listing (no cap)", async () => {
    // Upload 12 photos concurrently -- backend has no hard cap
    const uploads = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api(baseUrl, "listings-upload-photo", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: { filename: `listing_photo_${i}.jpg`, contentType: "image/jpeg", dataBase64: JPEG_1X1 },
        })
      )
    );
    const failures = uploads.filter(r => r.status !== 200);
    assert(failures.length === 0, `${failures.length}/12 listing photos failed`);
    const photoUrls = uploads.map(r => r.data.url);
    uploadedUrls.push(...photoUrls);

    const { status, data } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade",
        house_id: "tiny-home",
        title: "Upload Stress Test Listing",
        description: "12 photo stress test",
        photos: photoUrls,
        looking_for: ["adopt_me_pets"],
        themes: ["cozy"],
        build_type: "original",
        value_amount: 1,
        value_unit: "shark",
      },
    });
    assert(status === 200, `Listing create failed: ${data.error}`);
    assert(data.listing?.photos?.length === 12, `Expected 12 photos on listing, got ${data.listing?.photos?.length}`);

    if (data.listing?.id) {
      await api(baseUrl, "listings-remove", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: { listing_id: data.listing.id },
      });
    }
  });

  await test("upload: 12 photos for registry entry (no cap)", async () => {
    const uploads = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api(baseUrl, "listings-upload-photo", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: { filename: `reg_photo_${i}.png`, contentType: "image/png", dataBase64: PNG_1X1 },
        })
      )
    );
    const failures = uploads.filter(r => r.status !== 200);
    assert(failures.length === 0, `${failures.length}/12 registry photos failed`);
    const photoUrls = uploads.map(r => r.data.url);

    const { status, data } = await api(baseUrl, "registry-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        title: "Upload Stress Test Build",
        description: "12 photo registry test",
        photos: photoUrls,
        themes: ["cozy"],
        house_id: "tiny-home",
        included_items: [],
      },
    });
    assert(status === 200, `Registry create failed: ${data.error}`);
    assert(data.entry?.photos?.length === 12, `Expected 12 photos on registry entry, got ${data.entry?.photos?.length}`);

    if (data.entry?.id) {
      await api(baseUrl, "registry-delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: { entry_id: data.entry.id },
      });
    }
  });

  await test("upload: listing update supports 12 photos", async () => {
    // Create listing with 3 photos, then update to 12
    const { data: createData } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade",
        house_id: "castle",
        title: "Update Photo Test",
        description: "will be updated to 12 photos",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t2.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/t3.jpg",
        ],
        looking_for: ["adopt_me_pets"], themes: ["cozy"],
        build_type: "original", value_amount: 1, value_unit: "shark",
      },
    });
    assert(createData.listing?.id, `Create failed: ${createData.error}`);
    const listingId = createData.listing.id;

    // Upload 12 new photos
    const uploads = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api(baseUrl, "listings-upload-photo", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: { filename: `update_${i}.jpg`, contentType: "image/jpeg", dataBase64: JPEG_1X1 },
        })
      )
    );
    const photoUrls = uploads.filter(r => r.status === 200).map(r => r.data.url);
    assert(photoUrls.length === 12, `Expected 12 uploads, got ${photoUrls.length}`);

    const { status, data } = await api(baseUrl, `listings-update?id=${listingId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        title: "Update Photo Test",
        description: "updated to 12 photos",
        photos: photoUrls,
        looking_for: ["adopt_me_pets"], themes: ["cozy"],
        build_type: "original", value_amount: 1, value_unit: "shark",
      },
    });
    assert(status === 200, `Update failed: ${data?.error}`);
    assert(data.listing?.photos?.length === 12, `Expected 12 photos after update, got ${data.listing?.photos?.length}`);

    await api(baseUrl, "listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: listingId },
    });
  });

  await test("upload: listing rejects fewer than 3 photos", async () => {
    const { status } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade",
        house_id: "tiny-home",
        title: "Too Few Photos",
        description: "only 2 photos",
        photos: [
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/fake1.jpg",
          "https://pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev/fake2.jpg",
        ],
        looking_for: ["adopt_me_pets"],
        themes: ["cozy"],
        build_type: "original",
      },
    });
    assert(status === 400, `Expected 400 for < 3 photos, got ${status}`);
  });

  // ── URL accessibility ────────────────────────────────────────────────────

  await test("upload: uploaded files are publicly accessible", async () => {
    // Check first 3 uploaded URLs are actually reachable
    const checks = await Promise.all(
      uploadedUrls.slice(0, 3).map(url =>
        fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) })
          .then(r => ({ url, status: r.status, ok: r.ok }))
          .catch(err => ({ url, error: err.message }))
      )
    );
    const failures = checks.filter(c => !c.ok);
    assert(failures.length === 0, `${failures.length} URLs not publicly accessible: ${failures.map(f => f.url).join(", ")}`);
  });

  await test("upload: URLs are unique per upload (no collisions)", async () => {
    const unique = new Set(uploadedUrls);
    assert(unique.size === uploadedUrls.length, `Found duplicate URLs: ${uploadedUrls.length - unique.size} collisions`);
  });

  await test("upload: URL format is correct (R2 public URL)", async () => {
    const R2_PUBLIC = "pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev";
    const allCorrect = uploadedUrls.every(url => url.includes(R2_PUBLIC));
    assert(allCorrect, `Some URLs don't point to R2: ${uploadedUrls.filter(u => !u.includes(R2_PUBLIC)).join(", ")}`);
  });

  // ── Listing photo count (no 8-photo cap) ─────────────────────────────────

  await test("listing: can save more than 8 photos", async () => {
    // Upload 12 photos
    const photoUrls = [];
    for (let i = 0; i < 12; i++) {
      const { status, data } = await api(baseUrl, "listings-upload-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: { filename: `bulk_${i}.jpg`, contentType: "image/jpeg", dataBase64: JPEG_1X1 },
      });
      assert(status === 200, `Upload ${i} failed: ${data.error}`);
      photoUrls.push(data.url);
    }
    assert(photoUrls.length === 12, `Expected 12 URLs`);

    // Create listing with all 12
    const { status, data } = await api(baseUrl, "listings-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        listing_type: "house_trade", house_id: "tiny-home",
        title: "12 Photo Test Listing", description: "stress test",
        photos: photoUrls,
        looking_for: ["adopt_me_pets"], themes: ["cozy"],
        build_type: "original", value_amount: 1, value_unit: "shark",
      },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.listing?.photos?.length === 12, `Expected 12 photos saved, got ${data.listing?.photos?.length}`);

    // Cleanup
    await api(baseUrl, "listings-remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { listing_id: data.listing.id },
    });
  });

  await test("registry: can save more than 8 photos", async () => {
    const photoUrls = [];
    for (let i = 0; i < 10; i++) {
      const { status, data } = await api(baseUrl, "listings-upload-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: { filename: `reg_${i}.png`, contentType: "image/png", dataBase64: PNG_1X1 },
      });
      assert(status === 200, `Upload ${i} failed`);
      photoUrls.push(data.url);
    }

    const { status, data } = await api(baseUrl, "registry-create", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: {
        title: "10 Photo Registry Test", description: "stress test",
        photos: photoUrls, themes: ["cozy"], house_id: "tiny-home", included_items: [],
      },
    });
    assert(status === 200, `Got ${status}: ${data.error}`);
    assert(data.entry?.photos?.length === 10, `Expected 10 photos saved, got ${data.entry?.photos?.length}`);

    // Cleanup
    await api(baseUrl, "registry-delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: { entry_id: data.entry.id },
    });
  });

  return { results, uploadedUrls };
}

async function handlerImpl(event) {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const secret = event.queryStringParameters?.secret;
  if (!secret || secret !== process.env.ADMIN_PASSWORD) return json(401, { error: "Unauthorized" });

  const baseUrl = `${event.headers["x-forwarded-proto"] || "https"}://${event.headers.host}`;
  const { results, uploadedUrls } = await runStressTest(baseUrl, process.env.ADMIN_PASSWORD);

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Upload Stress Test — AMHT</title>
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
    .urls { margin-top: 24px; background: #1e2433; border: 1px solid #2d3748; border-radius: 10px; padding: 16px; }
    .urls h3 { font-size: 13px; font-weight: 700; color: #64748b; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .url { font-size: 11px; color: #4ade80; font-family: monospace; margin-bottom: 4px; word-break: break-all; }
  </style>
</head>
<body>
  <h1>📤 Upload Stress Test</h1>
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
  ${uploadedUrls.length ? `
  <div class="urls">
    <h3>${uploadedUrls.length} files uploaded to R2</h3>
    ${uploadedUrls.map(u => `<div class="url">${u}</div>`).join("")}
  </div>` : ""}
</body>
</html>`;

  return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: html };
}

export const handler = safeHandler(handlerImpl);
