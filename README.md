# AdoptMeHouseTrading.com

A static, pre-rendered site for browsing Adopt Me house values and (soon) checking trades — built the same way as TCG Watchtower: filenames → structured JSON → generated HTML, no server-side rendering needed at runtime.

# AdoptMeHouseTrading.com

A static, pre-rendered site for browsing Adopt Me house values — plus a live player-to-player house trading marketplace (profiles, listings, offers) backed by Supabase.

## How the static side works

1. **`public/images/{category}/`** — item images for all 8 categories (houses, pets, vehicles, toys, pet wear, stickers, strollers, food), filenames intact (`{Name}-{Rarity}-from-{Source}.png`).
2. **`scripts/parse-catalog.mjs`** — parses every category's filenames into `data/{category}.json`, plus a combined `data/offer-items.json` (every category except houses — you can't offer a house for a house, per the game's own rule).
3. **`scripts/generate-house-pages.mjs`** — generates the static house browse/detail pages from `data/houses.json`.
4. `npm run build` = parse catalogs → copy `data/*.json` into `public/data/` (so the browser can fetch them) → generate house pages. Netlify runs this and publishes `public/`.

## How the trading marketplace works

- **Profiles** (`public/profile.html`) — just a Roblox username, validated against Roblox's public API for a real user id + avatar. No password. A session token is generated and stored in the browser (`localStorage`); that token is the only thing proving "this browser is that profile" for later actions.
- **Listings** (`public/list-a-house.html`) — three types, matching how r/adoptmehousetrading's actual traders post:
  - **House Trade** — you own a house, post it with photos, tag what you want back. Fields:
    - **Original vs. Cloned** declaration (cloned = 70%+ similar to another build, including speedbuilds — a real trust signal in that community)
    - **Value** as Shark or Frost units (the community's real baseline units — Shark for low/mid trades, Frost for high-tier; the conversion between them floats, so the unit is stored as the poster entered it, never auto-converted)
    - **Bucks invested** — a simple self-reported number, not an itemized furniture catalog
    - **Items included with the house** — bonus pets/items thrown in with the house itself, separate from what's wanted back
  - **Looking For** — you want a specific house and don't have one yet; describe what you'll pay. No photos required.
  - **Commission** — you build custom houses for hire; not tied to any one house.
- **Offers** (`public/listings/listing.html`) — for House Trade listings, an offer needs at least one item from the catalog (pets, vehicles, toys, pet wear, stickers, strollers, food — everything except houses, matching the game's actual rule that you can't trade a house for a house). For Looking For / Commission listings, a message alone is enough.
- **Completed trades / comps** (`public/comps.html`) — when an offer is accepted, either counterparty can confirm the trade actually happened in-game, optionally with a proof screenshot. If **both** sides confirm independently, it's marked "corroborated" and shows up in the public Recent Trades feed — real settled-trade data rather than a value team's judgment calls. This deliberately reuses the marketplace's own accepted offers as the data source instead of a cold separate submission flow, since a brand-new site has no trade volume to bootstrap a submission-first system with.
- **Reports** — no photo pre-approval, so every listing has a "Report this listing" control with reasons that mirror the real subreddit's actual rules: crosstrading, proxy trading, misrepresented original/cloned status, scam/no-show, other.
- **`public/rules.html`** — a plain-language rules page adapted from that subreddit's moderator posts (no crosstrading, no proxy trading, be honest about clones, commission fairness, the site never holds items).

The site structurally can't be used for crosstrading — the offer picker only ever pulls from the 7 Adopt Me item catalogs, there's no way to attach Robux or real money to an offer.

### What's intentionally NOT built yet

A much larger project-notes document (see prior chat) sketches a full verified-trade value engine: video-recorded trade proof with one-time codes, perceptual duplicate-hashing, vision-based auto-extraction, trust tiers, and a paid build registry with clone-dispute resolution. None of that is built. The `completed_trades` table above is a deliberately thin first step toward the same goal (real data over opinion) using only what the marketplace already produces — no new verification machinery. Revisit the fuller system once there's actual trade volume to justify it; comps are only meaningful with real data behind them regardless of how much verification tooling exists.

## Backend setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql` — creates `profiles`, `listings`, `offers`, `completed_trades`, `reports` with RLS enabled (public read-only on active/traded listings, their offers, and corroborated trades; all writes go through the service-role key in Netlify Functions). If you already ran an earlier version of this schema, run the migration files in order instead: `supabase/migration-001-listing-types.sql`, then `supabase/migration-002-value-units-and-comps.sql`.
3. In Storage, create a bucket named `listing-photos`. It can be public-read (uploads only happen server-side through `listings-upload-photo.js`, which validates type/size before anything lands there).
4. In Netlify's site settings → Environment variables, add:
   - `SUPABASE_URL` — Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API (**server-side only, never expose this to the browser**)

**Free-tier heads up:** Supabase pauses free projects after 7 days with zero API traffic. Fine for active development; if the site goes quiet for a week during early testing, you'll need to un-pause it from the Supabase dashboard before demoing.

## Local dev

```bash
npm install
npm run build
cd public && python3 -m http.server 8080
# visit http://localhost:8080
```

The Netlify Functions won't run under a plain static server — use `netlify dev` (Netlify CLI) once your `.env` has the Supabase vars, so the functions actually execute locally.

## Deploying (Netlify)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**, pick the repo.
3. Build command: `npm run build` (already set in `netlify.toml`).
4. Publish directory: `public` (already set in `netlify.toml`).
5. Add the `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars (above) before the first deploy — the functions will 500 without them.
6. Point `adoptmehousetrading.com` DNS at Netlify once the first deploy succeeds.

## Values

`data/houses.json` currently has `value: null` for every house — nothing is priced yet. See prior discussion on adopting AMTV's "Ride Potions" unit vs. inventing your own.

## Not built yet (next steps)

- Video verification, perceptual hashing, vision auto-extraction, trust tiers, and the paid build registry/dispute system (see "What's intentionally NOT built yet" above)
- Demand tracking ("most offered-on houses")
- Search/filter on the listings browse page (currently shows all active + traded, newest first)
- Reviews/trust system between traders (Traderie has this — worth considering once there's real trade volume)
- Rate limiting on profile creation / offer submission (currently wide open — fine at low volume, worth revisiting before this gets any traction)
- The other 7 catalogs are parsed and browsable via the offer/item pickers, but don't have their own dedicated browse/detail pages yet like houses do

