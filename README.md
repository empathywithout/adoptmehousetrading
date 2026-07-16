# AdoptMeHouseTrading.com

A static, pre-rendered site for browsing Adopt Me house values and (soon) checking trades — built the same way as TCG Watchtower: filenames → structured JSON → generated HTML, no server-side rendering needed at runtime.

## How it works

1. **`public/images/houses/`** — the 51 house images, filenames intact (`{Name}-{Rarity}-from-{Source}.png`).
2. **`scripts/parse-houses.mjs`** — reads those filenames and writes `data/houses.json` (name, rarity, source, image path, and placeholder `value`/`valueUnit` fields).
3. **`scripts/generate-house-pages.mjs`** — reads `data/houses.json` and generates:
   - `public/index.html` — homepage
   - `public/houses/index.html` — full browse grid
   - `public/houses/{id}.html` — one detail page per house
4. Netlify runs `npm run build` (= parse + generate) and publishes the `public/` directory.

## Local dev

```bash
npm run build
cd public && python3 -m http.server 8080
# visit http://localhost:8080
```

Re-run `npm run build` any time you add images or edit `data/houses.json`.

## Values

`data/houses.json` currently has `value: null` for every house — nothing is priced yet. Once you decide the value system (adopt AMTV's "Ride Potions" unit, or invent your own), the values can be hand-edited into `data/houses.json` directly, or we can build a small `data/values.json` overlay that the generator merges in, so re-running `parse-houses.mjs` (e.g. after adding new house images) never wipes out prices you've already set.

## Deploying (Netlify)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**, pick the repo.
3. Build command: `npm run build` (already set in `netlify.toml`).
4. Publish directory: `public` (already set in `netlify.toml`).
5. Point `adoptmehousetrading.com` DNS at Netlify once the first deploy succeeds.

## Not built yet (next steps)

- Trade calculator (house-for-house / house-for-items comparison)
- Actual house values + a value-update workflow
- Demand tracking ("most offered-on houses")
- Any of the other 7 asset categories you uploaded (strollers, stickers, foods, pet wear, vehicles, toys, pets) — not touched, this pass is houses-only per your ask
