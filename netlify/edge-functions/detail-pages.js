// Server-renders the content of the three detail pages:
//   /listings/listing.html?id=     a trade listing
//   /registry/entry.html?id=       a registered build
//   /commissions/builder.html?id=  a builder's profile
//
// Why: those pages are static shells that fill themselves in with
// JavaScript. Before that runs they hold almost nothing (0 to 39 words), and
// there are about 2,300 of them, linked from everywhere. AdSense turned the
// site down three times for "low value content", and crawlers that look at
// the raw HTML were seeing thousands of near-empty pages.
//
// This fills the empty <section id="content"> with the real content, and
// sets the title, description, canonical and social tags, before the page
// leaves Netlify. The page's own script still runs and replaces the section
// with the interactive version, so visitors see the same page as before,
// just with content from the first paint.
//
// Only public data is used: the same anonymous API calls a signed-out
// visitor's browser makes (no token is forwarded, so Roblox usernames are
// never included). The result is cached at the CDN for a few minutes.
//
// Missing, removed or test items get a 404 status and noindex, so search
// engines drop them instead of indexing an error page. Any failure here
// falls back to the untouched static page.

import { THEME_LABELS, CATEGORY_LABELS, buildCategory, cardPhoto } from "../../public/js/api.js";
import { formatValue, prettifyHouseId } from "../functions/_lib/discord.js";
import { isTestRow } from "../functions/_lib/testdata.js";

const SITE = "https://adoptmehousetrading.com";
const DATA_TIMEOUT_MS = 2500;
const MAX_PHOTOS = 6;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const para = (s) => esc(s).replace(/\r?\n/g, "<br>");
const dateText = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const absPhoto = (url) => (url && url.startsWith("/") ? `${SITE}${url}` : url);

// Mirrors buildLabel() in public/js/cards.js, which can't be imported here
// (it imports api.js with a cache-busting query string).
function buildTypeText(item) {
  if (item.listing_type === "looking_for") return "";
  return (
    {
      original: "Original build",
      cloned: "Cloned build",
      speedbuild: "Speedbuild",
      glitch_original: "Glitch build",
      glitch_cloned: "Glitch build (cloned)",
    }[item.build_type] || (item.is_cloned === true ? "Cloned build" : item.is_cloned === false ? "Original build" : "")
  );
}

function photosHtml(photos, alt) {
  return (photos || [])
    .filter((p) => typeof p === "string" && p)
    .slice(0, MAX_PHOTOS)
    .map((p, i) => `<img src="${esc(cardPhoto(p, 720))}" alt="${esc(`${alt}, photo ${i + 1}`)}" width="720" height="405" loading="${i ? "lazy" : "eager"}" decoding="async" style="width:100%;max-width:720px;height:auto;border-radius:14px;margin:0 0 10px;display:block;">`)
    .join("");
}

function pills(list) {
  return list.length ? `<div class="meta-row" style="margin-top:12px;">${list.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>` : "";
}

// ── Data ──────────────────────────────────────────────────────────────────
async function getJson(origin, path) {
  const res = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(DATA_TIMEOUT_MS) });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

let housesCache = null;
async function houses(origin) {
  if (housesCache) return housesCache;
  try {
    const res = await fetch(`${origin}/data/houses.json`, { signal: AbortSignal.timeout(DATA_TIMEOUT_MS) });
    const list = await res.json();
    housesCache = Object.fromEntries((Array.isArray(list) ? list : list.houses || []).map((h) => [h.id, h]));
  } catch {
    return {}; // try again on the next request
  }
  return housesCache;
}

// One line of real context about the house itself, e.g. "Beehive House is a
// Common house from Bee Pass 2026."
function houseFact(h) {
  if (!h?.name) return "";
  const rarity = h.rarity ? `${/^[aeiou]/i.test(h.rarity) ? "an" : "a"} ${h.rarity} house` : "a house";
  return `${h.name} is ${rarity} in Adopt Me${h.source ? ` from ${h.source}` : ""}.`;
}

// ── Renderers: each returns { title, description, image, canonical, body } or { notFound } ──
async function renderListing(origin, id) {
  const data = await getJson(origin, `/.netlify/functions/listings-get?id=${encodeURIComponent(id)}`);
  const l = data.listing;
  if (data.notFound || !l || isTestRow({ title: l.title, names: [l.profiles?.display_name] })) return { notFound: true };

  const houseInfo = await houses(origin);
  const cat = buildCategory(l.category);
  const isHouse = cat.key === "house";
  const houseName = isHouse ? houseInfo[l.house_id]?.name || prettifyHouseId(l.house_id) : "";
  const fact = isHouse ? houseFact(houseInfo[l.house_id]) : "";
  const what = isHouse ? houseName : cat.label;
  const lookingFor = l.listing_type === "looking_for";
  const value = formatValue(l.value_amount, l.value_unit);
  const by = l.profiles?.display_name || "an Adopt Me player";
  const offers = Array.isArray(data.offers) ? data.offers.length : 0;
  const themes = (l.themes || []).map((t) => THEME_LABELS[t] || t);
  const wants = (l.looking_for || []).map((c) => CATEGORY_LABELS[c] || c);
  const build = buildTypeText(l);
  const noun = isHouse ? "house" : cat.label.toLowerCase();
  const browse = isHouse ? "/listings/" : `/listings/?category=${cat.key}`;

  const summary = lookingFor
    ? `${by} is looking for ${isHouse ? `a ${houseName}` : `${noun}`} in Adopt Me${value ? `, offering about ${value}` : ""}.`
    : `${by} is trading ${isHouse ? `a ${houseName}` : `this ${noun}`} in Adopt Me${value ? `, asking ${value}` : ", open to offers"}.`;

  const body = `
    <nav class="breadcrumb"><a href="${browse}">Browse ${esc(cat.plural)}</a> &nbsp;/&nbsp; <span class="current">${esc(l.title)}</span></nav>
    <article>
      <h1 style="margin:6px 0 8px;">${esc(l.title)}</h1>
      <p class="hint">${lookingFor ? "Looking for" : "For trade"}: ${esc(what)} · Listed ${esc(dateText(l.created_at))} by ${esc(by)}${l.status === "traded" ? " · Traded" : ""}</p>
      <p style="font-weight:700;margin:12px 0;">${value ? `${lookingFor ? "Offering about" : "Asking"} ${esc(value)}` : "Open to offers"}</p>
      ${photosHtml(l.photos, `${l.title}, ${what} ${isHouse ? "build " : ""}in Adopt Me`)}
      <p>${esc(summary)}</p>
      ${l.description ? `<p style="white-space:normal;">${para(l.description)}</p>` : ""}
      ${pills([...(isHouse ? [`House: ${houseName}`] : [cat.label]), ...(build ? [build] : []), ...themes])}
      ${wants.length ? `<p style="margin-top:12px;">${lookingFor ? "Offering" : "Looking for"}: ${esc(wants.join(", "))}</p>` : ""}
      <p style="margin-top:12px;">${offers} offer${offers === 1 ? "" : "s"} so far.</p>
      ${fact ? `<p>${esc(fact)}</p>` : ""}
      ${isHouse && l.house_id ? `<p><a href="/houses/${esc(l.house_id)}.html">See ${esc(houseName)} values, listings and verified trades</a></p>` : ""}
    </article>`;

  return {
    title: `${l.title} (${what} ${lookingFor ? "wanted" : "for trade"}) | AdoptMeHouseTrading.com`,
    description: clip(`${summary} ${l.description || ""}`, 158),
    image: absPhoto(cardPhoto((l.photos || [])[0], 1200)),
    canonical: `${SITE}/listings/listing.html?id=${encodeURIComponent(l.id)}`,
    body,
  };
}

async function renderEntry(origin, id) {
  const data = await getJson(origin, `/.netlify/functions/registry-get?id=${encodeURIComponent(id)}`);
  const e = data.entry;
  if (data.notFound || !e || isTestRow({ title: e.title, names: [e.profiles?.display_name] })) return { notFound: true };

  const houseInfo = await houses(origin);
  const cat = buildCategory(e.category);
  const isHouse = cat.key === "house";
  const houseName = isHouse && e.house_id ? houseInfo[e.house_id]?.name || prettifyHouseId(e.house_id) : "";
  const fact = houseName ? houseFact(houseInfo[e.house_id]) : "";
  const by = e.profiles?.display_name || "a builder";
  const themes = (e.themes || []).map((t) => THEME_LABELS[t] || t);
  const build = buildTypeText(e);
  const hearts = Number(e.save_count) || 0;
  const status =
    e.status === "confirmed_original" ? "Confirmed original"
    : e.status === "confirmed_clone" ? "Confirmed clone"
    : e.status === "disputed" ? "Under dispute"
    : e.is_community_verified ? "Community verified" : "";
  const kind = isHouse ? (houseName ? `${houseName} build` : "house build") : cat.label.toLowerCase();
  const summary = `${e.title} is a ${kind} registered by ${by} in the Adopt Me Build Registry on ${dateText(e.created_at)}${hearts ? `, with ${hearts} heart${hearts === 1 ? "" : "s"}` : ""}.`;

  const body = `
    <nav class="breadcrumb"><a href="/registry/${isHouse ? "" : `?category=${cat.key}`}">Build Registry</a> &nbsp;/&nbsp; <span class="current">${esc(e.title)}</span></nav>
    <article>
      <h1 style="margin:6px 0 8px;">${esc(e.title)}</h1>
      <p class="hint">Registered ${esc(dateText(e.created_at))} by ${esc(by)}${status ? ` · ${esc(status)}` : ""}</p>
      ${photosHtml(e.photos, `${e.title}, ${kind} in Adopt Me`)}
      <p>${esc(summary)}</p>
      ${e.description ? `<p>${para(e.description)}</p>` : ""}
      ${pills([...(isHouse ? (houseName ? [`House: ${houseName}`] : []) : [cat.label]), ...(build ? [build] : []), ...themes])}
      ${fact ? `<p>${esc(fact)}</p>` : ""}
      ${houseName ? `<p><a href="/houses/${esc(e.house_id)}.html">See ${esc(houseName)} values, listings and verified trades</a></p>` : ""}
      <p style="margin-top:12px;">The registry records who built something first. If you think this build copies yours, you can open a dispute from this page.</p>
    </article>`;

  return {
    title: `${e.title} by ${by}, Adopt Me Build Registry | AdoptMeHouseTrading.com`,
    description: clip(`${summary} ${e.description || ""}`, 158),
    image: absPhoto(cardPhoto((e.photos || [])[0], 1200)),
    canonical: `${SITE}/registry/entry.html?id=${encodeURIComponent(e.id)}`,
    body,
  };
}

async function renderBuilder(origin, id) {
  const [data, portfolio] = await Promise.all([
    getJson(origin, `/.netlify/functions/builder-get?id=${encodeURIComponent(id)}`),
    getJson(origin, `/.netlify/functions/registry-list?profile_id=${encodeURIComponent(id)}`).catch(() => ({})),
  ]);
  const b = data.builder;
  if (data.notFound || !b || isTestRow({ names: [b.display_name] })) return { notFound: true };

  const open = b.commission_status === "open";
  const styles = (b.builder_themes || []).map((t) => THEME_LABELS[t] || t);
  const builds = (portfolio.entries || []).filter((e) => e.status !== "removed" && e.status !== "confirmed_clone");
  const count = Number(b.original_build_count) || builds.length;
  const hearts = Number(b.original_saves) || 0;
  const summary = `${b.display_name} builds in Adopt Me${styles.length ? `, specialising in ${styles.slice(0, 4).join(", ").toLowerCase()}` : ""}. ${count} registered build${count === 1 ? "" : "s"}${hearts ? ` and ${hearts} heart${hearts === 1 ? "" : "s"}` : ""}. ${open ? "Open for commissions." : "Commissions currently closed."}`;

  const body = `
    <nav class="breadcrumb"><a href="/commissions/">Find a Builder</a> &nbsp;/&nbsp; <span class="current">${esc(b.display_name)}</span></nav>
    <article>
      <h1 style="margin:6px 0 8px;">${esc(b.display_name)}</h1>
      <p class="hint">Adopt Me builder · ${open ? "Open for commissions" : "Commissions closed"}</p>
      <p>${esc(summary)}</p>
      ${b.builder_bio ? `<p>${para(b.builder_bio)}</p>` : ""}
      ${pills(styles)}
      ${builds.length ? `<h2 style="margin-top:22px;">Portfolio</h2>
      <ul>${builds.slice(0, 30).map((e) => `<li><a href="/registry/entry.html?id=${esc(e.id)}">${esc(e.title)}</a>${e.created_at ? `, registered ${esc(dateText(e.created_at))}` : ""}</li>`).join("")}</ul>` : ""}
    </article>`;

  return {
    title: `${b.display_name}, Adopt Me House Builder | AdoptMeHouseTrading.com`,
    description: clip(`${summary} ${b.builder_bio || ""}`, 158),
    image: absPhoto(cardPhoto(b.cover_photo, 1200)),
    canonical: `${SITE}/commissions/builder.html?id=${encodeURIComponent(b.id)}`,
    body,
  };
}

const RENDERERS = { listing: renderListing, entry: renderEntry, builder: renderBuilder };
function kindOf(pathname) {
  if (pathname.startsWith("/listings/listing")) return "listing";
  if (pathname.startsWith("/registry/entry")) return "entry";
  if (pathname.startsWith("/commissions/builder")) return "builder";
  return null;
}

// ── HTML injection ─────────────────────────────────────────────────────────
function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `${tag}\n</head>`);
}

export function inject(html, page) {
  let out = html;
  if (page.notFound) {
    out = out.replace("</head>", `<meta name="robots" content="noindex">\n</head>`);
    return out;
  }
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`);
  out = setMeta(out, "name", "description", page.description);
  out = setMeta(out, "property", "og:title", page.title);
  out = setMeta(out, "property", "og:description", page.description);
  out = setMeta(out, "property", "og:url", page.canonical);
  out = setMeta(out, "name", "twitter:title", page.title);
  out = setMeta(out, "name", "twitter:description", page.description);
  if (page.image) {
    out = setMeta(out, "property", "og:image", page.image);
    out = setMeta(out, "name", "twitter:image", page.image);
  }
  out = out.replace(/<link rel="canonical"[^>]*>\n?/, "");
  out = out.replace("</head>", `<link rel="canonical" href="${esc(page.canonical)}">\n</head>`);
  out = out.replace(
    /(<section class="wrap" id="content"[^>]*>)(<\/section>)/,
    (_, open, close) => `${open}${page.body}${close}`
  );
  return out;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const kind = kindOf(url.pathname);
  const response = await context.next();
  if (!id || !kind || !response.ok || !(response.headers.get("content-type") || "").includes("text/html")) {
    return response;
  }

  const html = await response.text();
  let page;
  try {
    page = await RENDERERS[kind](url.origin, id);
  } catch (err) {
    console.error(`[detail-pages] ${kind} ${id}:`, err.message);
    return new Response(html, { status: response.status, headers: response.headers });
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  // Browsers always revalidate; the CDN keeps a copy per id for a few
  // minutes and serves it stale while refreshing, so a busy listing costs a
  // handful of API calls an hour, not one per view.
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("netlify-cdn-cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
  headers.set("netlify-vary", "query=id");

  return new Response(inject(html, page), { status: page.notFound ? 404 : 200, headers });
};

export const config = {
  path: [
    "/listings/listing.html",
    "/listings/listing",
    "/registry/entry.html",
    "/registry/entry",
    "/commissions/builder.html",
    "/commissions/builder",
  ],
  cache: "manual",
};
