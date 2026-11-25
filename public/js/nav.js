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

    // The plain "Profile" text link is redundant once the pill (which also
    // links to profile.html) is showing — hide it to avoid a cramped,
    // confusing "Profile [pill]" cluster in the nav.
    document.querySelectorAll('.site-nav nav a[href$="profile.html"]').forEach((link) => {
      if (!link.classList.contains("nav-pill")) link.style.display = "none";
    });
  } catch {
    // malformed stored profile — leave the pill empty rather than break the page
  }
}

// Appearance: a mode (classic light, soft light, dark, or follow the device)
// and an accent colour. Both are CSS variable sets in style.css
// ([data-theme="soft"|"dark"], [data-accent=...]), so every component picks
// them up. Applied here rather than an inline head script; a brief flash of
// the default on load is an accepted tradeoff for that.
//
// "soft" exists because the classic light mode's green tints were reported
// as tiring to look at; it's the same layout on neutral greys.
const THEME_KEY = "amht_theme";
const ACCENT_KEY = "amht_accent";
const MODES = [
  { key: "light", label: "Classic" },
  { key: "soft", label: "Soft" },
  { key: "dark", label: "Dark" },
  { key: "auto", label: "Device" },
];
const ACCENTS = [
  { key: "red", label: "Red", swatch: "#E6483A" },
  { key: "pink", label: "Pink", swatch: "#E0457B" },
  { key: "purple", label: "Purple", swatch: "#8B5CF6" },
  { key: "blue", label: "Blue", swatch: "#2F7FE0" },
  { key: "teal", label: "Teal", swatch: "#0F9D8A" },
];
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function readPref(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.some((x) => x.key === v) ? v : fallback;
  } catch {
    return fallback;
  }
}
// Old saves were "light" or "dark", which are still valid modes. With no
// save at all, follow the device, which is what the site always did.
let themeMode = readPref(THEME_KEY, "auto", MODES);
let accent = readPref(ACCENT_KEY, "red", ACCENTS);

function applyAppearance() {
  const root = document.documentElement;
  const resolved = themeMode === "auto" ? (darkQuery?.matches ? "dark" : "light") : themeMode;
  if (resolved === "light") delete root.dataset.theme;
  else root.dataset.theme = resolved;
  if (accent === "red") delete root.dataset.accent;
  else root.dataset.accent = accent;
}
applyAppearance();
darkQuery?.addEventListener?.("change", () => themeMode === "auto" && applyAppearance());

const navActionsEl = document.querySelector(".nav-actions");
if (navActionsEl) {
  const panel = document.createElement("div");
  panel.className = "appearance-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Appearance");
  document.body.appendChild(panel);

  function renderPanel() {
    panel.innerHTML = `
      <div class="appearance-head">Appearance <button type="button" class="appearance-close" aria-label="Close">×</button></div>
      <div class="appearance-label">Mode</div>
      <div class="appearance-modes">${MODES.map((m) =>
        `<button type="button" data-mode="${m.key}" class="${m.key === themeMode ? "active" : ""}">${m.label}</button>`).join("")}</div>
      <div class="appearance-label">Color</div>
      <div class="appearance-accents">${ACCENTS.map((c) =>
        `<button type="button" data-accent="${c.key}" class="${c.key === accent ? "active" : ""}" style="--sw:${c.swatch}" aria-label="${c.label}" title="${c.label}"></button>`).join("")}</div>`;
  }

  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "theme-toggle";
  themeBtn.title = "Appearance";
  themeBtn.setAttribute("aria-label", "Appearance");
  themeBtn.textContent = "🎨";
  navActionsEl.prepend(themeBtn);

  // Phones hide the header button; the menu gets its own entry instead.
  const navMenu = document.querySelector(".site-nav nav");
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "nav-appearance-link";
  menuBtn.textContent = "Appearance";
  navMenu?.appendChild(menuBtn);

  function openPanel(anchor) {
    renderPanel();
    panel.hidden = false;
    const r = anchor.getBoundingClientRect();
    panel.classList.toggle("is-sheet", innerWidth <= 640);
    if (innerWidth > 640) {
      panel.style.top = `${r.bottom + window.scrollY + 8}px`;
      panel.style.left = `${Math.max(12, Math.min(r.right - 260, innerWidth - 272)) + window.scrollX}px`;
    } else {
      panel.style.top = panel.style.left = "";
    }
  }
  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden ? openPanel(themeBtn) : (panel.hidden = true);
  });
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Close the mobile menu first so the sheet isn't hidden behind it.
    document.getElementById("nav-hamburger")?.click();
    openPanel(menuBtn);
  });
  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    const mode = e.target.closest("[data-mode]")?.dataset.mode;
    const acc = e.target.closest("[data-accent]")?.dataset.accent;
    if (e.target.closest(".appearance-close")) { panel.hidden = true; return; }
    if (mode) { themeMode = mode; try { localStorage.setItem(THEME_KEY, mode); } catch {} }
    if (acc) { accent = acc; try { localStorage.setItem(ACCENT_KEY, acc); } catch {} }
    if (mode || acc) { applyAppearance(); renderPanel(); }
  });
  document.addEventListener("click", () => { panel.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") panel.hidden = true; });
}

// "More" nav dropdown (Values, Build Registry, Guides) — same toggle-and-click-away
// pattern as the house-picker dropdown elsewhere on the site.
const moreTrigger = document.querySelector(".nav-more-trigger");
const moreDropdown = document.querySelector(".nav-more-dropdown");
if (moreTrigger && moreDropdown) {
  moreTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    moreDropdown.hidden = !moreDropdown.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!moreDropdown.hidden && !moreDropdown.contains(e.target) && !moreTrigger.contains(e.target)) {
      moreDropdown.hidden = true;
    }
  });
}

// Notification bell — only for signed-in users. Same depth-prefix logic as
// the profile pill above, since links inside notifications need to resolve
// correctly from any page depth.
if (raw) {
  const segments = location.pathname.split("/").filter(Boolean);
  const depth = location.pathname.endsWith("/") ? segments.length : segments.length - 1;
  const prefix = "../".repeat(Math.max(0, depth));

  const token = localStorage.getItem("amht_token");
  if (token && pillEl) {
    const bellWrap = document.createElement("span");
    bellWrap.className = "nav-bell-wrap";
    // Notifications and Messages are full pages now (notifications.html,
    // messages.html) rather than a dropdown over the page, which was hard to
    // use on phones. The bell keeps its unread badge.
    bellWrap.innerHTML = `
      <a class="nav-bell" href="${prefix}messages.html" title="Messages" aria-label="Messages">💬</a>
      <a class="nav-bell" href="${prefix}notifications.html" title="Notifications" aria-label="Notifications">🔔<span class="nav-bell-badge" hidden>0</span></a>`;
    pillEl.insertAdjacentElement("beforebegin", bellWrap);

    const bellBadge = bellWrap.querySelector(".nav-bell-badge");

    // notifications-list used to run on every single page view. Measured on
    // the live site it was the busiest endpoint by far, around 3.7 calls a
    // minute, and each one was two Postgres queries, which is a large part of
    // why Neon's compute never got to sleep. The payload only changes when
    // something actually happens to this user, so a short per-browser cache
    // removes almost all of those calls. The Notifications page always
    // refetches and clears this cache, so the badge catches up straight away.
    const NOTIF_CACHE_KEY = "amht_notifs_cache";
    const NOTIF_TTL_MS = 3 * 60 * 1000;

    function readNotifCache() {
      try {
        const raw = localStorage.getItem(NOTIF_CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || typeof c.at !== "number" || Date.now() - c.at > NOTIF_TTL_MS) return null;
        return c.data;
      } catch {
        return null;
      }
    }

    function writeNotifCache(data) {
      try {
        localStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
      } catch {
        // storage full or blocked — caching is an optimisation, not a feature
      }
    }

    function renderBadge(data) {
      const n = Number(data?.unread_count) || 0;
      bellBadge.hidden = n === 0;
      bellBadge.textContent = n > 9 ? "9+" : String(n);
    }

    async function loadNotifications() {
      const cached = readNotifCache();
      if (cached) {
        renderBadge(cached);
        return;
      }
      try {
        const res = await fetch("/.netlify/functions/notifications-list", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load");
        writeNotifCache(data);
        renderBadge(data);
      } catch {
        // the badge is a hint; the page itself shows any error
      }
    }

    // The Notifications page updates the badge as it marks things read.
    window.addEventListener("amht:notifications", (e) => renderBadge(e.detail));

    loadNotifications();
  }
}

// Mobile hamburger — collapses nav to brand + menu button on small screens.
// The button is injected into every page's HTML; this wires up the toggle.
const hamburger = document.getElementById("nav-hamburger");
const navEl = document.querySelector(".site-nav nav");
if (hamburger && navEl) {
  hamburger.addEventListener("click", () => {
    const isOpen = navEl.classList.toggle("mobile-open");
    hamburger.classList.toggle("open", isOpen);
    // Prevent body scroll while menu is open
    document.body.style.overflow = isOpen ? "hidden" : "";
  });
  // Close menu when a nav link is tapped
  navEl.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      navEl.classList.remove("mobile-open");
      hamburger.classList.remove("open");
      document.body.style.overflow = "";
    });
  });
  // Close menu on outside tap
  document.addEventListener("click", (e) => {
    // contains(), not ===: a tap on one of the three lines inside the button
    // has the line as its target, and used to close the menu the same
    // instant it opened, so the menu seemed not to work on phones.
    if (navEl.classList.contains("mobile-open") &&
        !navEl.contains(e.target) &&
        !hamburger.contains(e.target)) {
      navEl.classList.remove("mobile-open");
      hamburger.classList.remove("open");
      document.body.style.overflow = "";
    }
  });
}
