// Parses public/images/{category}/*.png filenames into data/{category}.json
// for every category, plus a combined data/offer-items.json used by the
// trade-offer picker (everything except houses — a house itself can't be
// offered as payment for another house, per the game's own trading rules).
//
// Filename convention: {Name}-{Rarity}-from-{Source}.png

import { readdirSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
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

const KNOWN_RARITIES = ["Common", "Uncommon", "Ultra-Rare", "Rare", "Legendary"];

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseFilename(filename, categoryKey) {
  const base = filename.replace(/\.(png|webp|svg)$/i, "");

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

  const SUPPORTED_EXTS = [".png", ".webp", ".svg"];
  const EXT_PRIORITY = { ".webp": 0, ".png": 1, ".svg": 2 };
  const allFiles = readdirSync(imagesDir).filter((f) =>
    SUPPORTED_EXTS.some((ext) => f.toLowerCase().endsWith(ext))
  );
  // De-duplicate: for same base name, prefer webp > png > svg
  const bestByBase = {};
  for (const f of allFiles) {
    const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
    const base = f.slice(0, f.lastIndexOf("."));
    if (!bestByBase[base] || EXT_PRIORITY[ext] < EXT_PRIORITY[bestByBase[base].slice(bestByBase[base].lastIndexOf(".")).toLowerCase()]) {
      bestByBase[base] = f;
    }
  }
  const files = Object.values(bestByBase);
  const items = files
    .map((f) => parseFilename(f, categoryKey))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Merge extra fields (availability, bucksPrice, floors, expandable, value, valueUnit)
  // from the existing JSON so manual enrichment survives re-parses
  const existingPath = path.join(DATA_DIR, `${categoryKey}.json`);
  if (existsSync(existingPath)) {
    const existing = JSON.parse(readFileSync(existingPath, "utf-8"));
    const existingById = Object.fromEntries(existing.map((e) => [e.id, e]));
    const PRESERVE_FIELDS = ["availability", "bucksPrice", "floors", "expandable", "value", "valueUnit"];
    for (const item of items) {
      const prev = existingById[item.id];
      if (prev) {
        for (const field of PRESERVE_FIELDS) {
          if (prev[field] !== undefined && prev[field] !== null) {
            item[field] = prev[field];
          }
        }
      }
    }
  }

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
