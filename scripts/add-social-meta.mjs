// Adds the Open Graph and Twitter tags that link previews use (Discord, Reddit,
// X and others) to every public page that does not already have them.
//
// Why a script and not by hand: the site has two kinds of pages. The generated
// ones (home, houses) already carry og:title, og:description, og:type and
// og:url but no image, and the hand-written ones (guides, about, commissions
// and so on) carry nothing, so a link pasted into Discord showed a bare URL.
// This reads each page's own <title>, description and canonical URL and fills
// in whatever is missing. It never overwrites a tag that is already there, and
// it is safe to run twice.
//
// Skipped: the admin area and any page marked noindex.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");
const SITE = "https://adoptmehousetrading.com";
const DEFAULT_IMAGE = `${SITE}/images/brand/og-default.png`;
const houses = JSON.parse(readFileSync(path.join(ROOT, "data", "houses.json"), "utf-8"));
const houseImage = Object.fromEntries(houses.map((h) => [h.id, h.image]));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "admin" ? [] : walk(full);
    return name.endsWith(".html") ? [full] : [];
  });
}

const attr = (html, re) => (html.match(re) || [])[1];
let touched = 0;

for (const file of walk(PUBLIC)) {
  let html = readFileSync(file, "utf-8");
  if (/<meta[^>]+name="robots"[^>]+noindex/i.test(html)) continue;
  const rel = path.relative(PUBLIC, file).split(path.sep).join("/");

  const rawTitle = attr(html, /<title>([\s\S]*?)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]*)"/);
  if (!rawTitle) continue;
  let title = rawTitle.trim().replace(/\s*[|—-]\s*AdoptMeHouseTrading\.com\s*$/i, "");
  // "About" or "Contact" alone makes a poor preview title, so keep the site name on short ones.
  if (title.length < 16) title = `${title} | AdoptMeHouseTrading.com`;
  const url = attr(html, /<link rel="canonical" href="([^"]*)"/) || `${SITE}/${rel === "index.html" ? "" : rel}`;

  const houseMatch = rel.match(/^houses\/([^/]+)\.html$/);
  const art = houseMatch && houseMatch[1] !== "index" && houseImage[houseMatch[1]];
  const image = art ? `${SITE}${encodeURI(art)}` : DEFAULT_IMAGE;
  const type = /^guides\/(?!index|submit|entry)/.test(rel) ? "article" : "website";

  const wanted = [
    ['property="og:site_name"', `<meta property="og:site_name" content="AdoptMeHouseTrading.com">`],
    ['property="og:title"', `<meta property="og:title" content="${title}">`],
    ...(description ? [['property="og:description"', `<meta property="og:description" content="${description}">`]] : []),
    ['property="og:type"', `<meta property="og:type" content="${type}">`],
    ['property="og:url"', `<meta property="og:url" content="${url}">`],
    ['property="og:image"', `<meta property="og:image" content="${image}">`],
    ['name="twitter:card"', `<meta name="twitter:card" content="${art ? "summary" : "summary_large_image"}">`],
    ['name="twitter:title"', `<meta name="twitter:title" content="${title}">`],
    ...(description ? [['name="twitter:description"', `<meta name="twitter:description" content="${description}">`]] : []),
    ['name="twitter:image"', `<meta name="twitter:image" content="${image}">`],
  ].filter(([probe]) => !html.includes(probe)).map(([, tag]) => tag);

  if (!wanted.length || !html.includes("</head>")) continue;
  html = html.replace("</head>", `${wanted.join("\n")}\n</head>`);
  writeFileSync(file, html);
  touched++;
}

console.log(`[social-meta] added link-preview tags to ${touched} page(s)`);
