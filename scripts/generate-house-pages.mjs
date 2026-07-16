// Generates static HTML pages from data/houses.json:
//   public/index.html          — homepage
//   public/houses/index.html   — full browse grid
//   public/houses/{id}.html    — one page per house
//
// Run `node scripts/parse-houses.mjs` first to (re)build houses.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "houses.json");
const OUT_HOUSES_DIR = path.join(process.cwd(), "public", "houses");

if (!existsSync(DATA_FILE)) {
  console.error("data/houses.json not found — run scripts/parse-houses.mjs first.");
  process.exit(1);
}

const houses = JSON.parse(readFileSync(DATA_FILE, "utf-8"));

// The signature signpost mark — a mailbox post with a swinging "FOR TRADE"
// sign, echoing the game's own trade mechanic. Reused in nav, hero, and
// detail badges at different sizes via the wrapping element.
const SIGNPOST_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="For Trade sign">
  <rect x="46" y="30" width="8" height="60" rx="2" fill="#7A5230"/>
  <g transform="rotate(-6 50 40)">
    <rect x="20" y="18" width="60" height="34" rx="6" fill="#C0473C"/>
    <rect x="20" y="18" width="60" height="34" rx="6" fill="none" stroke="#9E3A31" stroke-width="2"/>
    <text x="50" y="34" text-anchor="middle" font-family="Baloo 2, sans-serif" font-weight="700" font-size="11" fill="#FFFFFF">FOR</text>
    <text x="50" y="47" text-anchor="middle" font-family="Baloo 2, sans-serif" font-weight="700" font-size="11" fill="#FFFFFF">TRADE</text>
  </g>
</svg>`.trim();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout({ title, description, path: routePath, depth, body }) {
  const rootPrefix = depth === 0 ? "" : "../".repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="${rootPrefix}css/style.css">
</head>
<body>
<header class="site-nav">
  <div class="wrap">
    <a class="brand" href="${rootPrefix}index.html">
      <span class="sign-mark">${SIGNPOST_SVG}</span>
      AdoptMeHouseTrading
    </a>
    <nav>
      <a href="${rootPrefix}index.html">Home</a>
      <a href="${rootPrefix}houses/index.html" class="${routePath.startsWith("houses") ? "active" : ""}">Browse Houses</a>
      <a href="${rootPrefix}listings/index.html" class="${routePath.startsWith("listings") ? "active" : ""}">Trade Listings</a>
      <a href="${rootPrefix}comps.html">Recent Trades</a>
      <a href="${rootPrefix}list-a-house.html">List a House</a>
      <a href="${rootPrefix}profile.html">My Profile</a>
    </nav>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="wrap">
    AdoptMeHouseTrading.com is a fan-made resource for Roblox's Adopt Me! house trading community. Not affiliated with Adopt Me or Roblox Corporation.
    <div style="margin-top:8px;"><a href="${rootPrefix}rules.html" style="color:var(--sign-red);">Community Rules</a></div>
  </div>
</footer>
</body>
</html>`;
}

// context: "root" (page lives at public/index.html),
//          "houses" (page lives at public/houses/index.html or public/houses/{id}.html)
function houseCard(house, context) {
  const linkPrefix = context === "root" ? "houses/" : "";
  const imgPrefix = context === "root" ? "" : "../";
  const priced = house.value !== null;
  return `<a class="house-card" href="${linkPrefix}${house.id}.html">
  <div class="thumb"><img src="${imgPrefix}${house.image.slice(1)}" alt="${escapeHtml(house.name)}" loading="lazy"></div>
  <div class="info">
    <h3>${escapeHtml(house.name)}</h3>
    <p class="source">from ${escapeHtml(house.source)}</p>
    <span class="for-trade-tag ${priced ? "" : "unpriced"}">${priced ? `${house.value} ${house.valueUnit}` : "Value TBD"}</span>
  </div>
</a>`;
}

// ---------- Homepage ----------

function buildHomepage() {
  const featured = houses.slice(0, 8);
  const body = `
<section class="hero">
  <div class="wrap">
    <div class="hero-signpost">${SIGNPOST_SVG}</div>
    <h1>Know what your house is really worth.</h1>
    <p class="lede">Browse every tradeable house in Adopt Me, check values before you accept an offer, and find your next dream build.</p>
    <div class="hero-ctas">
      <a class="btn btn-primary" href="houses/index.html">Browse Houses</a>
      <a class="btn btn-secondary" href="houses/index.html">Check a Trade</a>
    </div>
  </div>
</section>
<section class="wrap">
  <div class="section-head">
    <h2>Recently Added</h2>
    <a href="houses/index.html">See all ${houses.length} houses →</a>
  </div>
  <div class="house-grid">
    ${featured.map((h) => houseCard(h, "root")).join("\n")}
  </div>
</section>`;

  return layout({
    title: "AdoptMeHouseTrading.com — Adopt Me House Values & Trading",
    description: "Browse Adopt Me house values, check if a house trade is fair, and explore every tradeable house in Roblox's Adopt Me!.",
    path: "home",
    depth: 0,
    body,
  });
}

// ---------- Browse page ----------

function buildBrowsePage() {
  const body = `
<section class="wrap">
  <div class="section-head" style="margin-top:40px;">
    <h2>All Houses (${houses.length})</h2>
  </div>
  <div class="house-grid">
    ${houses.map((h) => houseCard(h, "houses")).join("\n")}
  </div>
</section>`;

  return layout({
    title: "Browse All Adopt Me Houses — AdoptMeHouseTrading.com",
    description: "Every tradeable house in Adopt Me, with values and details.",
    path: "houses/index",
    depth: 1,
    body,
  });
}

// ---------- Detail pages ----------

function buildHousePage(house) {
  const priced = house.value !== null;
  const body = `
<section class="wrap house-detail">
  <div class="photo">
    <img src="../${house.image.slice(1)}" alt="${escapeHtml(house.name)}">
  </div>
  <div>
    <div class="signpost-badge">
      ${SIGNPOST_SVG.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100"')}
      <h1>${escapeHtml(house.name)}</h1>
    </div>
    <div class="meta-row">
      <span class="pill">${escapeHtml(house.rarity)}</span>
      <span class="pill">From: ${escapeHtml(house.source)}</span>
    </div>
    <div class="value-box">
      <div class="label">Trading Value</div>
      <div class="amount ${priced ? "" : "unpriced"}">${priced ? `${house.value} ${house.valueUnit}` : "Not yet valued"}</div>
    </div>
  </div>
</section>
<section class="wrap">
  <div class="section-head">
    <h2>More Houses</h2>
    <a href="index.html">Browse all →</a>
  </div>
  <div class="house-grid">
    ${houses.filter((h) => h.id !== house.id).slice(0, 4).map((h) => houseCard(h, "houses")).join("\n")}
  </div>
</section>`;

  return layout({
    title: `${house.name} — Adopt Me House Value | AdoptMeHouseTrading.com`,
    description: `${house.name} (from ${house.source}) — current Adopt Me house trading value and details.`,
    path: `houses/${house.id}`,
    depth: 1,
    body,
  });
}

function main() {
  mkdirSync(OUT_HOUSES_DIR, { recursive: true });

  writeFileSync(path.join(process.cwd(), "public", "index.html"), buildHomepage());
  writeFileSync(path.join(OUT_HOUSES_DIR, "index.html"), buildBrowsePage());

  for (const house of houses) {
    writeFileSync(path.join(OUT_HOUSES_DIR, `${house.id}.html`), buildHousePage(house));
  }

  console.log(`Generated homepage, browse page, and ${houses.length} house detail pages.`);
}

main();
