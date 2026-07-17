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
    <rect x="20" y="18" width="60" height="34" rx="6" fill="#E63A63"/>
    <rect x="20" y="18" width="60" height="34" rx="6" fill="none" stroke="#C2264C" stroke-width="2"/>
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

// Canonical production domain — used in JSON-LD/sitemap regardless of
// which Netlify subdomain is currently serving the site, since schema and
// sitemap URLs should point at the real intended domain.
const SITE_URL = "https://adoptmehousetrading.com";

// Organization + WebSite JSON-LD, identical on every page — this is the
// "foundation schema" every guide agrees comes first, before anything
// page-specific: it's what lets search engines and AI systems recognize
// this as one coherent entity across all its pages rather than a pile of
// unrelated documents.
function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "AdoptMeHouseTrading.com",
        url: SITE_URL,
        description:
          "A fan-made resource for Roblox's Adopt Me! house trading community — house values, live trade listings, builder commissions, and a build registry. Not affiliated with Adopt Me or Roblox Corporation.",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "AdoptMeHouseTrading.com",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

function breadcrumbJsonLd(items) {
  // items: [{ name, path }] — path relative to site root, no leading slash
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}/${item.path}`,
    })),
  };
}

function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function layout({ title, description, path: routePath, depth, body, jsonLd = [], canonicalPath }) {
  const rootPrefix = depth === 0 ? "" : "../".repeat(depth);
  const canonical = `${SITE_URL}/${canonicalPath !== undefined ? canonicalPath : routePath === "home" ? "" : `${routePath}.html`}`;
  const allJsonLd = [siteJsonLd(), ...jsonLd];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rootPrefix}css/style.css">
${allJsonLd.map(jsonLdScript).join("\n")}
</head>
<body>
<header class="site-nav">
  <div class="wrap">
    <a class="brand" href="${rootPrefix}index.html">
      <span class="signpost-mini"></span>
      AdoptMeHouseTrading
    </a>
    <nav>
      <a href="${rootPrefix}listings/index.html" class="${routePath.startsWith("listings") ? "active" : ""}">Browse Houses</a>
      <a href="${rootPrefix}commissions/index.html" class="${routePath.startsWith("commissions") ? "active" : ""}">Commissions</a>
      <a href="${rootPrefix}comps.html" class="${routePath === "comps" ? "active" : ""}">Recent Trades</a>
      <div class="nav-more">
        <button type="button" class="nav-more-trigger ${routePath.startsWith("houses") || routePath.startsWith("registry") || routePath.startsWith("guides") ? "active" : ""}">More <span class="nav-more-caret"></span></button>
        <div class="nav-more-dropdown" hidden>
          <a href="${rootPrefix}houses/index.html">Values</a>
          <a href="${rootPrefix}registry/index.html">Build Registry</a>
          <a href="${rootPrefix}guides/index.html">Guides</a>
        </div>
      </div>
      <a href="${rootPrefix}profile.html" class="${routePath === "profile" ? "active" : ""}">Profile</a>
    </nav>
    <div class="nav-actions">
      <span id="nav-profile-pill"></span>
      <a class="btn btn-primary" href="${rootPrefix}list-a-house.html" style="padding:10px 20px;font-size:14px;">Add Listing</a>
    </div>
  </div>
</header>
<script type="module" src="${rootPrefix}js/nav.js"></script>
${body}
<footer class="site-footer">
  <div class="wrap">
    AdoptMeHouseTrading.com is a fan-made resource for Roblox's Adopt Me! house trading community — house values, live trade listings, builder commissions, and a build registry for verifying who built a house first. Not affiliated with, endorsed by, or sponsored by Adopt Me, Uplift Games, or Roblox Corporation.
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
    <div class="card-value">${priced ? `<span class="amount">${house.value}</span><span class="unit">${house.valueUnit}</span>` : `<span class="unit">Value TBD</span>`}</div>
  </div>
</a>`;
}

// ---------- Homepage ----------

function buildHomepage() {
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <div class="hero-eyebrow">Adopt Me House Trading</div>
      <h1>Trade houses.<br>Track real values.</h1>
      <p class="lede" style="margin-left:0;">List your house, see real offers in Pets, Vehicles, Toys and more, and check verified trade values before you commit.</p>
      <div class="hero-ctas" style="justify-content:flex-start;">
        <a class="btn btn-primary" href="listings/index.html">Browse Houses</a>
        <a class="btn btn-secondary" href="comps.html">See Recent Trades</a>
      </div>
    </div>
    <div class="big-sign-wrap">
      <div class="big-sign-frame">
        <div class="big-sign-post"></div>
        <div class="big-sign-crossbar"></div>
        <div class="big-sign-hang">
          <div class="big-sign-box">
            <div class="big-sign-text">FOR<br>TRADE</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="wrap">
  <div class="section-head">
    <h2>Recently Added</h2>
    <a href="listings/index.html">View all listings →</a>
  </div>
  <div id="recent-listings-grid" class="house-grid"></div>
  <div id="recent-listings-empty" class="form-card" hidden>
    <h1>No listings yet</h1>
    <p class="subtitle">Be the first to put a house up for trade.</p>
    <a class="btn btn-primary" href="list-a-house.html">List a House</a>
  </div>
</section>
<script type="module">
  import { CATEGORY_LABELS, THEME_LABELS } from "./js/api.js";
  const BADGE_CLASS = { house_trade: "house-trade", looking_for: "looking-for", commission: "commission" };
  const BADGE_ICON = { house_trade: "icon-sign", looking_for: "icon-loop", commission: "icon-hammer" };
  const TYPE_LABELS = { house_trade: "For Trade", looking_for: "Looking For", commission: "Commission" };

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  try {
    const [{ listings }, houses] = await Promise.all([
      fetch("/.netlify/functions/listings-list").then((r) => r.json()),
      fetch("data/houses.json").then((r) => r.json()),
    ]);
    const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
    const grid = document.getElementById("recent-listings-grid");

    if (!listings || !listings.length) {
      document.getElementById("recent-listings-empty").hidden = false;
    } else {
      grid.innerHTML = listings.slice(0, 8).map((listing) => {
        const house = houseById[listing.house_id];
        const photo = listing.photos?.[0] || house?.image || "images/brand/searchdog.png";
        const username = listing.profiles?.display_name || "unknown";
        const cardTag = listing.listing_type === "house_trade" && listing.is_cloned !== null
          ? \`<div class="card-tag \${listing.is_cloned ? "cloned" : ""}">\${listing.is_cloned ? "Cloned" : "Original"}</div>\`
          : "";
        const valueLine = listing.value_amount !== null && listing.value_amount !== undefined
          ? \`<div class="card-value"><span class="amount">\${listing.value_amount}</span><span class="unit">\${listing.value_unit || ""}</span></div>\`
          : \`<div class="card-value"><span class="unit">\${listing.listing_type === "commission" ? "quote on request" : "value TBD"}</span></div>\`;
        const themeLine = listing.themes?.length
          ? \`<p class="lister" style="margin-top:2px;">\${listing.themes.map((t) => THEME_LABELS[t] || t).join(", ")}</p>\`
          : "";

        return \`<a class="listing-card" href="listings/listing.html?id=\${listing.id}">
          <div class="photo">
            <img src="\${photo}" alt="" loading="lazy">
            <div class="card-badge \${BADGE_CLASS[listing.listing_type] || "house-trade"}"><div class="\${BADGE_ICON[listing.listing_type] || "icon-sign"}"></div></div>
            \${cardTag}
          </div>
          <div class="body">
            <h3>\${escapeHtml(listing.title)}</h3>
            <div class="trust-row">
              <span class="avatar-initial">\${escapeHtml(username[0]?.toUpperCase() || "?")}</span>
              <span class="username">\${escapeHtml(username)}</span>
            </div>
            \${valueLine}
            \${themeLine}
          </div>
        </a>\`;
      }).join("");
    }
  } catch (err) {
    document.getElementById("recent-listings-empty").hidden = false;
  }
</script>`;

  return layout({
    title: "AdoptMeHouseTrading.com — Adopt Me House Values & Trading",
    description: "Browse Adopt Me house values, check if a house trade is fair, and explore every tradeable house in Roblox's Adopt Me!.",
    path: "home",
    canonicalPath: "",
    depth: 0,
    body,
  });
}

// ---------- Browse page ----------

function buildBrowsePage() {
  const body = `
<section class="wrap">
  <div class="section-head" style="margin-top:40px;">
    <h1>House Values (${houses.length})</h1>
    <a href="../listings/index.html">Looking to trade? Browse live listings →</a>
  </div>
  <p class="hint" style="margin-bottom:20px;">Reference values for every house type in Adopt Me. To actually trade, head to <a href="../listings/index.html" style="color:var(--accent);">Browse Houses</a> to see real listings from real players.</p>
  <div class="house-grid">
    ${houses.map((h) => houseCard(h, "houses")).join("\n")}
  </div>
</section>`;

  return layout({
    title: "Adopt Me House Values — AdoptMeHouseTrading.com",
    description: "Reference values for every tradeable house in Adopt Me.",
    path: "houses/index",
    depth: 1,
    jsonLd: [breadcrumbJsonLd([{ name: "Home", path: "" }, { name: "Values", path: "houses/index.html" }])],
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
    jsonLd: [
      breadcrumbJsonLd([
        { name: "Home", path: "" },
        { name: "Values", path: "houses/index.html" },
        { name: house.name, path: `houses/${house.id}.html` },
      ]),
    ],
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
