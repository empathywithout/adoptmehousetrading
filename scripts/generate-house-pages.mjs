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
<link rel="icon" type="image/svg+xml" href="${rootPrefix}favicon.svg">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rootPrefix}css/style.css">
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
  const priced = house.value !== null;
  const src = house.source || "";

  // Use availability field if present, otherwise fall back to source heuristic
  let avail = house.availability;
  if (!avail) {
    const isLimited = /\d{4}|christmas|winter|halloween|lunar|summer|spring|fall|event|pass/i.test(src) && !/build house menu|gamepass|robux|starter|default|update$/i.test(src);
    const isRobux = /robux|gamepass/i.test(src);
    avail = isLimited ? "limited" : isRobux ? "robux" : "obtainable";
  }

  let availTag = "";
  if (context === "houses") {
    const tagLabel = avail === "robux" ? "Gamepass" : avail === "limited" ? "Limited" : "Obtainable";
    availTag = `<span class="avail-tag ${avail}">${tagLabel}</span>`;
  }

  const rarityPill = house.rarity ? `<span class="pill-sm">${escapeHtml(house.rarity)}</span>` : "";
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

  return `<a class="house-card" href="${linkPrefix}${house.id}.html" data-name="${escapeHtml(house.name.toLowerCase())}" data-source="${escapeHtml(src.toLowerCase())}" data-avail="${avail}" data-value="${house.value !== null ? house.value : -1}">
  <div class="thumb"><img src="${imgPrefix}${house.image.slice(1)}" alt="${escapeHtml(house.name)}" loading="lazy" onerror="this.style.opacity='.3'">${availTag}</div>
  <div class="info">
    <h3>${escapeHtml(house.name)}</h3>
    <div class="card-meta">${rarityPill}${expandBadge}</div>
    <div class="info-chips">${priceLine}${floorsLine}</div>
    ${fromLine}
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
      <h1>Trade Adopt Me Houses.<br>Track Real Values.</h1>
      <p class="lede" style="margin-left:0;">List your Adopt Me house, get real offers in Pets, Vehicles, Toys, and more from real Roblox players, and check verified trade values — not guesswork — before you commit.</p>
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

<section class="wrap" style="padding-bottom:0;">
  <div class="section-head">
    <h2>House Values</h2>
    <a href="houses/index.html">See all 52 houses →</a>
  </div>
  <div style="background:var(--surface);border:1.5px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:0;">
    <div style="padding:24px 28px 20px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div style="max-width:520px;">
        <div style="font-family:var(--font-display);font-size:1.15rem;font-weight:800;color:var(--ink);margin-bottom:8px;">Know the value before you trade</div>
        <p style="font-size:14px;color:var(--muted);line-height:1.65;margin:0;">Community RP values for all 52 tradeable Adopt Me houses — limited, Robux, and free-to-play. Sort by value or search by name. Updated September 2026.</p>
      </div>
      <a href="houses/index.html" class="btn btn-primary" style="flex-shrink:0;align-self:center;">Check House Values</a>
    </div>
    <div style="border-top:1px solid var(--line);padding:16px 28px;display:flex;gap:32px;flex-wrap:wrap;">
      <div>
        <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--ink);">52</div>
        <div style="font-size:12px;color:var(--muted);font-weight:600;">tradeable houses</div>
      </div>
      <div>
        <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--ink);">RP</div>
        <div style="font-size:12px;color:var(--muted);font-weight:600;">community pricing unit</div>
      </div>
      <div>
        <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--ink);">Sept '26</div>
        <div style="font-size:12px;color:var(--muted);font-weight:600;">last updated</div>
      </div>
    </div>
  </div>
</section>

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
  import { CATEGORY_LABELS, THEME_LABELS } from "./js/api.js";
  const BADGE_CLASS = { house_trade: "house-trade", looking_for: "looking-for" };
  const BADGE_ICON = { house_trade: "icon-sign", looking_for: "icon-loop", commission: "icon-hammer" };
  const TYPE_LABELS = { house_trade: "For Trade", looking_for: "Looking For" };

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  try {
    const [{ listings }, houses] = await Promise.all([
      fetch("/.netlify/functions/listings-list").then((r) => r.json()),
      fetch("data/houses.json").then((r) => r.json()),
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
        const saveTitle = isSaved ? "Saved \u2014 click to unsave" : "Save this listing";
        const saveTxt = isSaved ? "Saved" : "Save";
        const saveBtn = '<button class=\"' + saveCls + '\" data-listing-id=\"' + listing.id + '\" title=\"' + saveTitle + '\" onclick=\"event.preventDefault()\">' + saveTxt + '</button>';

        return \`<a class="listing-card" href="listings/listing.html?id=\${listing.id}">
          <div class="photo">
            <img src="\${photo}" alt="" loading="lazy">
            <div class="card-badge \${BADGE_CLASS[listing.listing_type] || "house-trade"}" title="\${TYPE_LABELS[listing.listing_type] || "For Trade"}"><div class="\${BADGE_ICON[listing.listing_type] || "icon-sign"}"></div></div>
            \${cardTag}
          </div>
          <div class="body">
            <h3>\${escapeHtml(listing.title)}</h3>
            <div class="trust-row">
              \${listing.profiles?.rbx_avatar_url ? \`<img class="trust-row-avatar" src="\${listing.profiles.rbx_avatar_url}" alt="">\` : \`<span class="avatar-initial">\${escapeHtml(username[0]?.toUpperCase() || "?")}</span>\`}
              <span class="username">\${escapeHtml(username)}</span>
              \${saveBtn}
            </div>
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
        if (!token) { alert("Sign in to save listings."); return; }
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
          btn.title = data.saved ? "Saved \u2014 click to unsave" : "Save this listing";
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
  <p class="hint" style="margin-bottom:8px;">Every house in Adopt Me, with availability status and trade notes. Click any house for full value context, trading tips, and a currency reference guide.</p>
  <p class="hint" style="margin-bottom:16px;font-size:13px;">Note: house values in Adopt Me are <strong>build-specific</strong> — the same house type can trade for very different amounts depending on decoration quality and theme. <a href="../guides/index.html" style="color:var(--accent);">Read our trading guides</a> to understand how to evaluate a house's real trade value. &nbsp;<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="avail-tag obtainable" style="position:static;">Obtainable</span> = buyable now &nbsp; <span class="avail-tag robux" style="position:static;">Robux</span> = paid gamepass &nbsp; <span class="avail-tag limited" style="position:static;">Limited</span> = trade only</span></p>
  <div class="values-search-bar">
    <input type="search" id="house-search" placeholder="Search houses..." aria-label="Search houses">
    <select id="house-sort" style="padding:10px 14px;border:1.5px solid var(--line);border-radius:10px;font-size:14px;background:var(--surface);color:var(--ink);cursor:pointer;font-family:var(--font-body);font-weight:600;">
      <option value="alpha">A → Z</option>
      <option value="value-desc">Value: High → Low</option>
      <option value="value-asc">Value: Low → High</option>
    </select>
  </div>
  <div class="filter-tabs" id="filter-tabs">
    <button class="filter-tab active" data-filter="all">All (${houses.length})</button>
    <button class="filter-tab" data-filter="obtainable">Obtainable (${houses.filter(h => (h.availability || "obtainable") === "obtainable").length})</button>
    <button class="filter-tab" data-filter="robux">Robux / Gamepass (${houses.filter(h => h.availability === "robux").length})</button>
    <button class="filter-tab" data-filter="limited">Limited (${houses.filter(h => h.availability === "limited").length})</button>
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
      if (sortMode === 'value-desc') {
        const av = parseFloat(a.dataset.value) || 0, bv = parseFloat(b.dataset.value) || 0;
        return bv - av;
      }
      if (sortMode === 'value-asc') {
        const av = parseFloat(a.dataset.value) || 0, bv = parseFloat(b.dataset.value) || 0;
        if (av <= 0 && bv > 0) return 1;
        if (bv <= 0 && av > 0) return -1;
        return av - bv;
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
    title: "Adopt Me House Values — All 52 Houses Ranked by Trade Value",
    description: `All ${houses.length} tradeable houses in Adopt Me with availability, specs, and trading context. Find out which houses are limited, which are obtainable, and what makes each one worth trading for.`,
    path: "houses/index",
    depth: 1,
    jsonLd: [breadcrumbJsonLd([{ name: "Home", path: "" }, { name: "Values", path: "houses/index.html" }])],
    body,
  });
}

// ---------- Detail pages ----------

function availLabel(avail) {
  if (avail === "robux") return "Robux / Gamepass";
  if (avail === "limited") return "Limited (trade only)";
  return "Obtainable";
}

function demandBadge(level) {
  if (!level) return "";
  const map = { high: ["🔥", "High demand"], medium: ["📈", "Moderate demand"], low: ["➖", "Lower demand"] };
  const [icon, label] = map[level] || ["", level];
  return `<span class="demand-badge demand-${level}">${icon} ${label}</span>`;
}

function buildHousePage(house) {
  const priced = house.value !== null;
  const avail = house.availability || "obtainable";

  // Spec chips
  const specs = [];
  if (house.floors) specs.push(`<div class="spec-item"><span class="spec-label">Floors</span><span class="spec-val">${house.floors}</span></div>`);
  if (house.expandable) specs.push(`<div class="spec-item"><span class="spec-label">Expandable</span><span class="spec-val">Yes</span></div>`);
  const availChip = `<div class="spec-item"><span class="spec-label">Availability</span><span class="spec-val">${availLabel(avail)}</span></div>`;
  const sourceChip = `<div class="spec-item"><span class="spec-label">From</span><span class="spec-val">${escapeHtml(house.source)}</span></div>`;
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
  const metaDesc = house.description
    ? house.description.replace(/\.\s.*/, ".").slice(0, 155)
    : `${house.name} (from ${house.source}) — current Adopt Me house trading value, specs, and trading tips.`;

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
.demand-badge { font-size:12px; font-weight:600; padding:3px 10px; border-radius:20px; background:var(--surface-alt,#f3f4f6); color:var(--ink-soft); border:1px solid var(--line); }
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
      ${house.demandLevel ? demandBadge(house.demandLevel) : ""}
    </div>
    <h1>${escapeHtml(house.name)}</h1>
    <div class="spec-grid">
      ${sourceChip}
      ${availChip}
      ${specs.join("")}
    </div>
    <div class="value-box">
      <div class="label">Trading Value</div>
      <div class="amount ${priced ? "" : "unpriced"}">${priced ? `${house.value} ${house.valueUnit}` : "Community value pending"}</div>
      <p class="value-subtext">${priced
        ? "Community-observed trade value. Decorated builds may trade higher — check live listings for current offers."
        : "House values in Adopt Me are build-specific — the same house type can trade for very different amounts depending on decorations, theme quality, and demand. Browse live listings to see what similar builds are actually trading for."}</p>
      ${priced ? `<p class="value-subtext" style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px;">Source: <a href="https://adoptmetradingvalues.com" target="_blank" rel="noopener" style="color:var(--accent);">adoptmetradingvalues.com</a> community values · Updated Sept 2026</p>` : ""}
    </div>
    <a class="btn btn-primary" href="../listings/index.html" style="display:inline-block;text-decoration:none;margin-top:4px;">Browse listings for this house →</a>
  </div>
</div>

<div class="wrap">
  ${house.description ? `
  <div class="content-section">
    <h2>About the ${escapeHtml(house.name)}</h2>
    <p>${escapeHtml(house.description)}</p>
    ${house.tradingNotes ? `<div class="trading-notes">${escapeHtml(house.tradingNotes)}</div>` : ""}
  </div>` : ""}

  <div class="content-section">
    <h2>How Adopt Me House Values Work</h2>
    <p>Unlike pets, which have fixed rarity-based values, Adopt Me house values are <strong>build-specific</strong> — meaning the same house type can trade for vastly different amounts depending on the quality and theme of the build inside. A bare, undecorated ${escapeHtml(house.name)} and a highly decorated, fully furnished version of the same house are valued completely differently in the trading community.</p>
    <p>When evaluating a house trade, the community looks at several key factors:</p>
    <ul class="factors-list">
      <li><strong>House rarity and availability</strong> — Limited and Robux houses are inherently more valuable than freely buyable ones, since supply is fixed.</li>
      <li><strong>Build quality and theme</strong> — A cohesive, well-executed theme (matching furniture, colors, and layout) commands a significant premium over a sparse or unthemed interior.</li>
      <li><strong>Current demand</strong> — Seasonal houses spike in value around relevant events; popular aesthetic themes (cozy, gothic, luxury) hold steady year-round.</li>
      <li><strong>Original vs. cloned build</strong> — Original builds (where the lister personally decorated the house) typically trade above copies of the same design.</li>
    </ul>
  </div>

  <div class="content-section">
    <h2>Understanding Trade Offers (RP Reference)</h2>
    <p>Most Adopt Me house trades happen through direct negotiation, with offers quoted in common in-game items rather than Robux. The standard community trading unit is the <strong>Ride Potion (RP)</strong>. When a seller lists a house at "50 Sharks" or "2 Frosts," they're expressing its value relative to these items. Here's a quick reference for the most commonly cited trade currencies:</p>
    <table class="rp-table">
      <thead><tr><th>Item</th><th>Approx. RP Value</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Ride Potion</td><td class="val-col">1 RP</td><td>Base unit — most values are expressed relative to this</td></tr>
        <tr><td>Shark (regular)</td><td class="val-col">~1.36 RP</td><td>Commonly used for smaller trades; "10 Sharks" ≈ 14 RP</td></tr>
        <tr><td>Frost Dragon</td><td class="val-col">~274 RP</td><td>A major benchmark — often used for mid-to-high value houses</td></tr>
        <tr><td>Neon Frost Dragon</td><td class="val-col">~1,096 RP</td><td>Four times a regular Frost; used for premium decorated builds</td></tr>
        <tr><td>Mega Neon Frost Dragon</td><td class="val-col">~4,384 RP</td><td>Top-tier trades; exceptionally decorated or rare houses</td></tr>
      </tbody>
    </table>
    <p>These values shift with community sentiment — for the most current pet and item values, the community references <a href="https://elvebredd.com" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">elvebredd.com</a> and <a href="https://adoptmetradingvalues.com" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">adoptmetradingvalues.com</a>.</p>
  </div>

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
        "@type": "ItemPage",
        "name": `${house.name} — Adopt Me House`,
        "description": metaDesc,
        "url": `https://adoptmehousetrading.com/houses/${house.id}.html`,
        "mainEntity": {
          "@type": "Product",
          "name": house.name,
          "description": house.description || `${house.name} — Adopt Me tradeable house`,
          "category": "Adopt Me House",
          ...(house.value !== null ? {
            "offers": {
              "@type": "Offer",
              "priceCurrency": "RP",
              "price": house.value,
              "availability": house.availability === "limited"
                ? "https://schema.org/LimitedAvailability"
                : "https://schema.org/InStock",
            }
          } : {}),
        }
      },
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
