// Parses public/images/houses/*.png filenames into structured data/houses.json
//
// Filename convention: {Name}-{Rarity}-from-{Source}.png
// Example: "Cozy-Cabin-Common-from-Cozy-Cabin-&-Snowmobile-Gamepass-(Robux).png"
//   -> name: "Cozy Cabin"
//   -> rarity: "Common"
//   -> source: "Cozy Cabin & Snowmobile Gamepass (Robux)"
//
// All Adopt Me houses are currently "Common" rarity (value comes from the
// house-specific value scale, not a rarity tier), but this parser doesn't
// assume that in case that ever changes.

import { readdirSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const IMAGES_DIR = path.join(process.cwd(), "public", "images", "houses");
const OUTPUT_FILE = path.join(process.cwd(), "data", "houses.json");

const KNOWN_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Ultra-Rare",
  "Legendary",
];

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFilename(filename) {
  const base = filename.replace(/\.png$/i, "");

  // Find which known rarity token appears, bounded by hyphens, followed by "-from-"
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
    console.warn(`WARNING: could not parse rarity/source from "${filename}" — skipping`);
    return null;
  }

  const rawName = base.slice(0, match.idx);
  const rawSource = base.slice(match.idx + match.markerLen);

  // Restore spaces from hyphens, but preserve intentional punctuation like
  // apostrophes, ampersands, and parenthetical suffixes such as "(Robux)".
  const cleanup = (s) =>
    s
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const name = cleanup(rawName);
  const source = cleanup(rawSource);

  return {
    id: slugify(name),
    name,
    rarity: match.rarity,
    source,
    image: `/images/houses/${filename}`,
    // Value fields left null — populate via a separate values data pass.
    value: null,
    valueUnit: null, // e.g. "RP" (Ride Potions) once a value system is chosen
  };
}

function main() {
  const files = readdirSync(IMAGES_DIR).filter((f) => f.toLowerCase().endsWith(".png"));

  const houses = files
    .map(parseFilename)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(houses, null, 2));

  console.log(`Parsed ${houses.length} houses -> ${OUTPUT_FILE}`);
  if (houses.length !== files.length) {
    console.log(`(${files.length - houses.length} file(s) skipped — see warnings above)`);
  }
}

main();
