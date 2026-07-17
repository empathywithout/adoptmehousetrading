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
    throw err;
  }
  return data;
}

export const api = {
  lookupRoblox: (username) => request("roblox-lookup", { method: "POST", body: { username } }),
  signup: (payload) => request("auth-signup", { method: "POST", body: payload }),
  login: (email, password) => request("auth-login", { method: "POST", body: { email, password } }),
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
  listRegistry: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`registry-list${qs ? `?${qs}` : ""}`);
  },
  getRegistryEntry: (id) => request(`registry-get?id=${encodeURIComponent(id)}`),
  disputeRegistryEntry: (build_registry_id, claim, claimed_original_entry_id) =>
    request("registry-dispute-create", { method: "POST", body: { build_registry_id, claim, claimed_original_entry_id }, auth: true }),
  submitDisputeRebuttal: (dispute_id, rebuttal) =>
    request("registry-dispute-rebuttal", { method: "POST", body: { dispute_id, rebuttal }, auth: true }),

  applyForDataTeam: (message) => request("data-team-apply", { method: "POST", body: { message }, auth: true }),
  submitDataTeamValue: (payload) => request("data-team-submit-trade", { method: "POST", body: payload, auth: true }),
  submitGuide: (payload) => request("content-submit", { method: "POST", body: payload, auth: true }),
  removeRegistryEntry: (entry_id) => request("registry-delete", { method: "POST", body: { entry_id }, auth: true }),
};

async function uploadPhoto(file) {
  const dataBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const { url } = await request("listings-upload-photo", {
    method: "POST",
    auth: true,
    body: { filename: file.name, contentType: file.type, dataBase64 },
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
  vehicles: "Vehicles",
  toys: "Toys",
  pet_wear: "Pet Wear",
  stickers: "Stickers",
  strollers: "Strollers",
  foods: "Food",
};

export const GUIDE_CATEGORY_LABELS = {
  build_guide: "Build Guide",
  how_to: "How-To",
  tips: "Tips",
  other: "Other",
};

// Seed list, not a locked enum — real builds cross aesthetic styles,
// franchise crossovers, and build technique, and new ones show up
// constantly (seen in research: cottagecore, cutecore, gothic, realism,
// franchise crossovers like Animal Crossing/Cookie Run Kingdom). Revisit
// periodically and add tags that come up often rather than treating this
// as fixed.
export const THEME_LABELS = {
  cottagecore: "Cottagecore",
  cutecore: "Cutecore",
  gothic: "Gothic / Dark",
  realism: "Realism",
  nature: "Nature",
  modern: "Modern / Apartment",
  fantasy: "Fantasy",
  horror: "Horror",
  holiday_seasonal: "Holiday / Seasonal",
  franchise_crossover: "Custom Theme",
};
