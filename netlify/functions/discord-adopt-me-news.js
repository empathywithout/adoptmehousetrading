// Scheduled every 15 minutes (see [functions."discord-adopt-me-news"] in
// netlify.toml). Takes no input.
//
// Feeds the community Discord's adopt-me-news channel with what the official
// Adopt Me server's #update-feed carries. That channel is followed, but a
// follow only forwards messages that get "published", and the bot that posts
// there (Barbara) never publishes, so nothing came through. Reading Barbara's
// history from August to November 2026 showed she posts exactly two things,
// both reproducible from public sources:
//
//   1. Event reminders on a fixed weekly schedule (EVENTS below, Eastern time).
//   2. "PlayAdoptMe just posted a video", from their YouTube channel, which
//      has a public feed.
//
// Event reminders: each run posts any event that started in the last
// EVENT_WINDOW_MINUTES. A Redis counter per event per day makes sure a
// reminder goes out once even if runs overlap. If Redis is down the window
// alone still keeps it to one post in practice.
//
// Videos: the IDs already announced are kept in Redis. The very first run
// (or after the key is lost) records what's in the feed without posting, so
// the channel doesn't get a backlog of old videos. If Redis is unavailable
// videos are skipped entirely rather than risk reposting the whole feed.
// Videos older than VIDEO_MAX_AGE_HOURS are never posted.
//
// No pings: postWebhook switches mentions off.
//
// Needs DISCORD_NEWS_WEBHOOK set to the channel's webhook URL. Without it
// this logs and does nothing.
//
// If Adopt Me changes its schedule, update EVENTS. That's the one place.

import { isDiscordWebhookUrl, postWebhook } from "./_lib/discord.js";
import { kvGet, kvSet, kvBump } from "./_lib/cache.js";

const WEBHOOK_ENV = "DISCORD_NEWS_WEBHOOK";
const TIME_ZONE = "America/New_York";
const EVENT_WINDOW_MINUTES = 20;
const YOUTUBE_CHANNEL_ID = "UCVdPM7Dgxm3cHXM2ro__bUg"; // PlayAdoptMe
const YOUTUBE_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
const VIDEO_MAX_AGE_HOURS = 48;
const SEEN_KEY = "news:yt:seen";
const SEEN_TTL_SECONDS = 90 * 24 * 3600;
const SEEN_KEEP = 60;
const USERNAME = "Adopt Me News";

// day: 0 = Sunday ... 6 = Saturday. Times are Eastern, as Barbara posts them.
export const EVENTS = [
  { id: "2d-tuesday-1", day: 2, hour: 3, minute: 0, name: "2D Tuesday", detail: "1st session" },
  { id: "2d-tuesday-2", day: 2, hour: 11, minute: 0, name: "2D Tuesday", detail: "2nd session" },
  { id: "2d-tuesday-3", day: 2, hour: 19, minute: 0, name: "2D Tuesday", detail: "3rd session" },
  { id: "update-day", day: 5, hour: 11, minute: 0, name: "Update Day", detail: null },
  { id: "admin-abuse", day: 6, hour: 12, minute: 0, name: "Admin Abuse", detail: null },
];

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The wall-clock date and time in Eastern for an instant.
export function easternParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    day: WEEKDAYS[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Events that started within the window before `now`.
export function dueEvents(now, events = EVENTS, windowMinutes = EVENT_WINDOW_MINUTES) {
  const t = easternParts(now);
  const minutesNow = t.hour * 60 + t.minute;
  return events
    .filter((e) => {
      if (e.day !== t.day) return false;
      const since = minutesNow - (e.hour * 60 + e.minute);
      return since >= 0 && since < windowMinutes;
    })
    .map((e) => ({ ...e, date: t.date }));
}

export function eventMessage(e) {
  const what = e.detail ? `**${e.name}** (${e.detail})` : `**${e.name}**`;
  return `${what} is starting now in Adopt Me. Get online!`;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Pulls { id, title, url, published } out of a YouTube channel feed, newest
// first as YouTube orders them. A plain parser is enough for this fixed shape.
export function parseYouTubeFeed(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const url = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1];
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1];
    if (id && url) out.push({ id, title: decodeXml(title || "").trim(), url: decodeXml(url), published });
  }
  return out;
}

export function videoMessage(v) {
  return `PlayAdoptMe just posted a new video: **${v.title || "New video"}**\n${v.url}`;
}

async function postEvents(webhook, now, deps) {
  let posted = 0;
  for (const e of dueEvents(now)) {
    const n = await deps.kvBump(`news:event:${e.id}:${e.date}`, 3 * 24 * 3600);
    if (n !== null && n > 1) continue; // already announced today
    const ok = await deps.post(webhook, { username: USERNAME, content: eventMessage(e) });
    if (ok) posted++;
  }
  return posted;
}

async function postVideos(webhook, now, deps) {
  let xml;
  try {
    const res = await deps.fetch(YOUTUBE_FEED, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    console.warn("[discord-adopt-me-news] couldn't read the YouTube feed:", err.message);
    return { posted: 0, note: "feed unavailable" };
  }
  const videos = parseYouTubeFeed(xml);
  if (!videos.length) return { posted: 0, note: "feed empty" };

  const seen = await deps.kvGet(SEEN_KEY);
  if (!Array.isArray(seen)) {
    // First run, or the key expired: remember what's there, post nothing.
    const stored = await deps.kvSet(SEEN_KEY, videos.map((v) => v.id).slice(0, SEEN_KEEP), SEEN_TTL_SECONDS);
    return { posted: 0, note: stored ? "seeded" : "redis unavailable, skipped" };
  }

  const seenSet = new Set(seen);
  const cutoff = now.getTime() - VIDEO_MAX_AGE_HOURS * 3600 * 1000;
  // Oldest first, so the channel reads in order.
  const fresh = videos
    .filter((v) => !seenSet.has(v.id))
    .filter((v) => !v.published || Date.parse(v.published) >= cutoff)
    .reverse();

  let posted = 0;
  const done = [];
  for (const v of fresh) {
    const ok = await deps.post(webhook, { username: USERNAME, content: videoMessage(v) });
    if (!ok) break; // try the rest next run
    posted++;
    done.push(v.id);
  }
  // Too-old unseen videos are marked seen too, so they're never reconsidered.
  const tooOld = videos.filter((v) => !seenSet.has(v.id) && !fresh.includes(v)).map((v) => v.id);
  if (done.length || tooOld.length) {
    const next = [...done.reverse(), ...tooOld, ...seen].slice(0, SEEN_KEEP);
    await deps.kvSet(SEEN_KEY, next, SEEN_TTL_SECONDS);
  }
  return { posted };
}

export async function run({ now = new Date(), webhook = process.env[WEBHOOK_ENV], deps = {} } = {}) {
  const d = {
    fetch: deps.fetch || fetch,
    post: deps.post || ((url, payload) => postWebhook(url, payload)),
    kvGet: deps.kvGet || kvGet,
    kvSet: deps.kvSet || kvSet,
    kvBump: deps.kvBump || kvBump,
  };
  if (!webhook) {
    console.log(`[discord-adopt-me-news] ${WEBHOOK_ENV} is not set, skipping.`);
    return { skipped: "no webhook configured" };
  }
  if (!isDiscordWebhookUrl(webhook)) {
    console.error(`[discord-adopt-me-news] ${WEBHOOK_ENV} does not look like a Discord webhook URL, refusing to post to it.`);
    return { skipped: "unexpected webhook URL" };
  }
  const events = await postEvents(webhook, now, d);
  const videos = await postVideos(webhook, now, d);
  return { events, videos };
}

export const handler = async () => {
  const result = await run();
  console.log("[discord-adopt-me-news]", JSON.stringify(result));
  return { statusCode: 200, body: JSON.stringify(result) };
};
