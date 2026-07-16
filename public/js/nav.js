// Populates the #nav-profile-pill slot in the header with the current
// profile's Roblox username, if one is stored. Included on every page via
// a script tag right after the header, so the nav looks consistent
// everywhere without duplicating this logic per-page.

const raw = localStorage.getItem("amht_profile");
const pillEl = document.getElementById("nav-profile-pill");

if (raw && pillEl) {
  try {
    const profile = JSON.parse(raw);
    pillEl.innerHTML = `<a href="${location.pathname.includes("/listings/") || location.pathname.includes("/houses/") ? "../" : ""}profile.html" class="nav-pill">${profile.rbx_username}</a>`;
  } catch {
    // malformed stored profile — leave the pill empty rather than break the page
  }
}
