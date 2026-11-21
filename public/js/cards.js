// Listing cards and the save heart, shared by every page that shows them.
//
// Before this, the listing card was written out separately in Browse, the
// homepage, the profile and the house pages, and each copy had drifted a
// little. The save button was a small "Save" pill sitting INSIDE the card's
// <a>, which is invalid HTML (a button inside a link) and why every page had
// to call preventDefault on it.
//
// Now:
//   * listingCardHtml() is the one browser-side card. scripts/lib/cards.mjs
//     writes the same markup at build time for the static pages; keep the two
//     in step (same class names, same order).
//   * The card is an <article>. The title holds the link, and its ::after is
//     stretched over the card, so the whole card is still one click target
//     while the heart is a real <button> beside the link, not inside it.
//   * heartButtonHtml() + mountHearts() are the one save/heart control for
//     listings and registry builds, on cards and on detail pages.
//
// Imported as "./cards.js?v=1"; it imports api.js with the same ?v= the pages
// use, so the browser shares one copy of api.js. Bump both when either changes
// its exports (see the /js/* cache note in netlify.toml).

import { THEME_LABELS, cardPhoto, avatarImg, sendToSignIn, reputationLine } from "./api.js?v=7";

export const UNIT_LABELS = { shark: "Shark", frost: "Frost", rp: "Ride Pot" };

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The one label on the photo. Looking-for posts say so; house listings show
// how the build was made.
export function buildLabel(listing) {
  if (listing.listing_type === "looking_for") return { text: "Looking for", cls: "looking" };
  switch (listing.build_type) {
    case "original": return { text: "Original", cls: "original" };
    case "cloned": return { text: "Cloned", cls: "cloned" };
    case "speedbuild": return { text: "Speedbuild", cls: "speedbuild" };
    case "glitch_original": return { text: "Glitch", cls: "glitch" };
    case "glitch_cloned": return { text: "Glitch (Cloned)", cls: "glitch" };
  }
  if (listing.is_cloned === true) return { text: "Cloned", cls: "cloned" };
  if (listing.is_cloned === false) return { text: "Original", cls: "original" };
  return null;
}

const HEART_PATH = "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z";
export const HEART_SVG = `<svg class="heart-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="${HEART_PATH}"></path></svg>`;

const WORDS = {
  listing: { verb: "Save", done: "Saved", add: "Save this listing", remove: "Saved. Click to remove it from your saved listings", noun: ["save", "saves"] },
  registry: { verb: "Heart", done: "Hearted", add: "Heart this build", remove: "Hearted. Click to remove your heart", noun: ["heart", "hearts"] },
};

function heartLabel(kind, saved, count) {
  const w = WORDS[kind] || WORDS.listing;
  const n = Number(count) || 0;
  const tally = n > 0 ? ` (${n} ${n === 1 ? w.noun[0] : w.noun[1]})` : "";
  return (saved ? w.remove : w.add) + tally;
}

// kind: "listing" | "registry". withText adds "Save"/"Saved" for detail pages.
// The count only shows from 1 up; at 0 it is just the heart.
export function heartButtonHtml({ kind = "listing", id, saved = false, count = 0, withText = false, extraClass = "" }) {
  const n = Math.max(0, Number(count) || 0);
  const w = WORDS[kind] || WORDS.listing;
  const cls = ["heart-btn", saved ? "is-saved" : "", withText ? "heart-inline" : "", extraClass].filter(Boolean).join(" ");
  return `<button type="button" class="${cls}" data-heart-kind="${esc(kind)}" data-heart-id="${esc(id)}" aria-pressed="${saved ? "true" : "false"}" aria-label="${esc(heartLabel(kind, saved, n))}" title="${esc(heartLabel(kind, saved, n))}">`
    + HEART_SVG
    + (withText ? `<span class="heart-text">${saved ? w.done : w.verb}</span>` : "")
    + `<span class="heart-count"${n > 0 ? "" : " hidden"}>${n}</span></button>`;
}

// For your own listing or build: shows the tally, can't be clicked.
export function heartTallyHtml(count) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return "";
  return `<span class="heart-btn heart-static" aria-label="${n} ${n === 1 ? "save" : "saves"}">${HEART_SVG}<span class="heart-count">${n}</span></span>`;
}

export function setHeartState(btn, saved, count) {
  const kind = btn.dataset.heartKind || "listing";
  const n = Math.max(0, Number(count) || 0);
  btn.classList.toggle("is-saved", saved);
  btn.setAttribute("aria-pressed", saved ? "true" : "false");
  btn.setAttribute("aria-label", heartLabel(kind, saved, n));
  btn.title = heartLabel(kind, saved, n);
  const countEl = btn.querySelector(".heart-count");
  if (countEl) { countEl.textContent = String(n); countEl.hidden = n === 0; }
  const textEl = btn.querySelector(".heart-text");
  if (textEl) textEl.textContent = saved ? (WORDS[kind] || WORDS.listing).done : (WORDS[kind] || WORDS.listing).verb;
}

function pop(btn) {
  btn.classList.remove("heart-pop");
  void btn.offsetWidth; // restart the animation if it is clicked again quickly
  btn.classList.add("heart-pop");
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "heart-toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const ENDPOINTS = {
  listing: { url: "/.netlify/functions/listing-save", body: (id) => ({ listing_id: id }) },
  registry: { url: "/.netlify/functions/registry-save", body: (id) => ({ build_registry_id: id }) },
};

// One delegated click handler for every heart inside `root`. Updates the
// heart straight away, then settles it on what the server says. On failure it
// puts the heart back and says why in a small toast. onChange(id, saved,
// count, kind, btn) lets a page keep its own state in step.
export function mountHearts(root, { onChange } = {}) {
  if (!root || root.dataset.heartsMounted) return;
  root.dataset.heartsMounted = "1";
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".heart-btn[data-heart-id]");
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const token = localStorage.getItem("amht_token");
    if (!token) { sendToSignIn(); return; }
    if (btn.getAttribute("aria-busy") === "true") return;

    const kind = btn.dataset.heartKind || "listing";
    const ep = ENDPOINTS[kind];
    if (!ep) return;
    const id = btn.dataset.heartId;
    const wasSaved = btn.classList.contains("is-saved");
    const before = Number(btn.querySelector(".heart-count")?.textContent) || 0;

    setHeartState(btn, !wasSaved, before + (wasSaved ? -1 : 1));
    if (!wasSaved) pop(btn);
    btn.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(ep.body(id)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { setHeartState(btn, wasSaved, before); sendToSignIn(); return; }
      if (!res.ok) throw new Error(data.error || "Couldn't save that. Try again.");
      const count = data.save_count ?? before + (data.saved ? 1 : -1);
      setHeartState(btn, !!data.saved, count);
      // Keep any other heart for the same item on the page in step.
      document.querySelectorAll(`.heart-btn[data-heart-kind="${kind}"][data-heart-id="${CSS.escape(id)}"]`)
        .forEach((other) => { if (other !== btn) setHeartState(other, !!data.saved, count); });
      onChange?.(id, !!data.saved, count, kind, btn);
    } catch (err) {
      setHeartState(btn, wasSaved, before);
      toast(err.message || "Couldn't save that. Try again.");
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

// Marks hearts on build-time cards as saved for the signed-in viewer. The
// static pages can't know who is looking, so they render every heart unsaved.
export async function markSavedHearts(root) {
  const token = localStorage.getItem("amht_token");
  if (!token || !root) return;
  const kinds = { listing: "/.netlify/functions/listing-saves-me", registry: "/.netlify/functions/registry-saves-me" };
  for (const [kind, url] of Object.entries(kinds)) {
    const btns = root.querySelectorAll(`.heart-btn[data-heart-kind="${kind}"]`);
    if (!btns.length) continue;
    try {
      const data = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      const saved = new Set(data.saved_ids || []);
      btns.forEach((b) => {
        if (saved.has(b.dataset.heartId)) setHeartState(b, true, Number(b.querySelector(".heart-count")?.textContent) || 0);
      });
    } catch (_) {}
  }
}

function initialOf(name) {
  return esc((String(name || "?").trim()[0] || "?").toUpperCase());
}

// One listing card. Options:
//   href           where the card links
//   house          the house object from data/houses.json, if known
//   fallbackImage  shown when the lister uploaded no photo
//   reputation     the lister's reputation object (from loadReputation)
//   saved          whether the viewer has saved it
//   isOwn          the viewer's own listing: no heart, just the tally
//   showHouse      false on a house's own page, where it would repeat
export function listingCardHtml(listing, { href, house, fallbackImage, reputation, saved = false, isOwn = false, showHouse = true } = {}) {
  const photo = listing.photos?.[0] || house?.image || fallbackImage || "";
  const label = buildLabel(listing);
  const traded = listing.status === "traded";
  const count = listing.save_count || 0;
  const unit = UNIT_LABELS[listing.value_unit] || listing.value_unit || "";
  const hasValue = listing.value_amount !== null && listing.value_amount !== undefined && listing.value_amount !== "";
  const themes = (listing.themes || []).map((t) => THEME_LABELS[t] || t);
  const chips = themes.length > 2 ? [themes[0], themes[1], `+${themes.length - 2}`] : themes;
  const name = listing.profiles?.display_name;
  const rep = reputation ? reputationLine(reputation, 1) : "";
  const houseLine = [showHouse ? (house?.name || "") : "", traded ? "Traded" : ""].filter(Boolean).join(" · ");

  return `
  <article class="lcard${traded ? " is-traded" : ""}">
    <div class="lcard-photo">
      ${photo ? `<img src="${esc(cardPhoto(photo))}" alt="" loading="lazy" decoding="async"${listing.photos?.[0] ? "" : ' class="is-fallback"'}>` : ""}
      ${label ? `<span class="lcard-build lcard-build--${label.cls}">${esc(label.text)}</span>` : ""}
      ${isOwn ? heartTallyHtml(count) : heartButtonHtml({ kind: "listing", id: listing.id, saved, count })}
    </div>
    <div class="lcard-body">
      ${houseLine ? `<p class="lcard-house">${esc(houseLine)}</p>` : ""}
      <h3 class="lcard-title"><a class="lcard-link" href="${esc(href)}">${esc(listing.title || "Untitled build")}</a></h3>
      ${hasValue
        ? `<p class="lcard-value"><span class="amount">${esc(listing.value_amount)}</span><span class="unit">${esc(unit)}</span></p>`
        : `<p class="lcard-value is-open">Open to offers</p>`}
      ${chips.length ? `<div class="lcard-chips">${chips.map((c) => `<span class="lcard-chip">${esc(c)}</span>`).join("")}</div>` : ""}
      ${name ? `
      <div class="lcard-foot">
        ${listing.profiles?.rbx_avatar_url ? avatarImg(listing.profiles.rbx_avatar_url, 48, 24, "lcard-avatar") : `<span class="lcard-avatar lcard-initial" aria-hidden="true">${initialOf(name)}</span>`}
        <span class="lcard-name">${esc(name)}</span>
        ${rep ? `<span class="lcard-rep"><svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13"><path d="M20 6 9 17l-5-5"></path></svg>${esc(rep)}</span>` : ""}
      </div>` : ""}
    </div>
  </article>`;
}
