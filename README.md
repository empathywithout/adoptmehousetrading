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
- **Listings** (`public/list-a-house.html`) — a signed-in profile picks a house, uploads photos (server-validated, uploaded to Supabase Storage), and tags what categories they're looking for. Posts instantly, no moderation queue.
- **Offers** (`public/listings/listing.html`) — any other profile can build an offer from the full item catalog (pets, vehicles, toys, pet wear, stickers, strollers, food) and submit it. The listing owner can accept or decline; accepting marks the listing "traded" and auto-declines the rest. The site never touches the actual trade — like Traderie, it just gets both Roblox usernames in front of each other so they trade in-game.
- **Reports** — no photo pre-approval, so there's a "Report this listing" link on every listing page instead, logged to a `reports` table for manual review.

## Backend setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql` — creates `profiles`, `listings`, `offers`, `reports` with RLS enabled (public read-only on active/traded listings and their offers; all writes go through the service-role key in Netlify Functions).
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

- Actual house values + a value-update workflow
- Demand tracking ("most offered-on houses")
- Search/filter on the listings browse page (currently shows all active + traded, newest first)
- Reviews/trust system between traders (Traderie has this — worth considering once there's real trade volume)
- Rate limiting on profile creation / offer submission (currently wide open — fine at low volume, worth revisiting before this gets any traction)
- The other 7 catalogs are parsed and browsable via the offer picker, but don't have their own dedicated browse/detail pages yet like houses do

