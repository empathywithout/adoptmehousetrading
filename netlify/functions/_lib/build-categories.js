// What kind of build a listing or registry entry is. Houses were the only
// kind until migration-031; the others are player-made builds people trade
// the same way.
//
// This is the ONE server-side list. The browser has its own copy in
// public/js/api.js (BUILD_CATEGORIES) and the Discord feed maps each key to a
// webhook in discord-post-listings.js. Adding a category means touching all
// three plus the check constraints in migration-031 / schema.sql.
export const BUILD_CATEGORIES = ["house", "plushie", "furniture", "wall_art"];

export function cleanCategory(value) {
  return BUILD_CATEGORIES.includes(value) ? value : "house";
}

// Singular labels, for "For trade: Plushie" and the like.
export const CATEGORY_LABELS = {
  house: "House",
  plushie: "Plushie",
  furniture: "Furniture",
  wall_art: "Wall Art",
};
