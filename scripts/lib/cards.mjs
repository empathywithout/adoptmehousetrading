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

const BUILD_TAGS = { original: "Original", cloned: "Cloned", speedbuild: "Speedbuild", glitch_original: "Glitch", glitch_cloned: "Glitch (Cloned)" };

function valueHtml(value, unit) {
  return value !== null && value !== undefined
    ? `<div class="card-value"><span class="amount">${escapeHtml(value)}</span><span class="unit">${escapeHtml(UNIT_LABELS[unit] || unit || "")}</span></div>`
    : `<div class="card-value"><span class="unit">value open</span></div>`;
}

function dateText(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// A live listing. `href` is where it links, `fallbackImage` the house art used
// when the lister uploaded no photo.
export function listingCardHtml(l, { href, houseName, fallbackImage, showHouse = true }) {
  const photo = l.photo || fallbackImage || "/images/brand/searchdog.png";
  const typeClass = l.listingType === "looking_for" ? "looking-for" : "house-trade";
  const typeIcon = l.listingType === "looking_for" ? "icon-loop" : "icon-sign";
  const typeLabel = l.listingType === "looking_for" ? "Looking For" : "For Trade";
  const build = BUILD_TAGS[l.buildType];
  const meta = [showHouse ? houseName : null, build, l.lister ? `listed by ${l.lister}` : null].filter(Boolean).join(" · ");
  return `
      <a class="listing-card" href="${escapeHtml(href)}">
        <div class="photo">
          <img${l.photo ? "" : ' class="fallback" style="object-fit:contain;padding:10px;box-sizing:border-box;"'} src="${escapeHtml(cardPhoto(photo))}" alt="${escapeHtml(l.title || "Adopt Me house listing")}" loading="lazy" decoding="async">
          <div class="card-badge ${typeClass}" title="${typeLabel}"><div class="${typeIcon}"></div></div>
        </div>
        <div class="body">
          <h3>${escapeHtml(l.title || "Untitled build")}</h3>
          ${valueHtml(l.value, l.unit)}
          ${meta ? `<p class="lister" style="margin-top:6px;">${escapeHtml(meta)}</p>` : ""}
        </div>
      </a>`;
}

// A verified trade: both traders confirmed it afterwards. Not a link, since
// the trade itself has no page of its own.
export function tradeCardHtml(t, { fallbackImage }) {
  const photo = t.photo || fallbackImage || "/images/brand/searchdog.png";
  const meta = [t.lister ? `listed by ${t.lister}` : null, t.at ? dateText(t.at) : null].filter(Boolean).join(" · ");
  return `
      <div class="listing-card" style="cursor:default;">
        <div class="photo">
          <img${t.photo ? "" : ' class="fallback" style="object-fit:contain;padding:10px;box-sizing:border-box;"'} src="${escapeHtml(cardPhoto(photo))}" alt="${escapeHtml(t.title || "Verified Adopt Me house trade")}" loading="lazy" decoding="async">
          <span class="verified-badge" style="position:absolute;top:8px;left:8px;">Verified</span>
        </div>
        <div class="body">
          <h3>${escapeHtml(t.title || "Untitled build")}</h3>
          ${t.value !== null && t.value !== undefined
            ? `<div class="card-value"><span class="unit" style="margin-right:4px;">asked</span><span class="amount">${escapeHtml(t.value)}</span><span class="unit">${escapeHtml(UNIT_LABELS[t.unit] || t.unit || "")}</span></div>`
            : `<div class="card-value"><span class="unit">asking price not recorded</span></div>`}
          ${meta ? `<p class="lister" style="margin-top:6px;">${escapeHtml(meta)}</p>` : ""}
        </div>
      </div>`;
}
