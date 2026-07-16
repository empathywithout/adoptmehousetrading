// Parses public/images/{category}/*.png filenames into data/{category}.json
// for every category, plus a combined data/offer-items.json used by the
// trade-offer picker (everything except houses — a house itself can't be
// offered as payment for another house, per the game's own trading rules).
//
// Filename convention: {Name}-{Rarity}-from-{Source}.png

import { readdirSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const IMAGES_ROOT = path.join(process.cwd(), "public", "images");
const DATA_DIR = path.join(process.cwd(), "data");

// category key -> { dir, label }
const CATEGORIES = {
  houses: { dir: "houses", label: "House" },
  adopt_me_pets: { dir: "adopt_me_pets", label: "Pet" },
  vehicles: { dir: "vehicles", label: "Vehicle" },
  toys: { dir: "toys", label: "Toy" },
  pet_wear: { dir: "pet_wear", label: "Pet Wear" },
  stickers: { dir: "stickers", label: "Sticker" },
  strollers: { dir: "strollers", label: "Stroller" },
  foods: { dir: "foods", label: "Food" },
};

const KNOWN_RARITIES = ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"];

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseFilename(filename, categoryKey) {
  const base = filename.replace(/\.png$/i, "");

  let match = null;
  for (const rarity of KNOWN_RARITIES) {
    const marker = `-${rarity}-from-`;
    const idx = base.indexOf(marker);
    if (idx !== -1) {
      match = { rarity: rarity.replace("-", " "), idx, markerLen: marker.length };
      break;
    }
  }

  if (!match) {
    console.warn(`WARNING [${categoryKey}]: could not parse "${filename}" — skipping`);
    return null;
  }

  const cleanup = (s) => s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const name = cleanup(base.slice(0, match.idx));
  const source = cleanup(base.slice(match.idx + match.markerLen));

  return {
    id: slugify(name),
    category: categoryKey,
    name,
    rarity: match.rarity,
    source,
    image: `/images/${CATEGORIES[categoryKey].dir}/${filename}`,
    value: null,
    valueUnit: null,
  };
}

function parseCategory(categoryKey) {
  const { dir } = CATEGORIES[categoryKey];
  const imagesDir = path.join(IMAGES_ROOT, dir);

  if (!existsSync(imagesDir)) {
    console.warn(`No image directory for "${categoryKey}" at ${imagesDir} — skipping category`);
    return [];
  }

  const files = readdirSync(imagesDir).filter((f) => f.toLowerCase().endsWith(".png"));
  const items = files
    .map((f) => parseFilename(f, categoryKey))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return items;
}

function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const allByCategory = {};
  for (const key of Object.keys(CATEGORIES)) {
    const items = parseCategory(key);
    allByCategory[key] = items;
    writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(items, null, 2));
    console.log(`${key}: ${items.length} items -> data/${key}.json`);
  }

  // Combined catalog for the trade-offer item picker: everything tradeable
  // FOR a house, i.e. every category except houses themselves.
  const offerItems = Object.entries(allByCategory)
    .filter(([key]) => key !== "houses")
    .flatMap(([, items]) => items);

  writeFileSync(path.join(DATA_DIR, "offer-items.json"), JSON.stringify(offerItems, null, 2));
  console.log(`offer-items: ${offerItems.length} items -> data/offer-items.json`);
}

main();
