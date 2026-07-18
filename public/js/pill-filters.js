// pill-filters.js
// Mounts the new pill-based filter UI.
// Usage: import { mountPillFilters } from './pill-filters.js';
//
// mountPillFilters(container, options) where options = {
//   type:   bool  — show listing type filter
//   build:  bool  — show build type + glitch modifier
//   theme:  bool  — show theme pills (pass themes array of {val, label} already in use)
//   sort:   bool  — show sort pills (pass sorts array of {val, label})
//   search: bool  — show search input
//   onChange: fn(state) — called whenever any filter changes
// }
//
// Returns { getState, reset }

const THEME_EMOJI = {
  cutecore:'🌸',coquette:'🎀',cottagecore:'🌿',cozy:'🕯️',fairycore:'🧚',gothic:'🦇',
  fantasy:'🧙',royal:'👑',cutegoth:'🖤',cottagegoth:'🌑',nature:'🌲',garden:'🌷',
  japanese:'⛩️',modern:'🏙️',minimalist:'◻️',medieval:'🏰',dark_academia:'📚',
  victorian:'🕰️',vintage:'📻',beach:'🏖️',tropical:'🌺',farmhouse:'🚜',autumn:'🍂',
  winter_cabin:'❄️',spring:'🌼',horror:'💀',holiday_seasonal:'🎄',realism:'🎨',
  custom_theme:'🎲',
};

const TOP_THEMES = ['cutecore','coquette','cottagecore','cozy','fairycore','gothic','fantasy','royal'];

const CSS = `
.pf-wrap{margin-bottom:18px;}
.pf-active-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;min-height:0;}
.pf-active-bar:empty{display:none;}
.pf-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);border:1px solid var(--accent);color:var(--accent);font-size:12px;font-weight:600;}
.pf-chip.glitch{background:#f3f0ff;border-color:#7c3aed;color:#5b21b6;}
.pf-chip button{background:none;border:none;cursor:pointer;color:inherit;padding:0 0 0 3px;font-size:13px;line-height:1;opacity:.7;}
.pf-chip button:hover{opacity:1;}
.pf-section{margin-bottom:12px;}
.pf-label{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;}
.pf-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.pf-pill{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:999px;border:1.5px solid var(--line);background:var(--surface);color:var(--muted);font-size:13px;cursor:pointer;white-space:nowrap;user-select:none;line-height:1;font-family:inherit;}
.pf-pill:hover{border-color:var(--ink-soft);color:var(--ink);}
.pf-pill.active{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:700;}
.pf-divider{width:1px;height:22px;background:var(--line);margin:0 2px;flex-shrink:0;}
.pf-glitch{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;border:1.5px dashed var(--line);background:transparent;color:var(--muted);font-size:13px;cursor:pointer;white-space:nowrap;user-select:none;line-height:1;font-family:inherit;}
.pf-glitch:hover{border-color:#7c3aed;color:#7c3aed;}
.pf-glitch.active{background:#f3f0ff;border:1.5px solid #7c3aed;color:#5b21b6;font-weight:700;}
.pf-glitch-dot{width:8px;height:8px;border-radius:50%;background:var(--line);flex-shrink:0;transition:background .12s;}
.pf-glitch.active .pf-glitch-dot{background:#7c3aed;}
.pf-glitch-hint{font-size:11px;color:var(--muted);margin-top:6px;display:none;}
.pf-more{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;border:1.5px dashed var(--line);background:transparent;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;}
.pf-more:hover{color:var(--ink);border-color:var(--ink-soft);}
.pf-bottom{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px;}
.pf-clear{font-size:12px;color:var(--muted);background:none;border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer;font-family:inherit;}
.pf-clear:hover{color:var(--ink);border-color:var(--ink-soft);}
.pf-search{padding:7px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13.5px;min-width:160px;flex:1;max-width:240px;font-family:inherit;}
.pf-search:focus{outline:none;border-color:var(--accent);}
`;

export function mountPillFilters(container, opts = {}) {
  const {
    type: showType = false,
    build: showBuild = false,
    theme: showTheme = false,
    sort: showSort = false,
    search: showSearch = false,
    themes = [],
    sorts = [],
    onChange = () => {},
  } = opts;

  // Inject styles once
  if (!document.getElementById('pf-styles')) {
    const s = document.createElement('style');
    s.id = 'pf-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const state = { type: 'all', build: 'all', glitch: false, theme: 'all', sort: sorts[0]?.val || 'recent', search: '' };
  let themeExpanded = false;
  const hiddenThemeVals = themes.filter(t => !TOP_THEMES.includes(t.val)).map(t => t.val);
  const visibleThemes  = themes.filter(t => TOP_THEMES.includes(t.val));
  const extraThemes    = themes.filter(t => !TOP_THEMES.includes(t.val));

  function html() {
    const parts = [];

    // Active bar
    parts.push(`<div class="pf-active-bar" id="pf-active-bar"></div>`);

    // Sort
    if (showSort && sorts.length) {
      parts.push(`<div class="pf-section">
        <div class="pf-row" id="pf-sort-row">
          ${sorts.map(s => `<button class="pf-pill${state.sort===s.val?' active':''}" data-pf-sort="${s.val}">${s.label}</button>`).join('')}
        </div>
      </div>`);
    }

    // Type
    if (showType) {
      parts.push(`<div class="pf-section">
        <div class="pf-label">Listing type</div>
        <div class="pf-row">
          <button class="pf-pill${state.type==='all'?' active':''}" data-pf-type="all">🏠 All</button>
          <button class="pf-pill${state.type==='house_trade'?' active':''}" data-pf-type="house_trade">🔄 For Trade</button>
          <button class="pf-pill${state.type==='looking_for'?' active':''}" data-pf-type="looking_for">👀 Looking For</button>
        </div>
      </div>`);
    }

    // Build + glitch
    if (showBuild) {
      parts.push(`<div class="pf-section">
        <div class="pf-label">Build type</div>
        <div class="pf-row">
          <button class="pf-pill${state.build==='all'?' active':''}" data-pf-build="all">✨ All</button>
          <button class="pf-pill${state.build==='original'?' active':''}" data-pf-build="original">⭐ Original</button>
          <button class="pf-pill${state.build==='speedbuild'?' active':''}" data-pf-build="speedbuild">⚡ Speedbuild</button>
          <button class="pf-pill${state.build==='cloned'?' active':''}" data-pf-build="cloned">◈ Cloned</button>
          <div class="pf-divider"></div>
          <button class="pf-glitch${state.glitch?' active':''}" id="pf-glitch-btn"><span class="pf-glitch-dot"></span>🌀 Glitch only</button>
        </div>
        <div class="pf-glitch-hint" id="pf-glitch-hint">Combine with Original or Cloned to narrow further</div>
      </div>`);
    }

    // Theme
    if (showTheme && themes.length) {
      const allThemePills = [
        `<button class="pf-pill${state.theme==='all'?' active':''}" data-pf-theme="all">All themes</button>`,
        ...visibleThemes.map(t => `<button class="pf-pill${state.theme===t.val?' active':''}" data-pf-theme="${t.val}">${THEME_EMOJI[t.val]||''} ${t.label}</button>`),
        ...extraThemes.map(t => `<button class="pf-pill${state.theme===t.val?' active':''}" data-pf-theme="${t.val}" data-pf-hidden="1" style="display:${themeExpanded||state.theme===t.val?'inline-flex':'none'}">${THEME_EMOJI[t.val]||''} ${t.label}</button>`),
      ];
      const extraCount = extraThemes.length;
      parts.push(`<div class="pf-section">
        <div class="pf-label">Theme</div>
        <div class="pf-row" id="pf-theme-row">
          ${allThemePills.join('')}
          ${extraCount > 0 ? `<button class="pf-more" id="pf-more-btn">${themeExpanded?'− Show less':`+ ${extraCount} more`}</button>` : ''}
        </div>
      </div>`);
    }

    // Bottom row
    const bottomParts = [];
    if (showSearch) bottomParts.push(`<input class="pf-search" id="pf-search" placeholder="Search listings..." value="${state.search}">`);
    bottomParts.push(`<button class="pf-clear" id="pf-clear">✕ Clear all</button>`);
    parts.push(`<div class="pf-bottom">${bottomParts.join('')}</div>`);

    return parts.join('');
  }

  function render() {
    container.innerHTML = `<div class="pf-wrap">${html()}</div>`;
    bind();
    updateActiveBar();
  }

  function updateActiveBar() {
    const bar = container.querySelector('#pf-active-bar');
    if (!bar) return;
    const chips = [];
    const TYPE_LABELS = { house_trade: '🔄 For Trade', looking_for: '👀 Looking For' };
    const BUILD_LABELS = { original: '⭐ Original', speedbuild: '⚡ Speedbuild', cloned: '◈ Cloned' };
    if (state.type !== 'all')  chips.push({ label: TYPE_LABELS[state.type],  key: 'type' });
    if (state.build !== 'all') chips.push({ label: BUILD_LABELS[state.build], key: 'build' });
    if (state.glitch)          chips.push({ label: '🌀 Glitch only', key: 'glitch', cls: 'glitch' });
    if (state.theme !== 'all') {
      const t = themes.find(t => t.val === state.theme);
      if (t) chips.push({ label: `${THEME_EMOJI[t.val]||''} ${t.label}`, key: 'theme' });
    }
    bar.innerHTML = chips.map(c =>
      `<span class="pf-chip${c.cls?' '+c.cls:''}">
        ${c.label}
        <button data-pf-remove="${c.key}" aria-label="Remove filter">✕</button>
      </span>`
    ).join('');
  }

  function bind() {
    // Sort
    container.querySelectorAll('[data-pf-sort]').forEach(btn => {
      btn.addEventListener('click', () => { state.sort = btn.dataset.pfSort; render(); onChange({...state}); });
    });
    // Type
    container.querySelectorAll('[data-pf-type]').forEach(btn => {
      btn.addEventListener('click', () => { state.type = btn.dataset.pfType; render(); onChange({...state}); });
    });
    // Build
    container.querySelectorAll('[data-pf-build]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.build = btn.dataset.pfBuild;
        // Speedbuild can't be glitch
        if (state.glitch && state.build === 'speedbuild') state.glitch = false;
        render(); onChange({...state});
      });
    });
    // Glitch
    const glitchBtn = container.querySelector('#pf-glitch-btn');
    if (glitchBtn) {
      glitchBtn.addEventListener('click', () => {
        state.glitch = !state.glitch;
        if (state.glitch && state.build === 'speedbuild') state.build = 'all';
        render(); onChange({...state});
      });
    }
    // Theme
    container.querySelectorAll('[data-pf-theme]').forEach(btn => {
      btn.addEventListener('click', () => { state.theme = btn.dataset.pfTheme; render(); onChange({...state}); });
    });
    // More themes
    const moreBtn = container.querySelector('#pf-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        themeExpanded = !themeExpanded;
        if (!themeExpanded && hiddenThemeVals.includes(state.theme)) {
          state.theme = 'all';
        }
        render(); onChange({...state});
      });
    }
    // Search
    const searchEl = container.querySelector('#pf-search');
    if (searchEl) {
      searchEl.addEventListener('input', e => { state.search = e.target.value.toLowerCase(); onChange({...state}); });
    }
    // Remove chips
    container.querySelectorAll('[data-pf-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.pfRemove;
        if (k === 'glitch') state.glitch = false;
        else if (k === 'type') state.type = 'all';
        else if (k === 'build') state.build = 'all';
        else if (k === 'theme') state.theme = 'all';
        render(); onChange({...state});
      });
    });
    // Clear
    container.querySelector('#pf-clear')?.addEventListener('click', () => {
      state.type = 'all'; state.build = 'all'; state.glitch = false;
      state.theme = 'all'; state.search = ''; themeExpanded = false;
      render(); onChange({...state});
    });
  }

  render();
  return {
    getState: () => ({...state}),
    reset: () => {
      state.type='all'; state.build='all'; state.glitch=false;
      state.theme='all'; state.search=''; themeExpanded=false;
      render(); onChange({...state});
    },
    setThemes: (newThemes) => { opts.themes = newThemes; Object.assign(opts, {themes: newThemes}); themes.length=0; themes.push(...newThemes); render(); },
  };
}
