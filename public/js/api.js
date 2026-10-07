// Shared client-side helpers for AdoptMeHouseTrading.com
// Session token lives in localStorage — there's no password, so this is
// closer to "remember which profile this browser is" than real auth.

const TOKEN_KEY = "amht_token";
const PROFILE_KEY = "amht_profile";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveSession(token, profile) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  // Cached notifications belong to the account that just signed out.
  localStorage.removeItem("amht_notifs_cache");
}

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (!token) throw new Error("NOT_SIGNED_IN");
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code || null;
    throw err;
  }
  return data;
}

export const api = {
  lookupRoblox: (username) => request("roblox-lookup", { method: "POST", body: { username } }),
  signup: (payload) => request("auth-signup", { method: "POST", body: payload }),
  login: (identifier, password) => request("auth-login", { method: "POST", body: { identifier, password } }),
  me: () => request("profile-me", { auth: true }),
  dashboard: () => request("profile-dashboard", { auth: true }),

  createListing: (listing) => request("listings-create", { method: "POST", body: listing, auth: true }),
  listListings: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`listings-list${qs ? `?${qs}` : ""}`);
  },
  getListing: (id) => request(`listings-get?id=${encodeURIComponent(id)}`),
  uploadPhoto: (file) => uploadPhoto(file),

  createOffer: (offer) => request("offers-create", { method: "POST", body: offer, auth: true }),
  respondToOffer: (offer_id, action) =>
    request("offers-respond", { method: "POST", body: { offer_id, action }, auth: true }),
  cancelOffer: (offer_id) => request("offers-cancel", { method: "POST", body: { offer_id }, auth: true }),

  getTrade: (offer_id) => request(`trades-get?offer_id=${encodeURIComponent(offer_id)}`, { auth: true }),
  confirmTrade: (offer_id, proof_photo) =>
    request("trades-confirm", { method: "POST", body: { offer_id, proof_photo }, auth: true }),
  listTrades: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`trades-list${qs ? `?${qs}` : ""}`);
  },

  report: (listing_id, reason, details) =>
    request("report-create", { method: "POST", body: { listing_id, reason, details } }),

  updateBuilder: (patch) => request("profile-update-builder", { method: "POST", body: patch, auth: true }),
  listBuilders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`builders-list${qs ? `?${qs}` : ""}`);
  },
  getBuilder: (id) => request(`builder-get?id=${encodeURIComponent(id)}`),

  createCommissionRequest: (payload) => request("commission-request-create", { method: "POST", body: payload, auth: true }),
  respondToCommissionRequest: (request_id, action) =>
    request("commission-request-respond", { method: "POST", body: { request_id, action }, auth: true }),
  deliverCommission: (request_id, delivery_photos) =>
    request("commission-request-deliver", { method: "POST", body: { request_id, delivery_photos }, auth: true }),
  confirmCommission: (request_id) =>
    request("commission-request-confirm", { method: "POST", body: { request_id }, auth: true }),
  cancelCommission: (request_id) =>
    request("commission-request-cancel", { method: "POST", body: { request_id }, auth: true }),

  registerBuild: (payload) => request("registry-create", { method: "POST", body: payload, auth: true }),
  updateRegistryBuild: (payload) => request("registry-update", { method: "POST", body: payload, auth: true }),
  saveRegistryBuild: (build_registry_id) => request("registry-save", { method: "POST", body: { build_registry_id }, auth: true }),
  getMyRegistrySaves: () => request("registry-saves-me", { auth: true }),
  listRegistry: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`registry-list${qs ? `?${qs}` : ""}`);
  },
  getRegistryEntry: (id) => request(`registry-get?id=${encodeURIComponent(id)}`),
  disputeRegistryEntry: (build_registry_id, claim, claimed_original_entry_id, dispute_type, proof_url) =>
    request("registry-dispute-create", { method: "POST", body: { build_registry_id, claim, claimed_original_entry_id, dispute_type, proof_url }, auth: true }),
  submitDisputeRebuttal: (dispute_id, rebuttal, rebuttal_proof_url) =>
    request("registry-dispute-rebuttal", { method: "POST", body: { dispute_id, rebuttal, rebuttal_proof_url }, auth: true }),

  applyForDataTeam: (message) => request("data-team-apply", { method: "POST", body: { message }, auth: true }),
  submitDataTeamValue: (payload) => request("data-team-submit-trade", { method: "POST", body: payload, auth: true }),
  submitTradeRecord: (payload) => request("trade-record-create", { method: "POST", body: payload, auth: true }),
  getMyTradeRecords: () => request("trade-records-mine", { auth: true }),
  deleteTradeRecord: (id) => request("trade-record-delete", { method: "POST", body: { id }, auth: true }),
  submitGuide: (payload) => request("content-submit", { method: "POST", body: payload, auth: true }),
  removeRegistryEntry: (entry_id) => request("registry-delete", { method: "POST", body: { entry_id }, auth: true }),
  renewListing: (listing_id) => request("listings-renew", { method: "POST", body: { listing_id }, auth: true }),
  removeListing: (listing_id) => request("listings-remove", { method: "POST", body: { listing_id }, auth: true }),
  updateListing: (id, body) => request(`listings-update?id=${encodeURIComponent(id)}`, { method: "PUT", body, auth: true }),
};

async function uploadPhoto(file) {
  // Canvas re-encode: strips EXIF/metadata and normalises the file.
  // Draw onto canvas and export as JPEG — output contains only pixel
  // data, no GPS coordinates, device info, or hidden payloads.
  // Also resizes to max 1600px to keep uploads reasonable.
  const MAX_DIM = 1600;
  const QUALITY = 0.88;

  const dataBase64 = await new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        // Always export as JPEG regardless of input format — strips metadata
        const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
        resolve(dataUrl.split(",")[1]);
      } catch (err) {
        reject(new Error("Image processing failed — try a different photo."));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read image — make sure it's a valid photo."));
    };

    img.src = objectUrl;
  });

  const { url } = await request("listings-upload-photo", {
    method: "POST",
    auth: true,
    // Always send as JPEG since canvas re-encode normalises to JPEG
    body: { filename: file.name, contentType: "image/jpeg", dataBase64 },
  });
  return url;
}

// Generic house-outline placeholder shown in the house-picker component
// before any house is selected — used instead of an empty <img src=""> so
// browsers don't render their default broken-image glyph. Shared here so
// every page using the house picker (List a House, Build Registry) shows
// the exact same placeholder.
export const HOUSE_PLACEHOLDER_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M4 11.5L12 4l8 7.5V19a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-7.5z' stroke='%237C8F87' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/%3E%3C/svg%3E";

// Canned quick-reply phrases for offer/commission messages — the same
// kind of quick-insert chips Elvebredd and similar Adopt Me trading sites
// offer, so people aren't starting every message from a blank textarea.
export const QUICK_REPLIES = [
  "Interested! What's your Roblox username?",
  "Can you add more to sweeten the deal?",
  "Deal! Let's trade in-game.",
  "Still available?",
  "Can you go higher on value?",
  "Sorry, that's a lowball for me.",
];

export const CATEGORY_LABELS = {
  adopt_me_pets: "Pets",
  eggs: "Eggs",
  potions: "Potions",
  vehicles: "Vehicles",
  toys: "Toys",
  pet_wear: "Pet Wear",
  stickers: "Stickers",
  strollers: "Strollers",
  foods: "Food",
};

export const GUIDE_CATEGORY_LABELS = {
  theme_build:        "Theme Build Guide",
  budget_build:       "Budget / Challenge Build",
  building_technique: "Building Technique",
  trading_guide:      "Trading & Values Guide",
};

// Seed list, not a locked enum — real builds cross aesthetic styles,
// franchise crossovers, and build technique, and new ones show up
export const THEME_LABELS = {
  cutecore:         "Cutecore",
  coquette:         "Coquette",
  cottagecore:      "Cottagecore",
  cozy:             "Cozy",
  gothic:           "Gothic",
  cutegoth:         "Cutegoth",
  cottagegoth:      "Cottagegoth",
  realism:          "Realism / Hyperrealism",
  fairycore:        "Fairycore",
  nature:           "Naturecore",
  garden:           "Garden",
  japanese:         "Japanese",
  modern:           "Modern",
  minimalist:       "Minimalist",
  medieval:         "Medieval",
  dark_academia:    "Dark Academia",
  royal:            "Royal / Palace",
  victorian:        "Victorian",
  vintage:          "Vintage",
  beach:            "Beach / Coastal",
  tropical:         "Tropical",
  farmhouse:        "Farmhouse",
  autumn:           "Autumn / Fall",
  winter_cabin:     "Winter Cabin",
  spring:           "Spring",
  fantasy:          "Fantasy",
  horror:           "Horror",
  holiday_seasonal: "Holiday / Seasonal",
  custom_theme:     "Custom Theme",
  // Legacy keys — old listings/builds keep displaying correctly
  gothic_dark:         "Gothic",

};

// ─── Reputation ──────────────────────────────────────────────────────────────
// One CDN-cached map for the whole site, fetched once per page and shared by
// every card on it. Confirming a trade, earning a heart and finishing a
// commission are all work; this is where that work becomes visible.

let _reputationPromise = null;

export function loadReputation() {
  _reputationPromise ||= fetch("/.netlify/functions/reputation-list")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => d.reputation || {})
    // Never let this break a page. No map simply means no badges.
    .catch(() => ({}));
  return _reputationPromise;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Minimum before a number is worth showing. A badge almost everyone has
// tells you nothing about anyone.
//
// Measured on the live site: of 362 profiles with any history, 258 have
// exactly one registered build. "1 build" was therefore the most common
// badge on Browse and distinguished nobody. Three or more is uncommon
// enough to mean something.
//
// Hearts used to sit here at 1 on the basis that only 2 profiles had any —
// a number read off a save_count whose maintaining trigger had never been
// applied, so it was really measuring nothing. With the count repaired
// there are 26 hearts across 20 builds, which made "1 heart" the new "1
// build": the commonest line on the page and a weak thing to say about
// anyone. Same bar as builds now.
//
// Verified trades and commissions stay at 1. Both are genuinely rare, and a
// verified trade is the single most useful fact about someone you are about
// to trade with, so it earns its place on its own.
const MIN_TO_SHOW = { t: 1, c: 1, h: 3, b: 3 };

// Ordered strongest first: a verified trade is the hardest to fake and the
// most useful thing to know about someone you are about to trade with.
export function reputationParts(rep) {
  if (!rep) return [];
  const parts = [];
  if ((rep.t || 0) >= MIN_TO_SHOW.t) parts.push(plural(rep.t, "verified trade"));
  if ((rep.c || 0) >= MIN_TO_SHOW.c) parts.push(plural(rep.c, "commission"));
  if ((rep.h || 0) >= MIN_TO_SHOW.h) parts.push(plural(rep.h, "heart"));
  if ((rep.b || 0) >= MIN_TO_SHOW.b) parts.push(plural(rep.b, "build"));
  return parts;
}

// Compact line for a card. Returns "" when there is nothing to say, so a new
// account shows no badge rather than a row of zeros.
export function reputationLine(rep, max = 2) {
  return reputationParts(rep).slice(0, max).join(" · ");
}

// Ready-to-insert markup, escaped. Same visual weight everywhere it appears.
export function reputationHtml(rep, max = 2) {
  const line = reputationLine(rep, max);
  if (!line) return "";
  const safe = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p class="rep-line">${safe}</p>`;
}

// Signing in lives on profile.html. A signed-out tap on Save/Heart used to
// POST anyway and alert "Not signed in", which tells people nothing about
// what to do. Send them to the form instead and bring them back after.
const RETURN_KEY = "amht_return_to";

export function sendToSignIn() {
  try {
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
  } catch (_) {}
  const depth = location.pathname.replace(/\/[^/]*$/, "").split("/").filter(Boolean).length;
  location.href = "../".repeat(depth) + "profile.html";
}

export function consumeReturnTo() {
  try {
    const to = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    // Only ever same-origin paths we wrote ourselves.
    return to && to.startsWith("/") && !to.startsWith("//") ? to : null;
  } catch (_) {
    return null;
  }
}

// The detail pages (listing, registry entry, builder) deliberately ship no
// canonical in their raw HTML — one shell serves many records via ?id=, so
// any fixed href is wrong for all but one of them. That means there is no
// element to update here, only one to create.
export function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", url);
}

// ── Avatars ──────────────────────────────────────────────────────────────
// Roblox's CDN encodes the rendered size in the path:
//   .../30DAY-AvatarHeadshot-<hash>-Png/150/150/AvatarHeadshot/Png/isCircular
// roblox-lookup.js asks for 150x150 at signup and that URL is stored per
// profile, so every avatar on the site downloads at 150x150 — including the
// ~29 on a Browse page that are displayed at 16x16, about 21 KB each.
//
// Asking for a smaller one is a string swap on the stored URL, which means no
// new column, no backfill, and no re-querying Roblox for the 957 profiles
// that already have a URL. Measured: 150px averages 21 KB, 48px averages
// about 1 KB.
//
// Not every avatar has every size cached — roughly one in six only exists at
// 150 — so a smaller URL can 404. Hence the fallback below, which quietly
// restores the original rather than leaving a broken image.
const AVATAR_SIZE_IN_PATH = /\/\d+\/\d+\//;
const AVATAR_FALLBACK_ATTR = "avatarFallback";

export function avatarUrl(url, px) {
  if (!url || typeof url !== "string") return url;
  return AVATAR_SIZE_IN_PATH.test(url) ? url.replace(AVATAR_SIZE_IN_PATH, `/${px}/${px}/`) : url;
}

function attr(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// fetchPx: the size to download. boxPx: the size it is displayed at, written
// as width/height so the browser reserves the space before the image arrives.
export function avatarImg(url, fetchPx, boxPx, cls = "", alt = "") {
  if (!url) return "";
  const small = avatarUrl(url, fetchPx);
  const needsFallback = small !== url;
  return `<img class="${attr(cls)}" src="${attr(small)}" width="${boxPx}" height="${boxPx}"`
    + ` loading="lazy" decoding="async" alt="${attr(alt)}"`
    + (needsFallback ? ` data-avatar-fallback="${attr(url)}"` : "")
    + `>`;
}

// `error` does not bubble, so this listens in the capture phase. One listener
// covers every avatar on the page, including ones rendered later, and avoids
// inline onerror handlers.
if (typeof document !== "undefined") {
  document.addEventListener("error", (e) => {
    const el = e.target;
    if (el?.tagName !== "IMG") return;
    const fallback = el.dataset?.avatarFallback;
    if (!fallback) return;
    delete el.dataset[AVATAR_FALLBACK_ATTR];
    el.src = fallback;
  }, true);
}

// ── Card photos ──────────────────────────────────────────────────────────
// Uploads land in R2 at up to 1600px and every grid uses that original as its
// thumbnail. A Browse card's photo slot is 221x138, so even on a 2x screen
// that is roughly 16x more pixels than the slot can show.
//
// Netlify's Image CDN resizes on demand at the edge and negotiates a modern
// format (avif/webp) per browser. On Pro, transformations are not charged
// separately — Image CDN usage counts against bandwidth, which is metered per
// GB. Serving a 440px image instead of a 1600px one therefore REDUCES the
// metered quantity. Remote sources must be allowlisted in netlify.toml under
// [images] remote_images.
//
// One width for every card on purpose: each distinct transformation is a
// separate edge-cache entry, so reusing a single size across grids means the
// first visitor warms the cache for everyone.
const R2_HOST = "pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev";
export const CARD_PHOTO_WIDTH = 440;

export function cardPhoto(url, w = CARD_PHOTO_WIDTH) {
  if (!url || typeof url !== "string") return url;
  // Anything not served from our own bucket is left alone: local assets are
  // already small, and an un-allowlisted remote host would just 404 through
  // the transformer.
  if (!url.includes(R2_HOST)) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}`;
}
