// Writes a static snapshot of live data into the Browse and Recent Trades
// pages at build time.
//
// Why this exists: both pages fill themselves from a Netlify Function after
// the page loads, so the HTML a crawler downloads is an empty shell (about 40
// to 90 words). They are also the pages that carry nearly all of the site's
// search traffic. A reviewer or crawler that does not run the scripts saw
// almost nothing there, which is a thin-content problem on exactly the pages
// that matter most.
//
// How it works: each page has marker comments, e.g.
//   <!--SNAPSHOT:grid--> ... <!--/SNAPSHOT:grid-->
// and this replaces whatever sits between them. The page's own script still
// runs and replaces the grid contents with the live, filterable version, so
// visitors see no change beyond a faster first paint. The markers are left
// empty in git; the filled version only exists in the deployed build.
//
// Same contract as house-stats.mjs: this never throws and never fails the
// build. With no data (no DATABASE_URL, database asleep) it touches nothing
// and the pages ship exactly as before.

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const R2_HOST = "pub-cba78cf9524643c2a7bff415bfed4d9d.r2.dev"; // mirrors cardPhoto() in public/js/api.js
const CARD_PHOTO_WIDTH = 440;
// Real data has ~40 house types with listings. A wall of links looks broken and
// adds nothing a crawler needs, so only the busiest are shown.
const MAX_HOUSE_CHIPS = 12;
const UNIT_LABELS = { shark: "Shark", frost: "Frost", rp: "Ride Pot" };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mirrors cardPhoto() in public/js/api.js: photos from our own bucket go
// through the Netlify image CDN at card width, anything else is left alone.
function cardPhoto(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes(R2_HOST)) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${CARD_PHOTO_WIDTH}`;
}

function money(v, u) {
  if (v === null || v === undefined) return null;
  return `${v} ${UNIT_LABELS[u] || u || ""}`.trim();
}

function longDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Replace the content between <!--SNAPSHOT:name--> and <!--/SNAPSHOT:name-->.
// Returns null when the markers are missing so the caller can skip quietly.
export function replaceBetween(html, name, content) {
  const re = new RegExp(`(<!--SNAPSHOT:${name}-->)[\\s\\S]*?(<!--/SNAPSHOT:${name}-->)`);
  if (!re.test(html)) return null;
  return html.replace(re, (_, open, close) => `${open}${content}${close}`);
}

// ---- Browse page ----------------------------------------------------------

export function browseGridHtml(listings, houseById) {
  return listings
    .map((l) => {
      const house = houseById[l.houseId];
      const photo = l.photo || house?.image || "../images/brand/searchdog.png";
      const typeClass = l.listingType === "looking_for" ? "looking-for" : "house-trade";
      const typeIcon = l.listingType === "looking_for" ? "icon-loop" : "icon-sign";
      const typeLabel = l.listingType === "looking_for" ? "Looking For" : "For Trade";
      const v = l.value !== null && l.value !== undefined
        ? `<div class="card-value"><span class="amount">${escapeHtml(l.value)}</span><span class="unit">${escapeHtml(l.unit || "")}</span></div>`
        : `<div class="card-value"><span class="unit">value TBD</span></div>`;
      const build = l.buildType === "speedbuild" ? "Speedbuild"
        : l.buildType === "original" ? "Original"
        : l.buildType === "cloned" ? "Cloned" : "";
      return `
          <a class="listing-card" href="listing.html?id=${encodeURIComponent(l.id)}">
            <div class="photo">
              <img src="${escapeHtml(cardPhoto(photo))}" alt="${escapeHtml(l.title || "Adopt Me house listing")}" loading="lazy" decoding="async">
              <div class="card-badge ${typeClass}" title="${typeLabel}"><div class="${typeIcon}"></div></div>
            </div>
            <div class="body">
              <h3>${escapeHtml(l.title || "Untitled build")}</h3>
              ${v}
              <p class="lister" style="margin-top:6px;">${house ? escapeHtml(house.name) : "Adopt Me house"}${build ? ` · ${build}` : ""}</p>
            </div>
          </a>`;
    })
    .join("");
}

export function browseHousesHtml(browse, houseById, builtOn) {
  const chip = "display:inline-block;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-weight:600;font-size:13px;text-decoration:none;";
  const known = browse.houseCounts.filter((h) => houseById[h.id]);
  const shown = known.slice(0, MAX_HOUSE_CHIPS);
  const hidden = known.length - shown.length;
  const chips = shown
    .map((h) => `<a href="../houses/${encodeURIComponent(h.id)}.html" style="${chip}">${escapeHtml(houseById[h.id].name)} <span style="color:var(--muted);font-weight:500;">${h.count}</span></a>`)
    .join("");
  if (!chips) return "";
  // Deliberately quiet: small heading, muted one-line summary, pill links in
  // the same style as the site's filters. It is there for crawlers and for
  // people who want a jump-off to a house's value page, not as a feature.
  return `
<section class="wrap" style="padding:0 0 48px;margin-top:-72px;">
  <h2 style="font-size:16px;margin:0 0 6px;color:var(--ink);">Houses with live listings</h2>
  <p class="hint" style="margin:0 0 12px;max-width:680px;">${browse.totalActive === 1 ? "One listing" : `${browse.totalActive} listings`} across ${browse.houseCounts.length} house ${browse.houseCounts.length === 1 ? "type" : "types"} as of ${escapeHtml(builtOn)}. Tap a house for its value, trade rules and verified trades.${hidden > 0 ? ` The ${shown.length} with the most listings are shown; the rest are on the <a href="../houses/index.html" style="color:var(--accent);">full house list</a>.` : ""}</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px;">${chips}</div>
</section>
`;
}

// ---- Recent Trades page -----------------------------------------------------

export function recentTradesHtml(trades, houseById) {
  return trades
    .map((t) => {
      const house = houseById[t.houseId];
      const ask = money(t.value, t.unit);
      return `
        <div class="trade-card" style="padding:12px 14px;">
          <div style="font-size:14px;font-weight:800;color:var(--ink);margin-bottom:6px;">${house ? escapeHtml(house.name) : escapeHtml(t.title || "Adopt Me house")}</div>
          <p class="hint" style="margin:0 0 4px;">${t.title ? escapeHtml(t.title) : "Verified house trade"}</p>
          <p class="hint" style="margin:0;">Verified by both traders${ask ? ` · asking ${escapeHtml(ask)}` : ""}${t.lister ? ` · listed by ${escapeHtml(t.lister)}` : ""}${t.at ? ` · ${escapeHtml(longDate(t.at))}` : ""}</p>
        </div>`;
    })
    .join("");
}

// ---- Entry point ------------------------------------------------------------

function patchFile(file, edits) {
  if (!existsSync(file)) {
    console.warn(`[page-snapshots] ${path.basename(file)} not found, skipping`);
    return;
  }
  let html = readFileSync(file, "utf-8");
  const before = html;
  for (const [name, content] of edits) {
    const next = replaceBetween(html, name, content);
    if (next === null) {
      console.warn(`[page-snapshots] ${path.basename(file)} has no SNAPSHOT:${name} markers, skipping that block`);
      continue;
    }
    html = next;
  }
  if (html !== before) writeFileSync(file, html);
}

export function injectSnapshots(stats, houses, publicDir = path.join(process.cwd(), "public")) {
  // Never write anything we could not read. Without data the pages keep
  // whatever they had, which in git is empty markers.
  if (!stats?.ok || !stats.browse) {
    console.log(`[page-snapshots] skipped (${stats?.reason || "no data"})`);
    return { browse: 0, trades: 0 };
  }

  try {
    const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
    const builtOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    patchFile(path.join(publicDir, "listings", "index.html"), [
      ["grid", browseGridHtml(stats.browse.listings, houseById)],
      ["houses", browseHousesHtml(stats.browse, houseById, builtOn)],
    ]);
    patchFile(path.join(publicDir, "recent-trades.html"), [
      ["trades", recentTradesHtml(stats.recentTrades || [], houseById)],
    ]);

    console.log(`[page-snapshots] wrote ${stats.browse.listings.length} listing(s) and ${(stats.recentTrades || []).length} trade(s) into static HTML`);
    return { browse: stats.browse.listings.length, trades: (stats.recentTrades || []).length };
  } catch (err) {
    console.warn("[page-snapshots] failed, leaving pages as they were:", err.message);
    return { browse: 0, trades: 0 };
  }
}
