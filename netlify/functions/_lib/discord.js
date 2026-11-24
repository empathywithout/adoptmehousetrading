// Posting to the community Discord through channel webhooks.
//
// A webhook URL is a secret: anyone holding it can post into the channel. It
// lives in a Netlify environment variable, never in the repo, and is checked
// against Discord's own URL shape before anything is sent to it.
//
// Kept separate from the job that uses it so the message-building parts are
// plain functions that can be tested without a database or a network.

const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export function isDiscordWebhookUrl(url) {
  return WEBHOOK_RE.test(String(url || ""));
}

// Discord's limits for one webhook message.
export const MAX_EMBEDS_PER_MESSAGE = 10;
const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FOOTER_MAX = 2048;

// Shown on cards. The stored unit stays the raw "shark" / "frost" / "rp"
// string everywhere else on the site; this is display only.
const UNIT_LABELS = { shark: "Shark", frost: "Frost", rp: "Ride Pot" };

const SITE_GREEN = 0x2f9e5b;

function clip(str, max) {
  const s = String(str || "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Listing titles and display names are typed by users. Discord renders
// markdown in embed descriptions, so escape it: a title should never be able
// to bold, link or hide text in the card.
export function escapeMarkdown(str) {
  return String(str || "").replace(/([\\*_~`|>\[\]()#-])/g, "\\$1");
}

// "cozy-cottage" -> "Cozy Cottage". Only used if the house list can't be
// loaded, so a card still says something readable.
export function prettifyHouseId(id) {
  return String(id || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatValue(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || !UNIT_LABELS[unit]) return null;
  return `${n % 1 === 0 ? n : n.toFixed(2).replace(/0+$/, "")} ${UNIT_LABELS[unit]}`;
}

// One listing -> one Discord embed. Never includes the Roblox username: that
// is private on this site and only revealed to an accepted trade partner.
export function buildListingEmbed(listing, { siteUrl, houseNames = {} }) {
  const houseName = houseNames[listing.house_id] || prettifyHouseId(listing.house_id);
  const isLookingFor = listing.listing_type === "looking_for";
  const value = formatValue(listing.value_amount, listing.value_unit);

  const lines = [
    `**${isLookingFor ? "Looking for" : "For trade"}:** ${escapeMarkdown(houseName)}`,
  ];
  if (value) lines.push(`**${isLookingFor ? "Offering about" : "Asking"}:** ${value}`);

  const embed = {
    // Escaped too: Discord renders bold, italics and the like in embed titles.
    title: clip(escapeMarkdown(listing.title || houseName), TITLE_MAX),
    url: `${siteUrl}/listings/listing.html?id=${encodeURIComponent(listing.id)}`,
    description: clip(lines.join("\n"), DESCRIPTION_MAX),
    color: SITE_GREEN,
    timestamp: new Date(listing.created_at).toISOString(),
  };

  const displayName = listing.profiles?.display_name;
  if (displayName) embed.footer = { text: clip(`Listed by ${displayName}`, FOOTER_MAX) };

  const photo = Array.isArray(listing.photos) ? listing.photos.find((p) => /^https:\/\//.test(p)) : null;
  if (photo) embed.image = { url: photo };

  return embed;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one webhook message. Returns true only when Discord accepted it.
// allowed_mentions is empty so nothing in a user's text can ping @everyone,
// a role or a person. One retry on a rate limit, using Discord's own wait.
export async function sendWebhook(url, embeds, { fetchImpl = fetch } = {}) {
  return postWebhook(url, { username: "AdoptMeHouseTrading", embeds }, { fetchImpl });
}

// Any webhook message: { content?, embeds?, username? }. Mentions are always
// switched off, so nothing posted this way can ping @everyone or a role, even
// if the text happens to contain one.
export async function postWebhook(url, payload, { fetchImpl = fetch } = {}) {
  const body = JSON.stringify({ ...payload, allowed_mentions: { parse: [] } });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(`${url}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) return true;
    if (res.status === 429 && attempt === 0) {
      let wait = 2000;
      try {
        const j = await res.json();
        if (Number(j.retry_after) > 0) wait = Math.min(10000, Number(j.retry_after) * 1000);
      } catch {}
      await sleep(wait);
      continue;
    }
    const text = await res.text().catch(() => "");
    console.error(`[discord] webhook rejected the message: ${res.status} ${text.slice(0, 300)}`);
    return false;
  }
  return false;
}
