import { CATEGORY_LABELS } from "./api.js";

// Mounts an item picker into `container`. Returns { getSelected() }.
// `container` must contain these child elements with these exact ids,
// scoped by the optional `prefix` (so multiple pickers can coexist on one page):
//   {prefix}category-tabs, {prefix}item-search, {prefix}item-results, {prefix}selected-items
export function mountItemPicker(container, prefix = "") {
  const categories = Object.keys(CATEGORY_LABELS);
  const catalogsByCategory = {};
  let activeCategory = categories[0];
  const selected = [];

  const el = (id) => container.querySelector(`#${prefix}${id}`);

  const tabs = el("category-tabs");
  tabs.innerHTML = categories
    .map((c) => `<button data-cat="${c}" class="${c === activeCategory ? "active" : ""}">${CATEGORY_LABELS[c]}</button>`)
    .join("");

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function loadCategory(cat) {
    if (!catalogsByCategory[cat]) {
      const depth = location.pathname.includes("/listings/") ? "../" : "";
      catalogsByCategory[cat] = await fetch(`${depth}data/${cat}.json`).then((r) => r.json());
    }
    renderResults();
  }

  function renderResults() {
    const search = el("item-search").value.toLowerCase();
    const items = (catalogsByCategory[activeCategory] || [])
      .filter((it) => it.name.toLowerCase().includes(search))
      .slice(0, 60);

    el("item-results").innerHTML = items
      .map(
        (it) => `<div class="result-item ${selected.some((s) => s.id === it.id && s.category === it.category) ? "selected" : ""}"
                    data-id="${it.id}" data-cat="${it.category}">
                    <img src="${it.image}" alt="">${escapeHtml(it.name)}
                  </div>`
      )
      .join("");

    el("item-results").querySelectorAll(".result-item").forEach((resultEl) => {
      resultEl.addEventListener("click", () => {
        const item = catalogsByCategory[activeCategory].find((i) => i.id === resultEl.dataset.id);
        const idx = selected.findIndex((s) => s.id === item.id && s.category === item.category);
        if (idx === -1) selected.push(item);
        else selected.splice(idx, 1);
        renderResults();
        renderSelected();
      });
    });
  }

  function renderSelected() {
    el("selected-items").innerHTML = selected
      .map(
        (it, i) =>
          `<span class="selected-chip"><img src="${it.image}" alt="">${escapeHtml(it.name)}<button data-i="${i}">×</button></span>`
      )
      .join("");
    el("selected-items")
      .querySelectorAll(".selected-chip button")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          selected.splice(Number(btn.dataset.i), 1);
          renderResults();
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
