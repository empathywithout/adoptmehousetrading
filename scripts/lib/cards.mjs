import { readFileSync } from "fs";
import path from "path";

// Shared HTML for the small cards the build writes into static pages: the
// Browse snapshot and the live sections on each house page. They reuse the
// site's existing .listing-card styles, so a listing looks the same wherever
// it appears.

const R2_HOST = "pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev"; // mirrors cardPhoto() in public/js/api.js
const CARD_PHOTO_WIDTH = 440;
export const UNIT_LABELS = { shark: "Shark", frost: "Frost", rp: "Ride Pot" };

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Photos from our own bucket go through the Netlify image CDN at card width;
// anything else is left alone, same as cardPhoto() in the browser.
export function cardPhoto(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes(R2_HOST)) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${CARD_PHOTO_WIDTH}`;
}

function dateText(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Theme labels come from public/js/api.js, the one list the site uses, read
// at build time rather than copied here (copies of that list drift; see the
// "hardcoded lists" note in the project knowledge).
const THEME_LABELS = (() => {
  try {
    const src = readFileSync(path.join(process.cwd(), "public", "js", "api.js"), "utf8");
    const block = src.slice(src.indexOf("export const THEME_LABELS"), src.indexOf("};", src.indexOf("export const THEME_LABELS")));
    return Object.fromEntries([...block.matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  } catch {
    return {};
  }
})();

const BUILD_LABELS = {
  original: ["Original", "original"], cloned: ["Cloned", "cloned"], speedbuild: ["Speedbuild", "speedbuild"],
  glitch_original: ["Glitch", "glitch"], glitch_cloned: ["Glitch (Cloned)", "glitch"],
};
const HEART_PATH = "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z";

// A live listing, in the same markup as listingCardHtml() in
// public/js/cards.js: keep the two in step. Every heart is rendered unsaved;
// markSavedHearts() in the browser fills in the viewer's own saves.
// `href` is where it links, `fallbackImage` the house art used when the lister
// uploaded no photo.
export function listingCardHtml(l, { href, houseName, fallbackImage, showHouse = true }) {
  const photo = l.photo || fallbackImage || "/images/brand/searchdog.png";
  const label = l.listingType === "looking_for" ? ["Looking for", "looking"] : BUILD_LABELS[l.buildType] || null;
  const count = Math.max(0, Number(l.saveCount) || 0);
  const hasValue = l.value !== null && l.value !== undefined;
  const themes = (l.themes || []).map((t) => THEME_LABELS[t] || t);
  const chips = themes.length > 2 ? [themes[0], themes[1], `+${themes.length - 2}`] : themes;
  const heartLabel = `Save this listing${count ? ` (${count} ${count === 1 ? "save" : "saves"})` : ""}`;
  return `
      <article class="lcard">
        <div class="lcard-photo">
          <img src="${escapeHtml(cardPhoto(photo))}" alt="" loading="lazy" decoding="async"${l.photo ? "" : ' class="is-fallback"'}>
          ${label ? `<span class="lcard-build lcard-build--${label[1]}">${label[0]}</span>` : ""}
          <button type="button" class="heart-btn" data-heart-kind="listing" data-heart-id="${escapeHtml(l.id)}" aria-pressed="false" aria-label="${heartLabel}" title="${heartLabel}"><svg class="heart-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="${HEART_PATH}"></path></svg><span class="heart-count"${count ? "" : " hidden"}>${count}</span></button>
        </div>
        <div class="lcard-body">
          ${showHouse && houseName ? `<p class="lcard-house">${escapeHtml(houseName)}</p>` : ""}
          <h3 class="lcard-title"><a class="lcard-link" href="${escapeHtml(href)}">${escapeHtml(l.title || "Untitled build")}</a></h3>
          ${hasValue
            ? `<p class="lcard-value"><span class="amount">${escapeHtml(l.value)}</span><span class="unit">${escapeHtml(UNIT_LABELS[l.unit] || l.unit || "")}</span></p>`
            : `<p class="lcard-value is-open">Open to offers</p>`}
          ${chips.length ? `<div class="lcard-chips">${chips.map((c) => `<span class="lcard-chip">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
          ${l.lister ? `
          <div class="lcard-foot">
            <span class="lcard-avatar lcard-initial" aria-hidden="true">${escapeHtml((String(l.lister).trim()[0] || "?").toUpperCase())}</span>
            <span class="lcard-name">${escapeHtml(l.lister)}</span>
          </div>` : ""}
        </div>
      </article>`;
}

// A verified trade: both traders confirmed it afterwards. Not a link, since
// the trade itself has no page of its own.
export function tradeCardHtml(t, { fallbackImage }) {
  const photo = t.photo || fallbackImage || "/images/brand/searchdog.png";
  const hasValue = t.value !== null && t.value !== undefined;
  const when = t.at ? dateText(t.at) : "";
  return `
      <article class="lcard is-static">
        <div class="lcard-photo">
          <img src="${escapeHtml(cardPhoto(photo))}" alt="" loading="lazy" decoding="async"${t.photo ? "" : ' class="is-fallback"'}>
          <span class="lcard-build lcard-build--verified">Verified trade</span>
        </div>
        <div class="lcard-body">
          ${when ? `<p class="lcard-house">Traded ${escapeHtml(when)}</p>` : ""}
          <h3 class="lcard-title">${escapeHtml(t.title || "Untitled build")}</h3>
          ${hasValue
            ? `<p class="lcard-value"><span class="unit">Asked</span><span class="amount">${escapeHtml(t.value)}</span><span class="unit">${escapeHtml(UNIT_LABELS[t.unit] || t.unit || "")}</span></p>`
            : `<p class="lcard-value is-open">Asking price not recorded</p>`}
          ${t.lister ? `
          <div class="lcard-foot">
            <span class="lcard-avatar lcard-initial" aria-hidden="true">${escapeHtml((String(t.lister).trim()[0] || "?").toUpperCase())}</span>
            <span class="lcard-name">${escapeHtml(t.lister)}</span>
          </div>` : ""}
        </div>
      </article>`;
}
