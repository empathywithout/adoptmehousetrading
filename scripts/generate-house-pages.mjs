// Generates static HTML pages from data/houses.json:
//   public/index.html          — homepage
//   public/houses/index.html   — full browse grid
//   public/houses/{id}.html    — one page per house
//
// Run `node scripts/parse-houses.mjs` first to (re)build houses.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { loadHouseStats } from "./lib/house-stats.mjs";
import { injectSnapshots } from "./lib/page-snapshots.mjs";
import { listingCardHtml, tradeCardHtml } from "./lib/cards.mjs";

const DATA_FILE = path.join(process.cwd(), "data", "houses.json");
const OUT_HOUSES_DIR = path.join(process.cwd(), "public", "houses");

if (!existsSync(DATA_FILE)) {
  console.error("data/houses.json not found — run scripts/parse-houses.mjs first.");
  process.exit(1);
}

const houses = JSON.parse(readFileSync(DATA_FILE, "utf-8"));

// Verified per-house facts (data/house-facts.json): features, sources and the
// date they were checked. Missing file or missing house just means that page
// renders without the facts-derived sections, never a failed build.
const FACTS_FILE = path.join(process.cwd(), "data", "house-facts.json");
const houseFacts = existsSync(FACTS_FILE) ? JSON.parse(readFileSync(FACTS_FILE, "utf-8")) : {};
const FACTS_CHECKED = "October 30, 2026";

// Dated house news (data/house-updates.json), newest first. Used on the homepage.
const UPDATES_FILE = path.join(process.cwd(), "data", "house-updates.json");
const houseUpdates = existsSync(UPDATES_FILE)
  ? JSON.parse(readFileSync(UPDATES_FILE, "utf-8")).sort((a, b) => b.date.localeCompare(a.date))
  : [];

// "September 25, 2026" / "July 2026" parse; "2018 (one of the original...)" does not. Unparseable is 0.
function releasedMs(house) {
  const t = Date.parse(house.released || "");
  return Number.isNaN(t) ? 0 : t;
}

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

// Matches the labels used across the site. These are in-game currencies,
// never real money, which is also why none of this is marked up as an Offer.
const UNIT_LABELS = { shark: "Shark", frost: "Frost", rp: "Ride Pot" };

// This site's own data for one house type. Returns "" when there is nothing
// to say, so a house nobody has listed or traded looks exactly as it did.
// Cards reuse the Browse page's styles (see scripts/lib/cards.mjs).
function siteDataSection(house, stats) {
  const d = stats?.byHouse?.[house.id];
  if (!d || (!d.tradeCount && !d.listingCount)) return "";

  const fallbackImage = house.image;

  // Verified trades first. Every other Adopt Me value site publishes an
  // opinion; this is the only section on the page reporting what a house
  // actually changed hands for, confirmed by both traders afterwards.
  const tradesHtml = d.trades.length ? `
  <div class="content-section">
    <h2>Verified ${escapeHtml(house.name)} Trades</h2>
    <p>${d.tradeCount === 1 ? "One swap has" : `${d.tradeCount} swaps have`} been confirmed by both traders after it happened in game. These are real completed trades, not estimates.</p>
    <div class="house-grid sd-grid" style="margin-top:16px;">${d.trades.map((t) => tradeCardHtml(t, { fallbackImage })).join("")}
    </div>
    <p class="sd-more" style="margin-top:14px;"><a href="../recent-trades.html">See every verified trade &rarr;</a></p>
  </div>` : "";

  const listingsHtml = d.listings.length ? `
  <div class="content-section">
    <h2>${escapeHtml(house.name)} Builds For Trade Right Now</h2>
    <p>${d.listingCount === 1
      ? "One live listing for this house."
      : `${d.listingCount} live listings for this house${d.listingCount > d.listings.length ? `, newest ${d.listings.length} shown` : ""}.`} Asking values are set by the lister and reflect the build inside, not just the house type.</p>
    <div class="house-grid sd-grid" style="margin-top:16px;">${d.listings.map((l) => listingCardHtml(l, {
      href: `../listings/listing.html?id=${encodeURIComponent(l.id)}`,
      showHouse: false, fallbackImage,
    })).join("")}
    </div>
    <p class="sd-more" style="margin-top:14px;"><a href="../listings/index.html">Browse all live listings &rarr;</a></p>
  </div>` : "";

  return tradesHtml + listingsHtml;
}

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
<link rel="icon" type="image/svg+xml" href="${rootPrefix}favicon.svg">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rootPrefix}css/style.css?v=3">
${allJsonLd.map(jsonLdScript).join("\n")}
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-REW2CFBX6H"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-REW2CFBX6H');
</script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1156955048210674" crossorigin="anonymous"></script>
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
      <a href="${rootPrefix}commissions/index.html" class="${routePath.startsWith("commissions") ? "active" : ""}">Find a Builder</a>
      <a href="${rootPrefix}recent-trades.html" class="${routePath === "recent-trades" ? "active" : ""}">Recent Trades</a>
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
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu"><span></span><span></span><span></span></button>
      <a class="btn btn-primary" href="${rootPrefix}list-a-house.html" style="padding:10px 20px;font-size:14px;">Add Listing</a>
    </div>
  </div>
</header>
<script type="module" src="${rootPrefix}js/nav.js"></script>
${body}
<footer class="site-footer">
  <div class="wrap">
    AdoptMeHouseTrading.com is a fan-made resource for Roblox's Adopt Me! house trading community — house values, live trade listings, builder commissions, and a build registry for verifying who built a house first. Not affiliated with, endorsed by, or sponsored by Adopt Me, Uplift Games, or Roblox Corporation.
    <div style="margin-top:8px;"><a href="${rootPrefix}rules.html" style="color:var(--sign-red);">Community Rules</a> · <a href="${rootPrefix}privacy.html" style="color:var(--sign-red);">Privacy Policy</a> · <a href="https://www.reddit.com/r/adoptmehousetrading/" style="color:var(--sign-red);" target="_blank" rel="noopener">Reddit</a></div>
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
  const src = house.originLabel || house.source || "";

  // Use availability field if present, otherwise fall back to source heuristic
  let avail = house.availability;
  if (!avail) {
    const isLimited = /\d{4}|christmas|winter|halloween|lunar|summer|spring|fall|event|pass/i.test(src) && !/build house menu|gamepass|robux|starter|default|update$/i.test(src);
    const isRobux = /robux|gamepass/i.test(src);
    avail = isLimited ? "limited" : isRobux ? "robux" : "obtainable";
  }

  let availTag = "";
  if (context === "houses") {
    const tagLabel = avail === "robux" ? "Gamepass" : avail === "limited" ? "Trade only" : avail === "unconfirmed" ? "Event" : "Bucks";
    availTag = `<span class="avail-tag ${avail}">${tagLabel}</span>`;
  }

  // Every house was labelled "Common" (it came from the image filename), so the pill carried no information.
  const rarityPill = "";
  const expandBadge = house.expandable ? `<span class="pill-sm expandable">Expandable</span>` : "";

  // Price line: use bucksPrice field if present, else extract from source
  let priceStr = "";
  if (house.bucksPrice === 0) priceStr = "Free (Starter)";
  else if (house.bucksPrice) priceStr = `${house.bucksPrice.toLocaleString()} Bucks`;
  else if (avail === "robux") priceStr = "Robux";
  const priceLine = priceStr ? `<span class="info-chip price-chip">🪙 ${priceStr}</span>` : "";

  const floorsLine = house.floors ? `<span class="info-chip">🏠 ${house.floors} floor${house.floors > 1 ? "s" : ""}</span>` : "";

  // Source label — strip price since we show it separately
  const srcClean = src.replace(/\s*\([\d,]+\s*Bucks\)/i, "").trim();
  const fromLine = srcClean ? `<p class="source"><span class="source-label">From:</span> ${escapeHtml(srcClean)}</p>` : "";

  return `<a class="house-card" href="${linkPrefix}${house.id}.html" data-name="${escapeHtml(house.name.toLowerCase())}" data-source="${escapeHtml(src.toLowerCase())}" data-avail="${avail}" data-price="${house.bucksPrice ?? -1}" data-released="${releasedMs(house)}">
  <div class="thumb"><img src="${imgPrefix}${house.image.slice(1)}" alt="${escapeHtml(house.name)}" loading="lazy" onerror="this.style.opacity='.3'">${availTag}</div>
  <div class="info">
    <h3>${escapeHtml(house.name)}</h3>
    <div class="card-meta">${rarityPill}${expandBadge}</div>
    <div class="info-chips">${priceLine}${floorsLine}</div>
    ${fromLine}
    ${house.released ? `<div class="card-value"><span class="unit">Released ${escapeHtml(house.released)}</span></div>` : ""}
  </div>
</a>`;
}

// ---------- Homepage ----------

function buildHomepage(stats) {
  const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
  const esc = escapeHtml;

  // Real numbers when the build could read the database; otherwise only counts that come from the house list.
  const live = stats?.ok ? Object.values(stats.byHouse) : null;
  const sum = (key) => live.reduce((n, d) => n + (d[key] || 0), 0);
  const tile = (value, label) => `<div>
        <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--ink);">${value}</div>
        <div style="font-size:12px;color:var(--muted);font-weight:600;">${label}</div>
      </div>`;
  const byStatus = (a) => houses.filter((h) => (h.availability || "obtainable") === a).length;
  const statTiles = live
    ? [tile(houses.length, "Adopt Me houses covered"), tile(sum("listingCount"), "live listings right now"),
       tile(live.filter((d) => d.listingCount > 0).length, "different houses listed"), tile(sum("tradeCount"), "verified trades")].join("")
    : [tile(houses.length, "Adopt Me houses covered"), tile(byStatus("obtainable"), "bought with Bucks"),
       tile(byStatus("robux"), "bought with Robux"), tile(byStatus("limited"), "trade only")].join("");

  // Static copy of the newest listings. The script below replaces it with the live, personalised version.
  const recentSnapshot = (stats?.browse?.listings || []).filter((l) => l.listingType !== "looking_for").slice(0, 8)
    .map((l) => listingCardHtml(l, {
      href: `listings/listing.html?id=${encodeURIComponent(l.id)}`,
      houseName: houseById[l.houseId]?.name, fallbackImage: houseById[l.houseId]?.image,
    })).join("");

  const newestHouses = [...houses].filter((h) => releasedMs(h)).sort((a, b) => releasedMs(b) - releasedMs(a)).slice(0, 4);
  const news = houseUpdates.slice(0, 4).map((u) => {
    const d = new Date(u.date + "T12:00:00Z");
    const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const links = (u.houses || []).slice(0, 3).map((id) => houseById[id] ? `<a href="houses/${esc(id)}.html" style="color:var(--accent);">${esc(houseById[id].name)}</a>` : "").filter(Boolean).join(", ");
    return `<li style="padding:14px 0;border-bottom:1px solid var(--line);">
        <div style="font-size:12px;color:var(--muted);font-weight:600;">${esc(when)}</div>
        <div style="font-weight:700;color:var(--ink);margin:2px 0 4px;">${esc(u.title)}</div>
        <p style="font-size:14px;color:var(--ink-soft);line-height:1.6;margin:0;">${esc(u.text)}${links ? ` <span style="color:var(--muted);">See: ${links}.</span>` : ""}</p>
      </li>`;
  }).join("");

  const step = (n, title, text) => `<div style="background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;">
        <div style="font-family:var(--font-display);font-weight:800;color:var(--accent);font-size:13px;">STEP ${n}</div>
        <div style="font-weight:700;color:var(--ink);margin:4px 0 6px;">${title}</div>
        <p style="font-size:14px;color:var(--ink-soft);line-height:1.6;margin:0;">${text}</p>
      </div>`;

  const body = `
<style>
.house-card .thumb { position:relative; }
.card-meta { display:flex; gap:5px; align-items:center; flex-wrap:wrap; margin:3px 0 2px; }
.info-chips { display:flex; gap:5px; flex-wrap:wrap; margin:4px 0 3px; }
.info-chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; background:var(--surface-alt,#f3f4f6); color:var(--ink-soft); border:1px solid var(--line); }
.info-chip.price-chip { color:var(--accent); border-color:var(--accent); background:var(--accent-soft,#f0f0ff); }
</style>
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <div class="hero-eyebrow">Adopt Me House Trading</div>
      <h1>Trade Adopt Me Houses.<br>Track Real Values.</h1>
      <p class="lede" style="margin-left:0;">List your Adopt Me house, get real offers in Pets, Vehicles, Toys, and more from real Roblox players, and see what houses have really traded for, confirmed by both sides, before you commit.</p>
      <div class="hero-ctas" style="justify-content:flex-start;">
        <a class="btn btn-primary" href="listings/index.html">Browse Houses</a>
        <a class="btn btn-secondary" href="recent-trades.html">See Recent Trades</a>
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
<section class="wrap" style="padding-top:8px;padding-bottom:0;">
  <div style="border:1px solid var(--line);border-radius:14px;padding:16px 28px;display:flex;gap:36px;flex-wrap:wrap;background:var(--surface);">${statTiles}</div>
</section>

<section class="wrap" style="padding-bottom:0;">
  <div class="section-head"><h2>How house trading works here</h2><a href="guides/how-to-trade-houses.html">Read the full guide →</a></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
    ${step(1, "List your house", "Add at least five photos, say which house it is, and mark whether the build is original or cloned. Ask for a value in Shark, Frost or Ride Pot.")}
    ${step(2, "Get offers", "Players offer pets, vehicles, toys and more. A house can be traded for anything except another house, and there is no Robux or real money in an offer.")}
    ${step(3, "Chat with preset messages", "Trade chat uses ready-made messages only, so nobody has to type personal details to a stranger.")}
    ${step(4, "Confirm it", "After the swap in game, both traders confirm it here. Trades confirmed by both sides show up on the Recent Trades page.")}
  </div>
</section>

<section class="wrap">
  <div class="section-head">
    <h2>Recently Added</h2>
    <a href="listings/index.html">View all listings →</a>
  </div>
  <div id="recent-listings-grid" class="house-grid">${recentSnapshot}</div>
  <div id="recent-listings-empty" class="form-card" hidden>
    <h1>No listings yet</h1>
    <p class="subtitle">Be the first to put a house up for trade.</p>
    <a class="btn btn-primary" href="list-a-house.html">List a House</a>
  </div>
</section>

<section class="wrap" style="padding-bottom:0;">
  <div class="section-head">
    <h2>Every Adopt Me house</h2>
    <a href="houses/index.html">See all ${houses.length} houses →</a>
  </div>
  <p style="font-size:14px;color:var(--ink-soft);line-height:1.65;max-width:720px;margin:0 0 16px;">${houses.length} houses covered, with price, release date, floors and trade status for each. ${byStatus("obtainable")} are bought with Bucks, ${byStatus("robux")} with Robux, and ${byStatus("limited")} are no longer sold and can only be traded for. Here are the newest.</p>
  <div class="house-grid" style="padding-bottom:20px;">
    ${newestHouses.map((h) => houseCard(h, "root")).join("\n")}
  </div>
</section>

${news ? `<section class="wrap" style="padding-bottom:0;">
  <div class="section-head"><h2>House news</h2></div>
  <ul style="list-style:none;padding:0;margin:0 0 20px;max-width:760px;">${news}</ul>
</section>` : ""}

<section class="wrap" style="padding-top:20px;padding-bottom:60px;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;background:var(--surface);border:1px solid var(--line);border-radius:12px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">📖</span>
      <span style="font-size:13.5px;color:var(--ink-soft);"><strong style="color:var(--ink);">Build guides & how-tos</strong> — theme walkthroughs, trading tips, and technique breakdowns from the community.</span>
    </div>
    <a href="guides/index.html" style="font-size:13px;font-weight:700;color:var(--accent);text-decoration:none;white-space:nowrap;flex-shrink:0;">Browse guides →</a>
  </div>
</section>

<script type="module">
  import { CATEGORY_LABELS, THEME_LABELS, sendToSignIn, avatarImg, cardPhoto } from "./js/api.js?v=7";
  const BADGE_CLASS = { house_trade: "house-trade", looking_for: "looking-for" };
  const BADGE_ICON = { house_trade: "icon-sign", looking_for: "icon-loop", commission: "icon-hammer" };
  const TYPE_LABELS = { house_trade: "For Trade", looking_for: "Looking For" };

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  try {
    const { loadReputation, reputationHtml } = await import("./js/api.js?v=7");
    const [{ listings }, houses, reputation] = await Promise.all([
      fetch("/.netlify/functions/listings-list?limit=24").then((r) => r.json()),
      fetch("data/houses.json").then((r) => r.json()),
      loadReputation(),
    ]);
    const myProfile = (() => { try { return JSON.parse(localStorage.getItem("amht_profile")); } catch { return null; } })();
    const token = localStorage.getItem("amht_token");
    const savedData = token
      ? await fetch("/.netlify/functions/listing-saves-me", { headers: { Authorization: \`Bearer \${token}\` } }).then(r => r.json()).catch(() => ({}))
      : {};
    let savedIds = new Set(savedData.saved_ids || []);
    const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
    const grid = document.getElementById("recent-listings-grid");

    if (!listings || !listings.length) {
      document.getElementById("recent-listings-empty").hidden = false;
    } else {
      grid.innerHTML = listings.filter(l => l.listing_type !== "looking_for").slice(0, 8).map((listing) => {
        const house = houseById[listing.house_id];
        const photo = listing.photos?.[0] || house?.image || "images/brand/searchdog.png";
        const username = listing.profiles?.display_name || "unknown";
        const cardTag = listing.listing_type === "house_trade" && listing.is_cloned !== null
          ? \`<div class="card-tag \${listing.is_cloned ? "cloned" : ""}">\${listing.is_cloned ? "Cloned" : "Original"}</div>\`
          : "";
        const valueLine = listing.value_amount !== null && listing.value_amount !== undefined
          ? \`<div class="card-value"><span class="amount">\${listing.value_amount}</span><span class="unit">\${listing.value_unit || ""}</span></div>\`
          : \`<div class="card-value"><span class="unit">value TBD</span></div>\`;
        const themeLine = listing.themes?.length
          ? \`<p class="lister" style="margin-top:2px;">\${listing.themes.map((t) => THEME_LABELS[t] || t).join(", ")}</p>\`
          : "";
        const isSaved = savedIds.has(listing.id);
        const saveCls = isSaved ? "save-btn saved" : "save-btn";
        const saveTitle = isSaved ? "Saved \u2014 click to remove" : "Save this listing to your watchlist";
        const saveTxt = isSaved ? "Saved" : "Save";
        const saveBtn = '<button class=\"' + saveCls + '\" data-listing-id=\"' + listing.id + '\" title=\"' + saveTitle + '\" onclick=\"event.preventDefault()\">' + saveTxt + '</button>';

        return \`<a class="listing-card" href="listings/listing.html?id=\${listing.id}">
          <div class="photo">
            <img src="\${cardPhoto(photo)}" alt="" loading="lazy" decoding="async">
            <div class="card-badge \${BADGE_CLASS[listing.listing_type] || "house-trade"}" title="\${TYPE_LABELS[listing.listing_type] || "For Trade"}"><div class="\${BADGE_ICON[listing.listing_type] || "icon-sign"}"></div></div>
            \${cardTag}
          </div>
          <div class="body">
            <h3>\${escapeHtml(listing.title)}</h3>
            <div class="trust-row">
              \${listing.profiles?.rbx_avatar_url ? avatarImg(listing.profiles.rbx_avatar_url, 48, 16, "trust-row-avatar") : \`<span class="avatar-initial">\${escapeHtml(username[0]?.toUpperCase() || "?")}</span>\`}
              <span class="username">\${escapeHtml(username)}</span>
              \${saveBtn}
            </div>
            \${reputationHtml(reputation[listing.profile_id])}
            \${valueLine}
            \${themeLine}
          </div>
        </a>\`;
      }).join("");

      // Save handler
      document.getElementById("recent-listings-grid").addEventListener("click", async (e) => {
        const btn = e.target.closest(".save-btn[data-listing-id]");
        if (!btn) return;
        e.preventDefault();
        if (!token) { sendToSignIn(); return; }
        const listingId = btn.dataset.listingId;
        btn.disabled = true;
        try {
          const res = await fetch("/.netlify/functions/listing-save", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: \`Bearer \${token}\` },
            body: JSON.stringify({ listing_id: listingId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Couldn't save");
          if (data.saved) { savedIds.add(listingId); } else { savedIds.delete(listingId); }
          btn.classList.toggle("saved", data.saved);
          btn.title = data.saved ? "Saved \u2014 click to remove" : "Save this listing to your watchlist";
          btn.textContent = data.saved ? "Saved" : "Save";
        } catch (err) { alert(err.message); }
        finally { btn.disabled = false; }
      });
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
<style>
.values-search-bar { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
.values-search-bar input { flex:1; min-width:200px; padding:10px 14px; border:1.5px solid var(--line); border-radius:10px; font-size:14px; background:var(--surface); color:var(--ink); outline:none; }
.values-search-bar input:focus { border-color:var(--accent); }
.filter-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
.filter-tab { padding:6px 14px; border-radius:20px; border:1.5px solid var(--line); background:var(--surface); color:var(--ink-soft); font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; }
.filter-tab:hover, .filter-tab.active { background:var(--accent); border-color:var(--accent); color:#fff; }
.avail-tag { position:absolute; top:8px; left:8px; font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; letter-spacing:.4px; text-transform:uppercase; }
.avail-tag.limited { background:#f0483e; color:#fff; }
.avail-tag.robux { background:#00a2ff; color:#fff; }
.avail-tag.obtainable { background:#22c55e; color:#fff; }
.avail-tag.unconfirmed { background:#8b5cf6; color:#fff; }
.house-card .thumb { position:relative; }
.no-results { display:none; padding:40px; text-align:center; color:var(--ink-soft); font-size:15px; }
.card-meta { display:flex; gap:5px; align-items:center; flex-wrap:wrap; margin:3px 0 2px; }
.pill-sm { font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; background:var(--line); color:var(--ink-soft); }
.pill-sm.expandable { background:#d1fae5; color:#065f46; }
.info-chips { display:flex; gap:5px; flex-wrap:wrap; margin:4px 0 3px; }
.info-chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; background:var(--surface-alt,#f3f4f6); color:var(--ink-soft); border:1px solid var(--line); }
.info-chip.price-chip { color:var(--accent); border-color:var(--accent); background:var(--accent-soft,#f0f0ff); }
.source-label { font-weight:700; color:var(--ink-soft); }
</style>
<section class="wrap">
  <div class="section-head" style="margin-top:40px;">
    <h1>All Adopt Me Houses (${houses.length})</h1>
    <a href="../listings/index.html">Looking to trade? Browse live listings →</a>
  </div>
  <p class="hint" style="margin-bottom:8px;">Every house in Adopt Me, with availability status and trade notes. Click any house for how to get it, what it looks like, and how trading it works.</p>
  <p class="hint" style="margin-bottom:16px;font-size:13px;">Note: house values in Adopt Me are <strong>build-specific</strong> — the same house type can trade for very different amounts depending on decoration quality and theme. <a href="../guides/index.html" style="color:var(--accent);">Read our trading guides</a> to understand how to evaluate a house's real trade value. &nbsp;<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="avail-tag obtainable" style="position:static;">Obtainable</span> = buyable now &nbsp; <span class="avail-tag robux" style="position:static;">Robux</span> = paid gamepass &nbsp; <span class="avail-tag limited" style="position:static;">Limited</span> = trade only</span></p>
  <div class="values-search-bar">
    <input type="search" id="house-search" placeholder="Search houses..." aria-label="Search houses">
    <select id="house-sort" style="padding:10px 14px;border:1.5px solid var(--line);border-radius:10px;font-size:14px;background:var(--surface);color:var(--ink);cursor:pointer;font-family:var(--font-body);font-weight:600;">
      <option value="alpha">A → Z</option>
      <option value="newest">Newest first</option>
      <option value="price-asc">Bucks price: Low → High</option>
      <option value="price-desc">Bucks price: High → Low</option>
    </select>
  </div>
  <div class="filter-tabs" id="filter-tabs">
    <button class="filter-tab active" data-filter="all">All (${houses.length})</button>
    <button class="filter-tab" data-filter="obtainable">Bucks (${houses.filter(h => (h.availability || "obtainable") === "obtainable").length})</button>
    <button class="filter-tab" data-filter="robux">Robux / Gamepass (${houses.filter(h => h.availability === "robux").length})</button>
    <button class="filter-tab" data-filter="unconfirmed">Event houses (${houses.filter(h => h.availability === "unconfirmed").length})</button>
    <button class="filter-tab" data-filter="limited">Trade only (${houses.filter(h => h.availability === "limited").length})</button>
  </div>
  <div class="house-grid" id="house-grid">
    ${houses.map((h) => houseCard(h, "houses")).join("\n")}
  </div>
  <p class="no-results" id="no-results">No houses match your search.</p>
</section>
<script>
(function() {
  const grid = document.getElementById('house-grid');
  const cards = Array.from(grid.querySelectorAll('.house-card'));
  const searchInput = document.getElementById('house-search');
  const sortSelect = document.getElementById('house-sort');
  const tabs = document.querySelectorAll('.filter-tab');
  const noResults = document.getElementById('no-results');
  let activeFilter = 'all';

  function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    const sortMode = sortSelect.value;

    // Sort cards
    const sorted = [...cards].sort((a, b) => {
      if (sortMode === 'newest') {
        const ar = parseFloat(a.dataset.released) || 0, br = parseFloat(b.dataset.released) || 0;
        if (!ar && br) return 1;
        if (!br && ar) return -1;
        return br - ar;
      }
      if (sortMode === 'price-asc' || sortMode === 'price-desc') {
        // Houses with no Bucks price (Robux or unconfirmed) always go last.
        const ap = parseFloat(a.dataset.price), bp = parseFloat(b.dataset.price);
        const aNo = !(ap >= 0), bNo = !(bp >= 0);
        if (aNo && !bNo) return 1;
        if (bNo && !aNo) return -1;
        return sortMode === 'price-asc' ? ap - bp : bp - ap;
      }
      return (a.dataset.name || '').localeCompare(b.dataset.name || '');
    });
    sorted.forEach(c => grid.appendChild(c));

    let visible = 0;
    cards.forEach(card => {
      const name = card.dataset.name || '';
      const source = card.dataset.source || '';
      const avail = card.dataset.avail || 'obtainable';
      const matchSearch = !q || name.includes(q) || source.includes(q);
      const matchFilter = activeFilter === 'all' || avail === activeFilter;
      const show = matchSearch && matchFilter;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    noResults.style.display = visible === 0 ? 'block' : 'none';
  }

  searchInput.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      applyFilters();
    });
  });
})();
</script>`;

  return layout({
    title: `Adopt Me House Values: All ${houses.length} Houses, Prices and Trade Status`,
    description: `All ${houses.length} Adopt Me houses with Bucks and Robux prices, release dates, floors and trade status. See which houses you can still buy and which are trade-only.`,
    path: "houses/index",
    depth: 1,
    jsonLd: [breadcrumbJsonLd([{ name: "Home", path: "" }, { name: "Values", path: "houses/index.html" }])],
    body,
  });
}

// ---------- Detail pages ----------

function availLabel(avail) {
  if (avail === "robux") return "Robux / Gamepass";
  if (avail === "limited") return "Trade only";
  if (avail === "unconfirmed") return "Event house";
  return "Bucks";
}

// ---- House-specific sections (built from data/house-facts.json + live stats) ----

const SOURCE_LABELS = [
  ["playadopt.me", "Adopt Me Help Center"],
  ["fandom.com", "Adopt Me Wiki"],
  ["bloxodes.com", "Bloxodes"],
  ["progameguides.com", "Pro Game Guides"],
  ["ginx.tv", "GINX"],
  ["sportskeeda.com", "Sportskeeda"],
  ["allthings.how", "AllThings.How"],
  ["u7buy.com", "U7Buy"],
];
function sourceLabel(url) {
  const hit = SOURCE_LABELS.find(([d]) => url.includes(d));
  if (hit) return hit[1];
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<p>${escapeHtml(t)}</p>`)
    .join("\n    ");
}

function featuresSection(house) {
  const f = houseFacts[house.id];
  if (!f || !f.features || !f.features.length) return "";
  return `
  <div class="content-section">
    <h2>What to look for in the ${escapeHtml(house.name)}</h2>
    <ul class="factors-list">
      ${f.features.map((x) => `<li>${escapeHtml(x)}</li>`).join("\n      ")}
    </ul>
  </div>`;
}

// Asking prices from this site's own live listings. Per unit, never converted.
// Shown only when there are enough listings to call it a range (see
// MIN_ASKS_FOR_RANGE in house-stats.mjs); otherwise this returns "".
function askStatsSection(house, stats) {
  const d = stats?.byHouse?.[house.id];
  if (!d?.askStats?.length) return "";
  const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const rows = d.askStats.map((a) => `<tr>
        <td>${escapeHtml(UNIT_LABELS[a.unit] || a.unit)}</td>
        <td>${a.n}</td>
        <td>${num(a.min)}</td>
        <td class="val-col">${num(a.median)}</td>
        <td>${num(a.max)}</td>
      </tr>`).join("");
  return `
  <div class="content-section">
    <h2>What people are asking for the ${escapeHtml(house.name)} on this site</h2>
    <p>These are asking prices from live listings, set by the players who posted them. They are not confirmed trade values, and a build's decorations and theme change what someone asks. Shark, Frost and Ride Pot are listed separately because there is no fixed rate between them.</p>
    <table class="rp-table">
      <thead><tr><th>Unit</th><th>Listings</th><th>Lowest</th><th>Middle</th><th>Highest</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">Updated each time the site rebuilds, about once a day.</p>
  </div>`;
}

// What people are doing with this house on this site: real counts from live
// listings, saves and confirmed trades. Replaces the old hand-typed "demand"
// label. Tiles with a zero are left out, and with nothing to show the whole
// section is omitted, so a quiet house never gets an invented rating.
function activitySection(house, stats) {
  const d = stats?.byHouse?.[house.id];
  if (!d) return "";
  const tiles = [
    d.lookingFor > 0 && ["Looking for it", `${d.lookingFor} ${d.lookingFor === 1 ? "person" : "people"}`],
    d.saves > 0 && ["Watching listings", `${d.saves} ${d.saves === 1 ? "save" : "saves"}`],
    d.tradeCount > 0 && ["Verified trades", d.recentTradeCount > 0 && d.recentTradeCount !== d.tradeCount ? `${d.tradeCount} (${d.recentTradeCount} in 90 days)` : String(d.tradeCount)],
    d.forTradeCount > 0 && ["Live listings", String(d.forTradeCount)],
  ].filter(Boolean);
  if (!tiles.length) return "";
  return `
  <div class="content-section">
    <h2>Activity for the ${escapeHtml(house.name)} on this site</h2>
    <p>What players are doing with this house here right now. These counts come from live listings, saves and confirmed trades, and update about once a day.</p>
    <div class="spec-grid">
      ${tiles.map(([label, val]) => `<div class="spec-item"><span class="spec-label">${escapeHtml(label)}</span><span class="spec-val">${escapeHtml(val)}</span></div>`).join("\n      ")}
    </div>
  </div>`;
}

function tradingSection(house) {
  if (!house.tradingNotes) return "";
  return `
  <div class="content-section">
    <h2>Trading the ${escapeHtml(house.name)}</h2>
    <div class="trading-notes">${escapeHtml(house.tradingNotes)}</div>
    <p>Every house trade follows the same official rules, including needing a trade license and owning at least two houses. The <a href="../guides/how-to-trade-houses.html" style="color:var(--accent);">how to trade houses guide</a> walks through them step by step.</p>
  </div>`;
}

function factsFootnote(house) {
  const f = houseFacts[house.id];
  if (!f) return "";
  const seen = new Set();
  const links = (f.sources || [])
    .filter((u) => { const l = sourceLabel(u); if (seen.has(l)) return false; seen.add(l); return true; })
    .map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${escapeHtml(sourceLabel(u))}</a>`)
    .join(", ");
  return `
  <div class="content-section">
    <p class="hint">Facts on this page were checked on ${FACTS_CHECKED}${links ? ` against ${links}` : ""}. Prices, availability and release details can change with game updates, so check in game before you trade.</p>
  </div>`;
}

// The box under the house's facts. It used to show a community RP value copied
// from another site. It now shows only this site's own numbers: the middle
// asking price from live listings when there are enough, otherwise how many
// listings there are, and never a made-up figure.
function siteBox(house, stats) {
  const d = stats?.byHouse?.[house.id];
  const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const best = d?.askStats?.[0];
  let main, sub;
  if (best) {
    const unit = UNIT_LABELS[best.unit] || best.unit;
    main = `${num(best.median)} ${unit}`;
    sub = `Middle asking price across ${best.n} live ${unit} listings, from ${num(best.min)} to ${num(best.max)}. These are asking prices set by the players listing, not confirmed trade values.`;
  } else if (d?.listingCount) {
    main = `${d.listingCount} live ${d.listingCount === 1 ? "listing" : "listings"}`;
    sub = "Not enough listings in one unit yet to show an asking-price range. A range appears once three or more listings use the same unit.";
  } else if (stats?.ok) {
    main = "No listings yet";
    sub = "Nobody has listed this house here right now. Build quality and theme change what players ask, so check the live listings when one appears.";
  } else {
    main = "Live listings";
    sub = "Build quality and theme change what players ask for the same house. Browse the live listings to see current asking prices.";
  }
  return `<div class="value-box">
      <div class="label">On this site</div>
      <div class="amount">${escapeHtml(main)}</div>
      <p class="value-subtext">${escapeHtml(sub)}</p>
    </div>`;
}

function buildHousePage(house, stats) {
  const avail = house.availability || "obtainable";

  // Spec chips
  const specs = [];
  if (house.floors) specs.push(`<div class="spec-item"><span class="spec-label">Floors</span><span class="spec-val">${house.floors}</span></div>`);
  if (house.expandable) specs.push(`<div class="spec-item"><span class="spec-label">Expandable</span><span class="spec-val">Yes</span></div>`);
  const availChip = `<div class="spec-item"><span class="spec-label">Availability</span><span class="spec-val">${availLabel(avail)}</span></div>`;
  const sourceChip = house.released
    ? `<div class="spec-item"><span class="spec-label">Released</span><span class="spec-val">${escapeHtml(house.released)}</span></div>`
    : "";
  if (house.bucksPrice === 0) specs.push(`<div class="spec-item"><span class="spec-label">Price</span><span class="spec-val">Free (starter)</span></div>`);
  else if (house.bucksPrice) specs.push(`<div class="spec-item"><span class="spec-label">Price</span><span class="spec-val">${house.bucksPrice.toLocaleString()} Bucks</span></div>`);
  else if (house.robuxPrice) specs.push(`<div class="spec-item"><span class="spec-label">Price</span><span class="spec-val">${house.robuxPrice.toLocaleString()} Robux</span></div>`);
  else if (avail === "robux") specs.push(`<div class="spec-item"><span class="spec-label">Price</span><span class="spec-val">Robux</span></div>`);

  // Related: different availability category houses, then same category, capped at 4 total
  const related = [
    ...houses.filter(h => h.id !== house.id && h.availability !== avail).slice(0, 2),
    ...houses.filter(h => h.id !== house.id && h.availability === avail).slice(0, 2),
  ].slice(0, 4);

  // Truncated description for meta (first sentence)
  const metaDesc = house.summary
    ? house.summary
    : `${house.name} in Adopt Me: how to get it, what it looks like and how it trades.`;

  const body = `
<style>
.house-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:start; padding:40px 0 20px; }
@media(max-width:680px){.house-detail-grid{grid-template-columns:1fr;gap:24px;}}
.house-detail-photo { border-radius:16px; overflow:hidden; background:var(--surface); border:1px solid var(--line); }
.house-detail-photo img { width:100%; display:block; }
.house-detail-meta h1 { font-family:'Baloo 2',sans-serif; font-size:clamp(22px,4vw,32px); font-weight:800; margin:0 0 10px; }
.meta-pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
.avail-pill { font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; letter-spacing:.3px; text-transform:uppercase; }
.avail-pill.limited { background:#fde8e8; color:#b91c1c; }
.avail-pill.robux { background:#dbeafe; color:#1d4ed8; }
.avail-pill.obtainable { background:#dcfce7; color:#15803d; }
.avail-pill.unconfirmed { background:#ede9fe; color:#6d28d9; }
.demand-badge { font-size:12px; font-weight:600; padding:3px 10px; border-radius:20px; background:var(--surface-alt,#f3f4f6); color:var(--ink-soft); border:1px solid var(--line); }
.demand-badge.wanted { background:var(--accent-soft,#fbeae7); color:var(--accent-dark,#c93a2e); border-color:var(--accent); }
.value-box { background:var(--surface); border:1.5px solid var(--line); border-radius:12px; padding:16px 20px; margin:16px 0; }
.value-box .label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--ink-soft); margin-bottom:4px; }
.value-box .amount { font-family:'Baloo 2',sans-serif; font-size:22px; font-weight:800; color:var(--accent); }
.value-box .amount.unpriced { color:var(--ink-soft); font-size:16px; font-weight:600; }
.value-subtext { font-size:12px; color:var(--ink-soft); margin-top:6px; line-height:1.5; }
.spec-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; margin-top:12px; }
.spec-item { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
.spec-label { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); margin-bottom:2px; }
.spec-val { font-size:13px; font-weight:600; color:var(--ink); }
.content-section { padding:32px 0; border-top:1px solid var(--line); }
.content-section h2 { font-family:'Baloo 2',sans-serif; font-size:20px; font-weight:800; margin:0 0 12px; }
.content-section p { font-size:15px; line-height:1.7; color:var(--ink-soft); margin:0 0 12px; }
.content-section p:last-child { margin-bottom:0; }
.rp-table { width:100%; border-collapse:collapse; font-size:14px; margin:12px 0; }
.rp-table th { text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); padding:6px 12px; border-bottom:1.5px solid var(--line); }
.rp-table td { padding:9px 12px; border-bottom:1px solid var(--line); color:var(--ink); }
.rp-table tr:last-child td { border-bottom:none; }
.rp-table .val-col { font-weight:700; color:var(--accent); }
.trading-notes { background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:0 10px 10px 0; padding:14px 16px; font-size:14px; line-height:1.65; color:var(--ink); margin:12px 0; }
.cta-strip { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:16px 20px; background:var(--accent-soft,#f0f0ff); border:1px solid var(--accent); border-radius:12px; }
.cta-strip p { font-size:14px; color:var(--ink); margin:0; flex:1; }
.cta-strip a { font-size:13px; font-weight:700; color:var(--accent); white-space:nowrap; text-decoration:none; padding:8px 16px; background:var(--accent); color:#fff; border-radius:8px; }
.factors-list { list-style:none; padding:0; margin:12px 0; display:flex; flex-direction:column; gap:8px; }
.sd-grid { padding-bottom:0; }
.sd-grid .listing-card .body { min-height:130px; }
.sd-grid .photo img.fallback { object-fit:contain; padding:10px; box-sizing:border-box; }
.house-card .thumb { position:relative; }
.avail-tag { position:absolute; top:8px; left:8px; font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; letter-spacing:.4px; text-transform:uppercase; white-space:nowrap; }
.avail-tag.limited { background:#f0483e; color:#fff; }
.avail-tag.robux { background:#00a2ff; color:#fff; }
.avail-tag.obtainable { background:#22c55e; color:#fff; }
.avail-tag.unconfirmed { background:#8b5cf6; color:#fff; }
.card-meta { display:flex; gap:5px; align-items:center; flex-wrap:wrap; margin:3px 0 2px; }
.pill-sm.expandable { background:#d1fae5; color:#065f46; font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; }
.info-chips { display:flex; gap:5px; flex-wrap:wrap; margin:4px 0 3px; }
.info-chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; background:var(--surface-alt,#f3f4f6); color:var(--ink-soft); border:1px solid var(--line); }
.info-chip.price-chip { color:var(--accent); border-color:var(--accent); background:var(--accent-soft,#f0f0ff); }
.factors-list li { display:flex; gap:10px; align-items:flex-start; font-size:14px; color:var(--ink-soft); line-height:1.55; }
.factors-list li::before { content:""; flex-shrink:0; width:6px; height:6px; border-radius:50%; background:var(--accent); margin-top:7px; }
</style>

<div class="wrap house-detail-grid">
  <div class="house-detail-photo">
    <img src="../${house.image.slice(1)}" alt="${escapeHtml(house.name)}">
  </div>
  <div class="house-detail-meta">
    <div class="meta-pills">
      <span class="avail-pill ${avail}">${availLabel(avail)}</span>
      ${stats?.byHouse?.[house.id]?.mostWanted ? `<span class="demand-badge wanted" title="One of the five houses people look for and watch most on this site">Most wanted on this site</span>` : ""}
    </div>
    <h1>${escapeHtml(house.name)}</h1>
    <div class="spec-grid">
      ${sourceChip}
      ${availChip}
      ${specs.join("")}
    </div>
    ${siteBox(house, stats)}
    <a class="btn btn-primary" href="../listings/index.html" style="display:inline-block;text-decoration:none;margin-top:4px;">Browse listings for this house →</a>
  </div>
</div>

<div class="wrap">
  ${house.description ? `
  <div class="content-section">
    <h2>About the ${escapeHtml(house.name)}</h2>
    ${paragraphs(house.description)}
  </div>` : ""}
  ${featuresSection(house)}
  ${activitySection(house, stats)}
  ${askStatsSection(house, stats)}
  ${siteDataSection(house, stats)}
  ${tradingSection(house)}

  <div class="content-section">
    <div class="cta-strip">
      <p>See what real players are offering for ${escapeHtml(house.name)} builds right now — browse live house listings and make offers directly.</p>
      <a href="../listings/index.html">Browse live listings</a>
    </div>
  </div>

  <div class="content-section">
    <div class="section-head" style="border-top:none;padding-top:0;">
      <h2>More Houses</h2>
      <a href="index.html">Browse all →</a>
    </div>
    <div class="house-grid">
      ${related.map((h) => houseCard(h, "houses")).join("\n")}
    </div>
  </div>
  ${factsFootnote(house)}
</div>`;

  return layout({
    title: `${house.name} Value & Trade Guide — AdoptMeHouseTrading.com`,
    description: metaDesc,
    path: `houses/${house.id}`,
    depth: 1,
    jsonLd: [
      breadcrumbJsonLd([
        { name: "Home", path: "" },
        { name: "Values", path: "houses/index.html" },
        { name: house.name, path: `houses/${house.id}.html` },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": `${house.name} in Adopt Me: facts and trading`,
        "description": metaDesc,
        "url": `https://adoptmehousetrading.com/houses/${house.id}.html`,
        "dateModified": "2026-10-30",
        "about": { "@type": "Thing", "name": `${house.name} (Adopt Me house)` },
      },
    ],
    body,
  });
}

async function main() {
  mkdirSync(OUT_HOUSES_DIR, { recursive: true });

  // One read for all 54 pages. Returns an empty map rather than throwing when
  // the database is unreachable or unconfigured, so a Neon blip degrades the
  // pages instead of failing the deploy.
  const stats = await loadHouseStats();

  writeFileSync(path.join(process.cwd(), "public", "index.html"), buildHomepage(stats));
  writeFileSync(path.join(OUT_HOUSES_DIR, "index.html"), buildBrowsePage());

  let enriched = 0;
  for (const house of houses) {
    const d = stats.byHouse?.[house.id];
    if (d && (d.tradeCount || d.listingCount)) enriched++;
    writeFileSync(path.join(OUT_HOUSES_DIR, `${house.id}.html`), buildHousePage(house, stats));
  }

  // The Browse and Recent Trades pages fill themselves from a function at
  // runtime, so a crawler sees an empty shell. This bakes a snapshot of the
  // same data into their HTML (markers in those files); the pages' own
  // scripts still replace it with the live version. No-op without data.
  injectSnapshots(stats, houses);

  console.log(
    `Generated homepage, browse page, and ${houses.length} house detail pages` +
    (stats.ok ? ` (${enriched} with live site data).` : ` (no site data: ${stats.reason}).`)
  );
}

await main();
