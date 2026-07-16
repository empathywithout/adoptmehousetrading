// Populates the #nav-profile-pill slot in the header with the current
// profile's display name, if one is stored. Included on every page via a
// script tag right after the header, so the nav looks consistent
// everywhere without duplicating this logic per-page.

const raw = localStorage.getItem("amht_profile");
const pillEl = document.getElementById("nav-profile-pill");

if (raw && pillEl) {
  try {
    const profile = JSON.parse(raw);
    // Falls back gracefully instead of ever rendering a literal "undefined"
    // — guards against stale localStorage from before display_name existed.
    const label = profile.display_name || profile.rbx_username || "Profile";

    // Depth computed from the URL itself (segments before the filename)
    // rather than a hardcoded list of subdirectory names — a page one
    // level deep (e.g. /commissions/builder.html) needs "../" to reach
    // /profile.html; a root page (e.g. /profile.html) needs no prefix.
    const segments = location.pathname.split("/").filter(Boolean);
    // A trailing-slash directory URL (e.g. /houses/) is one level deep just
    // like /houses/index.html — account for that instead of undercounting.
    const depth = location.pathname.endsWith("/") ? segments.length : segments.length - 1;
    const prefix = "../".repeat(Math.max(0, depth));

    pillEl.innerHTML = `<a href="${prefix}profile.html" class="nav-pill">${label}</a>`;
  } catch {
    // malformed stored profile — leave the pill empty rather than break the page
  }
}
