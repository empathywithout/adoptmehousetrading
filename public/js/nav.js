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
    if (!moreDropdown.hidden && !moreDropdown.contains(e.target) && e.target !== moreTrigger) {
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
    bellWrap.innerHTML = `
      <button type="button" class="nav-bell" title="Notifications">🔔<span class="nav-bell-badge" hidden>0</span></button>
      <div class="nav-bell-dropdown" hidden>
        <div class="nav-bell-header">Notifications <button type="button" class="nav-bell-mark-all">Mark all read</button></div>
        <div class="nav-bell-list"><p class="hint" style="padding:12px;">Loading...</p></div>
      </div>`;
    pillEl.insertAdjacentElement("beforebegin", bellWrap);

    const bellBtn = bellWrap.querySelector(".nav-bell");
    const bellBadge = bellWrap.querySelector(".nav-bell-badge");
    const bellDropdown = bellWrap.querySelector(".nav-bell-dropdown");
    const bellList = bellWrap.querySelector(".nav-bell-list");

    function escapeHtml(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function timeAgo(iso) {
      const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    }

    async function loadNotifications() {
      try {
        const res = await fetch("/.netlify/functions/notifications-list", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load");

        bellBadge.hidden = data.unread_count === 0;
        bellBadge.textContent = data.unread_count > 9 ? "9+" : data.unread_count;

        if (!data.notifications.length) {
          bellList.innerHTML = `<p class="hint" style="padding:12px;">No notifications yet.</p>`;
          return;
        }

        bellList.innerHTML = data.notifications
          .map(
            (n) => `<a class="nav-bell-item ${n.read ? "" : "unread"}" href="${prefix}${n.link || "profile.html"}" data-id="${n.id}">
              <div>${escapeHtml(n.message)}</div>
              <div class="nav-bell-time">${timeAgo(n.created_at)}</div>
            </a>`
          )
          .join("");

        bellList.querySelectorAll(".nav-bell-item").forEach((item) => {
          item.addEventListener("click", () => {
            fetch("/.netlify/functions/notifications-mark-read", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ notification_id: item.dataset.id }),
            }).catch(() => {});
          });
        });
      } catch {
        bellList.innerHTML = `<p class="hint" style="padding:12px;">Couldn't load notifications.</p>`;
      }
    }

    bellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      bellDropdown.hidden = !bellDropdown.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!bellDropdown.hidden && !bellDropdown.contains(e.target) && e.target !== bellBtn) {
        bellDropdown.hidden = true;
      }
    });
    bellWrap.querySelector(".nav-bell-mark-all").addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await fetch("/.netlify/functions/notifications-mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ all: true }),
        });
        await loadNotifications();
      } catch {
        // non-critical — leave as-is if this fails
      }
    });

    loadNotifications();
  }
}
