import { CATEGORY_LABELS } from "./api.js";

// Mounts an item picker into `container`. Returns { getSelected() }.
// `container` must contain these child elements with these exact ids,
// scoped by the optional `prefix` (so multiple pickers can coexist on one page):
//   {prefix}category-tabs, {prefix}item-search, {prefix}item-results, {prefix}selected-items
//
// Supports quantities: clicking an item already in the selection adds
// another of it. A small × button on the tile's own qty badge removes one
// (or the whole thing at qty 1) directly from the grid — no need to
// scroll to the chip list just to back out of a click.
//
// Pets specifically also get variant (Regular/Neon/Mega Neon) and potion
// (None/Ride/Fly/Ride+Fly) selectors on their chip — these are two
// independent axes that multiply a pet's actual trade value (same model
// Elvebredd/Traderie/AdoptMeValues all use), not cosmetic flavor text.
export const PET_CATEGORY = "adopt_me_pets";
export const VARIANT_LABELS = { regular: "Regular", neon: "Neon", mega_neon: "Mega Neon" };
export const POTION_LABELS = { none: "No Potion", ride: "Ride", fly: "Fly", fly_ride: "Fly + Ride" };

export function mountItemPicker(container, prefix = "") {
  const categories = Object.keys(CATEGORY_LABELS);
  const catalogsByCategory = {};
  let activeCategory = categories[0];
  const selected = []; // [{ category, id, name, image, qty, variant?, potion? }]
  const MAX_QTY = 20;

  const el = (id) => container.querySelector(`#${prefix}${id}`);

  const tabs = el("category-tabs");
  tabs.innerHTML = categories
    .map((c) => `<button data-cat="${c}" class="${c === activeCategory ? "active" : ""}">${CATEGORY_LABELS[c]}</button>`)
    .join("");

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function variantPrefix(it) {
    if (it.category !== PET_CATEGORY) return "";
    const bits = [];
    if (it.variant && it.variant !== "regular") bits.push(VARIANT_LABELS[it.variant]);
    if (it.potion && it.potion !== "none") bits.push(`(${{ ride: "R", fly: "F", fly_ride: "FR" }[it.potion]})`);
    return bits.length ? bits.join(" ") + " " : "";
  }

  async function loadCategory(cat) {
    if (!catalogsByCategory[cat]) {
      const segments = location.pathname.split("/").filter(Boolean);
      const depthLevel = location.pathname.endsWith("/") ? segments.length : segments.length - 1;
      const depth = "../".repeat(Math.max(0, depthLevel));
      catalogsByCategory[cat] = await fetch(`${depth}data/${cat}.json`).then((r) => r.json());
    }
    renderResults();
  }

  function findSelected(id, category) {
    return selected.find((s) => s.id === id && s.category === category);
  }

  function renderResults() {
    const search = el("item-search").value.toLowerCase();
    const items = (catalogsByCategory[activeCategory] || [])
      .filter((it) => it.name.toLowerCase().includes(search))
      .slice(0, 60);

    el("item-results").innerHTML = items
      .map((it) => {
        const existing = findSelected(it.id, it.category);
        return `<div class="result-item ${existing ? "selected" : ""}"
                    data-id="${it.id}" data-cat="${it.category}">
                    ${
                      existing
                        ? `<span class="result-qty-badge" data-remove-one="${it.id}" data-remove-cat="${it.category}" title="Click to remove one">${existing.qty}<span class="badge-x">×</span></span>`
                        : ""
                    }
                    <img src="${it.image}" alt="">${escapeHtml(it.name)}
                  </div>`;
      })
      .join("");

    el("item-results").querySelectorAll(".result-item").forEach((resultEl) => {
      resultEl.addEventListener("click", (e) => {
        const badge = e.target.closest("[data-remove-one]");
        const item = catalogsByCategory[activeCategory].find((i) => i.id === resultEl.dataset.id);
        const existing = findSelected(item.id, item.category);

        if (badge && existing) {
          // Clicked the qty badge itself — remove one instead of adding.
          existing.qty -= 1;
          if (existing.qty <= 0) {
            const idx = selected.indexOf(existing);
            selected.splice(idx, 1);
          }
        } else if (existing) {
          existing.qty = Math.min(MAX_QTY, existing.qty + 1);
        } else {
          const entry = { ...item, qty: 1 };
          if (item.category === PET_CATEGORY) {
            entry.variant = "regular";
            entry.potion = "none";
          }
          selected.push(entry);
        }
        renderResults();
        renderSelected();
      });
    });
  }

  function renderSelected() {
    el("selected-items").innerHTML = selected
      .map((it, i) => {
        const petControls =
          it.category === PET_CATEGORY
            ? `<div class="pet-modifiers">
                <select data-i="${i}" data-field="variant">
                  ${Object.entries(VARIANT_LABELS).map(([k, l]) => `<option value="${k}" ${it.variant === k ? "selected" : ""}>${l}</option>`).join("")}
                </select>
                <select data-i="${i}" data-field="potion">
                  ${Object.entries(POTION_LABELS).map(([k, l]) => `<option value="${k}" ${it.potion === k ? "selected" : ""}>${l}</option>`).join("")}
                </select>
              </div>`
            : "";
        return `
        <div class="selected-chip">
          <div class="chip-top">
            <img src="${it.image}" alt="">
            <span class="chip-name">${escapeHtml(variantPrefix(it) + it.name)}</span>
            <button data-i="${i}" data-action="remove" class="chip-remove" title="Remove">×</button>
          </div>
          ${petControls}
          <div class="chip-footer">
            <div class="qty-stepper">
              <button data-i="${i}" data-action="dec">−</button>
              <span class="qty-num">${it.qty}</span>
              <button data-i="${i}" data-action="inc">+</button>
            </div>
          </div>
        </div>`;
      })
      .join("");

    el("selected-items")
      .querySelectorAll("button[data-action]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.dataset.i);
          if (btn.dataset.action === "remove") {
            selected.splice(i, 1);
          } else if (btn.dataset.action === "inc") {
            selected[i].qty = Math.min(MAX_QTY, selected[i].qty + 1);
          } else if (btn.dataset.action === "dec") {
            selected[i].qty -= 1;
            if (selected[i].qty <= 0) selected.splice(i, 1);
          }
          renderResults();
          renderSelected();
        });
      });

    el("selected-items")
      .querySelectorAll("select[data-field]")
      .forEach((sel) => {
        sel.addEventListener("change", () => {
          const i = Number(sel.dataset.i);
          selected[i][sel.dataset.field] = sel.value;
          renderSelected();
        });
      });
  }

  tabs.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      activeCategory = btn.dataset.cat;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      await loadCategory(activeCategory);
    });
  });

  el("item-search").addEventListener("input", renderResults);

  loadCategory(activeCategory);

  return { getSelected: () => selected };
}
