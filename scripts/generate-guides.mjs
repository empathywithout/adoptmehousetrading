// Writes four reference guides into public/guides/ from the verified house data
// (data/houses.json, data/house-facts.json, data/house-updates.json), so the
// lists, prices and counts in them are rebuilt every time and cannot drift from
// the house pages.
//
//   houses-by-price.html          every house with a Bucks price, cheapest first
//   trade-only-houses.html        which houses left the game, and when
//   expandable-houses.html        the four expandable houses and their expansions
//   house-release-timeline.html   every house by release date
//
// They reuse the page shell of the hand-written trading guide
// (guides/how-to-trade-houses.html), so the navigation, footer and styles match.
// The hand-written guides are never touched.

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const SITE = "https://adoptmehousetrading.com";
const TEMPLATE = path.join(ROOT, "public", "guides", "how-to-trade-houses.html");
const CHECKED = "October 30, 2026";
const CHECKED_ISO = "2026-10-30";

if (!existsSync(TEMPLATE)) {
  console.warn("[guides] template guide not found, skipping");
  process.exit(0);
}

const houses = JSON.parse(readFileSync(path.join(ROOT, "data", "houses.json"), "utf-8"));
const byId = Object.fromEntries(houses.map((h) => [h.id, h]));
const template = readFileSync(TEMPLATE, "utf-8");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (id) => (byId[id] ? `<a href="../houses/${id}.html">${esc(byId[id].name)}</a>` : "");
const byName = (a, b) => a.name.localeCompare(b.name);
const links = (ids) => ids.map((i) => byId[i]).filter(Boolean).sort(byName).map((h) => link(h.id)).join(", ");
const bucks = (n) => `${n.toLocaleString("en-US")} Bucks`;
const ms = (h) => { const t = Date.parse(h.released || ""); return Number.isNaN(t) ? 0 : t; };

function table(head, rows) {
  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:12px 0;"><table class="rp-table" style="margin:0;min-width:520px;">
        <thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n          ")}
        </tbody>
      </table></div>`;
}

// ---- shell ----------------------------------------------------------------

function buildGuide({ file, title, description, h1, pill, sections, ctaTitle, ctaText, sourcesNote }) {
  const url = `${SITE}/guides/${file}`;
  const bodyHtml = sections.map((s) => `<h2 id="${s.id}">${esc(s.title)}</h2>\n\n      ${s.html}`).join("\n\n      ");
  const words = (bodyHtml.replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;
  const minutes = Math.max(2, Math.round(words / 200));
  const toc = `<div class="guide-toc">
      <h4>In this guide</h4>
      <ol>
        ${sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join("\n        ")}
      </ol>
    </div>`;
  const ld = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, datePublished: "2026-10-30", dateModified: CHECKED_ISO,
      author: { "@type": "Organization", name: "AdoptMeHouseTrading.com" },
      publisher: { "@type": "Organization", name: "AdoptMeHouseTrading.com", url: SITE },
      mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/guides/index.html` },
      { "@type": "ListItem", position: 3, name: h1, item: url } ] },
  ].map((o) => `<script type="application/ld+json">${JSON.stringify(o, null, 2)}</script>`).join("\n");

  // The template guide gets share tags from add-social-meta.mjs. Drop them, so
  // each generated guide ends up with its own and none inherited from the template.
  let h = template.replace(/<meta (?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, "");
  const swap = (re, to, label) => { if (!re.test(h)) throw new Error(`guide template changed: could not find ${label}`); h = h.replace(re, () => to); };

  swap(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} | AdoptMeHouseTrading.com</title>`, "title");
  swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`, "description");
  swap(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, "canonical");
  h = h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, "");
  swap(/<\/style>/, `</style>\n${ld}`, "style end");
  swap(/<span class="current">[\s\S]*?<\/span>/, `<span class="current">${esc(h1)}</span>`, "breadcrumb");
  swap(/<span class="pill"[^>]*>[\s\S]*?<\/span>/, `<span class="pill" style="margin-bottom:12px;display:inline-block;">${esc(pill)}</span>`, "pill");
  { const re = /(<h1 style="[^"]*">)[\s\S]*?(<\/h1>)/; if (!re.test(h)) throw new Error("guide template changed: could not find h1"); h = h.replace(re, (_, open, close) => `${open}${esc(h1)}${close}`); }
  swap(/<span>Updated October 2026<\/span>/, `<span>Updated October 2026</span>`, "date");
  swap(/<span>\d+ min read<\/span>/, `<span>${minutes} min read</span>`, "read time");
  swap(/<div class="guide-toc">[\s\S]*?<\/div><!-- \/\.guide-body -->/, `${toc}\n\n    <div class="guide-body">\n\n      ${bodyHtml}\n\n      <p class="hint">${sourcesNote} Checked ${CHECKED}. The game can change these, so check in game before you plan a trade around them.</p>\n\n    </div><!-- /.guide-body -->`, "body");
  swap(/<div class="guide-cta">[\s\S]*?<\/div>(?=\s*<div style="margin-top:48px)/, `<div class="guide-cta">
      <h3>${esc(ctaTitle)}</h3>
      <p>${esc(ctaText)}</p>
      <a href="../houses/index.html" class="btn btn-primary" style="margin-right:8px;">See All Houses</a>
      <a href="../listings/index.html" class="btn" style="border:1.5px solid var(--line);">Browse Listings</a>
    </div>`, "cta");
  writeFileSync(path.join(ROOT, "public", "guides", file), h);
  return { file, words, minutes };
}

// ---- 1. houses by price ----------------------------------------------------

function pricesGuide() {
  const priced = houses.filter((h) => h.bucksPrice !== undefined && h.bucksPrice !== null && ["obtainable", "unconfirmed"].includes(h.availability))
    .sort((a, b) => a.bucksPrice - b.bucksPrice || a.name.localeCompare(b.name));
  const robux = houses.filter((h) => h.availability === "robux").sort(byName);
  const tradeOnly = houses.filter((h) => h.availability === "limited").sort(byName);
  const paid = priced.filter((h) => h.bucksPrice > 0 && h.id !== "tiny-home");
  const cheapest = paid[0], dearest = paid[paid.length - 1];
  const rows = priced.map((h) => [link(h.id), h.id === "tiny-home" ? "Free (extra copies 240 Bucks)" : bucks(h.bucksPrice),
    h.floors ? String(h.floors) : "not confirmed", esc(h.released || "not found"), h.availability === "unconfirmed" ? "Event house, check in game" : esc(h.originLabel || h.source || "Build House menu")]);
  return buildGuide({
    file: "houses-by-price.html",
    title: "Adopt Me Houses by Price: Every Bucks and Robux House",
    description: `Every Adopt Me house with a Bucks price, cheapest first, plus which houses cost Robux and which are trade-only. Prices checked ${CHECKED}.`,
    h1: "Adopt Me Houses by Price", pill: "Reference",
    sections: [
      { id: "bucks", title: "Houses bought with Bucks", html: `<p>These are the houses with a Bucks price, from cheapest to most expensive. The ${link("tiny-home")} is the free house every new player starts with, and extra copies cost ${bucks(240)}. After that, the cheapest is the ${link(cheapest.id)} at ${bucks(cheapest.bucksPrice)}, and the most expensive is the ${link(dearest.id)} at ${bucks(dearest.bucksPrice)}.</p>
      <p>Houses marked "Event house" came out in an event or update. Nobody has confirmed whether they are still sold, so check in game before you count on buying one.</p>
      ${table(["House", "Price", "Floors", "Released", "Where from"], rows)}` },
      { id: "robux", title: "Houses bought with Robux", html: `<p>${robux.length} houses are still listed as Robux purchases: ${links(robux.map((h) => h.id))}. Sources disagree on the current Robux prices for several of them, so this guide does not list a price. Check the price in the game's shop.</p>
      <p>A house bought with Robux cannot be sold for Bucks, even if you got it in a trade.</p>` },
      { id: "trade-only", title: "Houses you can only get by trading", html: `<p>${tradeOnly.length} houses are no longer sold at all: ${links(tradeOnly.map((h) => h.id))}. The only way to get one is to trade with another player who owns it. The <a href="trade-only-houses.html">trade-only houses guide</a> explains when each one left.</p>` },
      { id: "reading", title: "A few things to know about the prices", html: `<ul>
        <li>Prices are what Adopt Me charged when we last checked. Updates can change them.</li>
        <li>A price covers the house, not the furniture. Some houses come with furniture and some come empty. For example, the ${link("monster-mansion")} has ten matching furniture pieces that are sold separately.</li>
        <li>What a house costs in the shop is not what it trades for between players. Traders agree on their own prices, and a house with a great build can ask for more. See <a href="how-to-trade-houses.html#price">how the price gets decided</a>.</li>
      </ul>` },
    ],
    ctaTitle: "Looking at a house to trade for?", ctaText: "Open any house page to see how to get it, what it looks like and what players are asking for it right now.",
    sourcesNote: "Prices come from Adopt Me's update notes and the Adopt Me Wiki.",
  });
}

// ---- 2. trade-only ----------------------------------------------------------

function tradeOnlyGuide() {
  const june = [["mansion", "June 8"], ["cozy-cabin", "June 9"], ["biodome-home", "June 10"], ["ruler-s-castle", "June 11"], ["pirate-ship-house", "June 12"], ["eco-natural-earth-house", "June 13"], ["mermaid-mansion", "June 14"]];
  const april = ["modern-mansion", "celebrity-mansion", "soccer-stadium", "hospital-home", "schoolhouse-home", "expandable-dino-house"];
  return buildGuide({
    file: "trade-only-houses.html",
    title: "Trade-Only Houses in Adopt Me: Which Houses Left the Game",
    description: `Which Adopt Me houses can no longer be bought and only come from trading, and when each one left the game. Checked ${CHECKED}.`,
    h1: "Trade-Only Houses in Adopt Me", pill: "Reference",
    sections: [
      { id: "meaning", title: "What trade-only means", html: `<p>A trade-only house is one the game no longer sells. You cannot buy it in the shop or with Robux anymore. The only way to own one is to trade with a player who already has it.</p>
      <p>Adopt Me added house trading on May 31, 2024, and it follows its own rules. The <a href="how-to-trade-houses.html">how to trade houses guide</a> covers them: a trade license, at least two houses, and one house per trade.</p>` },
      { id: "june-2024", title: "The Last Chance House Sale, June 2024", html: `<p>Seven houses went on sale at a discount and were then removed one a day:</p>
      <ul>
        ${june.map(([id, d]) => `<li>${link(id)}, removed on ${d}, 2024</li>`).join("\n        ")}
      </ul>` },
      { id: "april-2026", title: "The final-chance Robux sale, April 2026", html: `<p>On April 24, 2026, Adopt Me ran a final-chance sale of Robux items before taking them away. Five house items were in it: the Modern Mansion, the Celebrity Mansion, the Soccer Stadium, the School and Hospital bundle (which covers two houses) and the Fossil Isle Returns Bundle (which includes the Expandable Dino House).</p>
      <p>That makes six houses that are no longer sold: ${links(april)}. Adopt Me's own post does not give a removal date, so this guide does not either.</p>` },
      { id: "event", title: "A house that ended with an event", html: `<p>The ${link("christmas-pudding-house")} was a free reward for finishing 15 pet needs in the Winter Event. The event started on December 5, 2025, and the house left the game on January 5, 2026. It could not be traded at first, and became tradable on January 13, 2026.</p>` },
      { id: "questions", title: "Common questions", html: `<h3>Can I still get one?</h3>
      <p>Yes, by trading with a player who owns it. Look at the live listings on this site, or <a href="../listings/index.html">list that you are looking for one</a>.</p>
      <h3>Will a retired house come back?</h3>
      <p>We have not seen any report of one of these houses returning to sale, but nobody outside Adopt Me can say what comes next.</p>
      <h3>Can a Robux house be traded?</h3>
      <p>Yes. A house that was bought with Robux can be traded to another player. It just cannot be sold for Bucks.</p>` },
    ],
    ctaTitle: "Looking for a trade-only house?", ctaText: "See which of these houses players are listing right now, or tell people which one you want.",
    sourcesNote: "Dates come from Adopt Me's own update posts and patch notes, and from the Adopt Me Wiki.",
  });
}

// ---- 3. expandable ----------------------------------------------------------

function expandableGuide() {
  const spec = [
    { id: "expandable-friendly-home", how: "was bought with Bucks", exp: [["Second floor (large upstairs rooms)", 500], ["Basement", 125], ["Rear extension", 250], ["Side extension", 325]] },
    { id: "expandable-hillside-mansion", how: "was bought with Bucks", exp: [["Second floor (upstairs with a balcony)", 800], ["Side extension with an upstairs room", 800], ["Main floor alternative exit", 800], ["Basement pool", 500]] },
    { id: "expandable-luxury-mansion", how: "was bought with Robux", exp: [["Main floor pool and a possible cinema room", 900], ["Second floor, east room", 1000], ["Second floor, west room", 950], ["Basement", 600]] },
    { id: "expandable-dino-house", how: "came with the Fossil Isle Returns Bundle, which is no longer sold", exp: [["Side extension", 600], ["Pool extension", 700], ["Second floor", 800], ["Sunken basement", 500]] },
  ];
  const total = (s) => s.exp.reduce((n, [, c]) => n + c, 0);
  const sections = [
    { id: "what", title: "What expandable means", html: `<p>Most Adopt Me houses are a fixed size. An expandable house starts small and lets you add extra rooms and floors, which you buy separately with Bucks. Adopt Me added the first three on August 31, 2023, with a furniture pack for each, and said that future houses may come with the feature. It was not added to the older houses.</p>
      <p>Each expansion shows from the outside, except the basement. Four houses in the game are expandable. Their prices in Bucks are below.</p>` },
    ...spec.map((s) => ({ id: s.id, title: byId[s.id].name, html: `<p>The ${link(s.id)} ${s.how.startsWith("was") ? s.how : s.how}. It starts with ${byId[s.id].floors || 1} floor. The four expansions cost ${bucks(total(s))} in all.</p>
      ${table(["Expansion", "Price"], [...s.exp.map(([n, c]) => [esc(n), bucks(c)]), ["<strong>All four</strong>", `<strong>${bucks(total(s))}</strong>`]])}` })),
    { id: "tips", title: "Things to keep in mind", html: `<ul>
        <li>Expansion prices are in Bucks, even for the houses that were bought with Robux.</li>
        <li>The house price and the expansions are separate. Add them up before you decide.</li>
        <li>If you trade an expandable house, look at which expansions it has. They show from the outside, so ask for photos of the inside and outside.</li>
      </ul>` },
  ];
  return buildGuide({
    file: "expandable-houses.html",
    title: "Expandable Houses in Adopt Me: Prices and Expansions",
    description: `The four expandable houses in Adopt Me, what each expansion costs in Bucks, and what the full house adds up to. Checked ${CHECKED}.`,
    h1: "Expandable Houses in Adopt Me", pill: "Reference", sections,
    ctaTitle: "Thinking about an expandable house?", ctaText: "Look at the house pages for how to get each one, and at the live listings for builds that already have their expansions.",
    sourcesNote: "Expansion prices come from Adopt Me's Expandable Houses update notes (August 31, 2023) and the Adopt Me Wiki.",
  });
}

// ---- 4. timeline ------------------------------------------------------------

function timelineGuide() {
  const dated = houses.filter(ms).sort((a, b) => ms(b) - ms(a));
  const undated = houses.filter((h) => !ms(h)).sort(byName);
  const years = [...new Set(dated.map((h) => new Date(ms(h)).getFullYear()))];
  const sections = years.map((y) => {
    const list = dated.filter((h) => new Date(ms(h)).getFullYear() === y);
    return { id: `y${y}`, title: String(y), html: `<ul>
        ${list.map((h) => `<li>${link(h.id)}, ${esc(h.released)}${h.bucksPrice ? `, ${bucks(h.bucksPrice)}` : ""}${h.availability === "limited" ? " (trade only now)" : ""}</li>`).join("\n        ")}
      </ul>` };
  });
  sections.push({ id: "undated", title: "Original houses and houses with no date found", html: `<p>These houses are among the first in the game, or we could not find a release date for them: ${links(undated.map((h) => h.id))}.</p>` });
  return buildGuide({
    file: "house-release-timeline.html",
    title: "Every Adopt Me House by Release Date",
    description: `All Adopt Me houses listed from newest to oldest by release date, with prices. Checked ${CHECKED}.`,
    h1: "Every Adopt Me House by Release Date", pill: "Reference", sections,
    ctaTitle: "Want to see them all together?", ctaText: "The houses page shows every house with its price, floors and trade status.",
    sourcesNote: "Release dates come from Adopt Me's update posts and the Adopt Me Wiki.",
  });
}

const out = [pricesGuide(), tradeOnlyGuide(), expandableGuide(), timelineGuide()];
console.log("Generated guides: " + out.map((g) => `${g.file} (~${g.words} words)`).join(", "));
