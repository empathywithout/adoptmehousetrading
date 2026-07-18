// pill-filters.js
// Mounts the pill-based filter UI with multi-select theme search.
//
// Usage: mountPillFilters(container, options)
// options = {
//   type, build, theme, sort, search: bool
//   themes: [{val, label}]
//   sorts:  [{val, label}]
//   onChange: fn(state) — state.themes is a Set of selected theme vals
// }
// Returns { getState, reset }

const THEME_EMOJI = {
  cutecore:'🌸',coquette:'🎀',cottagecore:'🌿',cozy:'🕯️',fairycore:'🧚',gothic:'🦇',
  fantasy:'🧙',royal:'👑',cutegoth:'🖤',cottagegoth:'🌑',nature:'🌲',garden:'🌷',
  japanese:'⛩️',modern:'🏙️',minimalist:'◻️',medieval:'🏰',dark_academia:'📚',
  victorian:'🕰️',vintage:'📻',beach:'🏖️',tropical:'🌺',farmhouse:'🚜',autumn:'🍂',
  winter_cabin:'❄️',spring:'🌼',horror:'💀',holiday_seasonal:'🎄',realism:'🎨',
  custom_theme:'🎲',
};

const CSS = `
.pf-wrap{margin-bottom:18px;}
.pf-active-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}
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
.pf-theme-search-wrap{position:relative;}
.pf-theme-input{width:100%;padding:9px 34px 9px 14px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font-size:14px;font-family:inherit;outline:none;transition:border-color .12s;}
.pf-theme-input:focus{border-color:var(--accent);}
.pf-theme-input::placeholder{color:var(--muted);}
.pf-theme-clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;line-height:1;padding:2px;display:none;}
.pf-theme-clear:hover{color:var(--ink);}
.pf-theme-results{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:0;}
.pf-theme-result{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:999px;border:1.5px solid var(--line);background:var(--surface);color:var(--muted);font-size:13px;cursor:pointer;white-space:nowrap;user-select:none;line-height:1;font-family:inherit;transition:all .12s;}
.pf-theme-result:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft);}
.pf-theme-result.already{border-color:var(--accent);color:var(--accent);background:var(--accent-soft);opacity:0.5;cursor:default;pointer-events:none;}
.pf-theme-none{font-size:13px;color:var(--muted);padding:6px 2px;}
.pf-bottom{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px;}
.pf-clear{font-size:12px;color:var(--muted);background:none;border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer;font-family:inherit;}
.pf-clear:hover{color:var(--ink);border-color:var(--ink-soft);}
.pf-search{padding:7px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13.5px;min-width:160px;flex:1;max-width:240px;font-family:inherit;}
.pf-search:focus{outline:none;border-color:var(--accent);}
`;

export function mountPillFilters(container, opts = {}) {
  const {
    type:   showType   = false,
    build:  showBuild  = false,
    theme:  showTheme  = false,
    sort:   showSort   = false,
    search: showSearch = false,
    themes = [],
    sorts  = [],
    onChange = () => {},
  } = opts;

  if (!document.getElementById('pf-styles')) {
    const s = document.createElement('style');
    s.id = 'pf-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const state = {
    type: 'all', build: 'all', glitch: false,
    themes: new Set(),
    sort: sorts[0]?.val || 'recent',
    search: '',
  };
  let themeQuery = '';

  // ── HTML skeleton ──────────────────────────────────────────
  function html() {
    const parts = [];

    parts.push(`<div class="pf-active-bar" id="pf-active-bar"></div>`);

    if (showSort && sorts.length) {
      parts.push(`<div class="pf-section">
        <div class="pf-row" id="pf-sort-row">
          ${sorts.map(s => `<button class="pf-pill${state.sort===s.val?' active':''}" data-pf-sort="${s.val}">${s.label}</button>`).join('')}
        </div>
      </div>`);
    }

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
        <div class="pf-glitch-hint" id="pf-glitch-hint"${state.glitch?'':' style="display:none"'}>Combine with Original or Cloned to narrow further</div>
      </div>`);
    }

    if (showTheme) {
      parts.push(`<div class="pf-section">
        <div class="pf-label">Theme</div>
        <div class="pf-theme-search-wrap">
          <input class="pf-theme-input" id="pf-theme-input" placeholder="Search themes… try cozy, gothic, beach" autocomplete="off" value="${themeQuery}">
          <button class="pf-theme-clear" id="pf-theme-clear" style="display:${themeQuery?'block':'none'}">×</button>
        </div>
        <div class="pf-theme-results" id="pf-theme-results"></div>
      </div>`);
    }

    const bottomParts = [];
    if (showSearch) bottomParts.push(`<input class="pf-search" id="pf-search" placeholder="Search listings..." value="${state.search}">`);
    bottomParts.push(`<button class="pf-clear" id="pf-clear">✕ Clear all</button>`);
    parts.push(`<div class="pf-bottom">${bottomParts.join('')}</div>`);

    return parts.join('');
  }

  function renderThemeResults() {
    const resultsEl = container.querySelector('#pf-theme-results');
    if (!resultsEl) return;
    const q = themeQuery.toLowerCase().trim();
    if (!q) { resultsEl.innerHTML = ''; return; }
    const matches = themes.filter(t =>
      t.label.toLowerCase().includes(q) || t.val.includes(q)
    );
    if (!matches.length) {
      resultsEl.innerHTML = `<span class="pf-theme-none">No themes match "${q}"</span>`;
      return;
    }
    resultsEl.innerHTML = matches.map(t => {
      const already = state.themes.has(t.val);
      return `<button class="pf-theme-result${already?' already':''}" data-pf-theme-pick="${t.val}">${THEME_EMOJI[t.val]||''} ${t.label}${already?' ✓':''}</button>`;
    }).join('');
    resultsEl.querySelectorAll('[data-pf-theme-pick]:not(.already)').forEach(btn => {
      btn.addEventListener('click', () => {
        state.themes.add(btn.dataset.pfThemePick);
        themeQuery = '';
        const inp = container.querySelector('#pf-theme-input');
        const clr = container.querySelector('#pf-theme-clear');
        if (inp) inp.value = '';
        if (clr) clr.style.display = 'none';
        resultsEl.innerHTML = '';
        updateActiveBar();
        onChange(exportState());
      });
    });
  }

  function updateActiveBar() {
    const bar = container.querySelector('#pf-active-bar');
    if (!bar) return;
    const chips = [];
    const TYPE_L  = { house_trade:'🔄 For Trade', looking_for:'👀 Looking For' };
    const BUILD_L = { original:'⭐ Original', speedbuild:'⚡ Speedbuild', cloned:'◈ Cloned' };
    if (state.type !== 'all')  chips.push({ label: TYPE_L[state.type],   key: 'type' });
    if (state.build !== 'all') chips.push({ label: BUILD_L[state.build], key: 'build' });
    if (state.glitch)          chips.push({ label: '🌀 Glitch only',     key: 'glitch', cls: 'glitch' });
    state.themes.forEach(v => {
      const t = themes.find(t => t.val === v);
      if (t) chips.push({ label: `${THEME_EMOJI[v]||''} ${t.label}`, key: `theme:${v}` });
    });
    bar.innerHTML = chips.map(c =>
      `<span class="pf-chip${c.cls?' '+c.cls:''}">${c.label}<button data-pf-remove="${c.key}" aria-label="Remove filter">✕</button></span>`
    ).join('');
    bar.querySelectorAll('[data-pf-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.pfRemove;
        if (k === 'glitch') {
          state.glitch = false;
          container.querySelector('#pf-glitch-btn')?.classList.remove('active');
          const hint = container.querySelector('#pf-glitch-hint');
          if (hint) hint.style.display = 'none';
        } else if (k === 'type') {
          state.type = 'all';
          container.querySelectorAll('[data-pf-type]').forEach(p => p.classList.remove('active'));
          container.querySelector('[data-pf-type="all"]')?.classList.add('active');
        } else if (k === 'build') {
          state.build = 'all';
          container.querySelectorAll('[data-pf-build]').forEach(p => p.classList.remove('active'));
          container.querySelector('[data-pf-build="all"]')?.classList.add('active');
        } else if (k.startsWith('theme:')) {
          state.themes.delete(k.slice(6));
          renderThemeResults();
        }
        updateActiveBar();
        onChange(exportState());
      });
    });
  }

  function exportState() {
    return { ...state, themes: new Set(state.themes) };
  }

  function render() {
    container.innerHTML = `<div class="pf-wrap">${html()}</div>`;
    bind();
    renderThemeResults();
    updateActiveBar();
  }

  function bind() {
    container.querySelectorAll('[data-pf-sort]').forEach(btn => {
      btn.addEventListener('click', () => { state.sort = btn.dataset.pfSort; render(); onChange(exportState()); });
    });
    container.querySelectorAll('[data-pf-type]').forEach(btn => {
      btn.addEventListener('click', () => { state.type = btn.dataset.pfType; render(); onChange(exportState()); });
    });
    container.querySelectorAll('[data-pf-build]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.build = btn.dataset.pfBuild;
        if (state.glitch && state.build === 'speedbuild') state.glitch = false;
        render(); onChange(exportState());
      });
    });
    container.querySelector('#pf-glitch-btn')?.addEventListener('click', () => {
      state.glitch = !state.glitch;
      if (state.glitch && state.build === 'speedbuild') state.build = 'all';
      render(); onChange(exportState());
    });

    // Theme search
    const themeInput = container.querySelector('#pf-theme-input');
    const themeClear = container.querySelector('#pf-theme-clear');
    themeInput?.addEventListener('input', () => {
      themeQuery = themeInput.value;
      if (themeClear) themeClear.style.display = themeQuery ? 'block' : 'none';
      renderThemeResults();
    });
    themeClear?.addEventListener('click', () => {
      themeQuery = ''; themeInput.value = '';
      themeClear.style.display = 'none';
      renderThemeResults();
    });

    container.querySelector('#pf-search')?.addEventListener('input', e => {
      state.search = e.target.value.toLowerCase(); onChange(exportState());
    });
    container.querySelector('#pf-clear')?.addEventListener('click', () => {
      state.type='all'; state.build='all'; state.glitch=false;
      state.themes.clear(); state.search=''; themeQuery='';
      render(); onChange(exportState());
    });
  }

  render();

  return {
    getState: () => exportState(),
    reset: () => {
      state.type='all'; state.build='all'; state.glitch=false;
      state.themes.clear(); state.search=''; themeQuery='';
      render(); onChange(exportState());
    },
  };
}
