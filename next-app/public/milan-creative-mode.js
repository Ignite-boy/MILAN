/*!
 * MILAN — Creative Mode 🎨
 * One-click full-UI theme switcher. 12 hand-tuned themes.
 * Pure frontend, zero dependencies. Persists in localStorage.
 * Works on the login page (index.html) and the app (app.html).
 */
(function () {
  'use strict';
  if (window.__milanCreativeMode) return;            // guard against double-load
  window.__milanCreativeMode = true;

  var KEY = 'milan_creative_theme';

  /* ── 10 THEMES ─────────────────────────────────────────────────
   * Each theme re-points the whole UI: page background, surfaces,
   * text, lines, brand gradient and buttons.
   * ------------------------------------------------------------- */
  var THEMES = [
    { id: 'krishna', name: 'Krishna Night', emoji: '🪈', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(20,100,184,.30),transparent 50%),radial-gradient(ellipse at 80% 10%,rgba(217,70,239,.22),transparent 42%),radial-gradient(ellipse at 50% 100%,rgba(245,158,11,.12),transparent 55%),#050e2b',
      surface: '#0a1a3e', surface2: '#0d2150', text: '#f0e6ff', muted: '#8ba4d4', line: 'rgba(245,158,11,.18)',
      brand: '#f59e0b', brand2: '#d946ef', btn: '#030920', input: 'rgba(5,14,43,.85)' },

    { id: 'aurora', name: 'Aurora', emoji: '🌌', light: false,
      bg: 'radial-gradient(ellipse at 15% 0,rgba(34,211,238,.25),transparent 45%),radial-gradient(ellipse at 85% 15%,rgba(168,85,247,.25),transparent 45%),radial-gradient(ellipse at 50% 100%,rgba(16,185,129,.18),transparent 55%),#040a16',
      surface: '#0a1626', surface2: '#0e1f33', text: '#e6f7ff', muted: '#7fa6c4', line: 'rgba(34,211,238,.18)',
      brand: '#22d3ee', brand2: '#a855f7', btn: '#02121a', input: 'rgba(4,12,22,.85)' },

    { id: 'sunset', name: 'Sunset', emoji: '🌇', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(251,146,60,.30),transparent 45%),radial-gradient(ellipse at 80% 20%,rgba(244,63,94,.26),transparent 45%),radial-gradient(ellipse at 50% 100%,rgba(168,85,247,.16),transparent 55%),#1a0e1a',
      surface: '#241320', surface2: '#2e1828', text: '#ffeede', muted: '#c79bae', line: 'rgba(251,146,60,.20)',
      brand: '#fb923c', brand2: '#f43f5e', btn: '#1a0a12', input: 'rgba(26,14,26,.85)' },

    { id: 'cyber', name: 'Cyberpunk', emoji: '🤖', light: false,
      bg: 'radial-gradient(ellipse at 10% 0,rgba(255,43,214,.22),transparent 42%),radial-gradient(ellipse at 90% 10%,rgba(0,229,255,.22),transparent 42%),radial-gradient(ellipse at 50% 100%,rgba(124,58,237,.16),transparent 55%),#07070d',
      surface: '#0f0f1a', surface2: '#15152a', text: '#eafcff', muted: '#7d7da8', line: 'rgba(255,43,214,.22)',
      brand: '#ff2bd6', brand2: '#00e5ff', btn: '#07070d', input: 'rgba(7,7,13,.9)' },

    { id: 'forest', name: 'Forest', emoji: '🌲', light: false,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(52,211,153,.24),transparent 45%),radial-gradient(ellipse at 82% 12%,rgba(163,230,53,.18),transparent 45%),#06140e',
      surface: '#0a1d14', surface2: '#0e261a', text: '#e7fff2', muted: '#80b59c', line: 'rgba(52,211,153,.18)',
      brand: '#34d399', brand2: '#a3e635', btn: '#04130c', input: 'rgba(6,20,14,.85)' },

    { id: 'royal', name: 'Royal Purple', emoji: '👑', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(167,139,250,.28),transparent 45%),radial-gradient(ellipse at 80% 15%,rgba(240,171,252,.22),transparent 45%),#120a26',
      surface: '#1b1136', surface2: '#231546', text: '#f3ebff', muted: '#a896cf', line: 'rgba(167,139,250,.22)',
      brand: '#a78bfa', brand2: '#f0abfc', btn: '#0e0820', input: 'rgba(18,10,38,.85)' },

    { id: 'ocean', name: 'Ocean', emoji: '🌊', light: false,
      bg: 'radial-gradient(ellipse at 15% 0,rgba(56,189,248,.26),transparent 46%),radial-gradient(ellipse at 85% 12%,rgba(45,212,191,.20),transparent 46%),#05182e',
      surface: '#0a2138', surface2: '#0e2a47', text: '#e3f6ff', muted: '#7eaecb', line: 'rgba(56,189,248,.20)',
      brand: '#38bdf8', brand2: '#2dd4bf', btn: '#03101f', input: 'rgba(5,24,46,.85)' },

    { id: 'mono', name: 'Midnight AMOLED', emoji: '🖤', light: false,
      bg: '#000000',
      surface: '#0b0b0b', surface2: '#141414', text: '#f5f5f5', muted: '#8a8a8a', line: 'rgba(255,255,255,.12)',
      brand: '#ffffff', brand2: '#9ca3af', btn: '#000000', input: '#0d0d0d' },

    { id: 'rosegold', name: 'Rose Gold', emoji: '🌹', light: true,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(232,180,184,.40),transparent 50%),radial-gradient(ellipse at 80% 10%,rgba(201,162,39,.18),transparent 45%),#fff7f4',
      surface: '#ffffff', surface2: '#fdeee9', text: '#4a3438', muted: '#9c8388', line: 'rgba(201,162,39,.28)',
      brand: '#e08a90', brand2: '#c9a227', btn: '#ffffff', input: '#fff7f4' },

    { id: 'sakura', name: 'Sakura', emoji: '🌸', light: true,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(249,168,212,.40),transparent 50%),radial-gradient(ellipse at 82% 12%,rgba(251,113,133,.20),transparent 45%),#fff2f7',
      surface: '#ffffff', surface2: '#ffe9f1', text: '#4a2c3a', muted: '#a6788a', line: 'rgba(251,113,133,.28)',
      brand: '#f472b6', brand2: '#fb7185', btn: '#ffffff', input: '#fff2f7' },
    
    { id: 'emerald', name: 'Emerald', emoji: '💚', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(16,185,129,.25),transparent 48%),radial-gradient(ellipse at 80% 15%,rgba(34,197,94,.20),transparent 45%),#06120d',
      surface: '#0a1c13', surface2: '#0f291c', text: '#ecfff4', muted: '#86b89d', line: 'rgba(16,185,129,.20)',
      brand: '#10b981', brand2: '#22c55e', btn: '#03100a', input: 'rgba(6,18,13,.88)' },

    { id: 'ice', name: 'Ice', emoji: '🧊', light: true,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(125,211,252,.38),transparent 48%),radial-gradient(ellipse at 80% 12%,rgba(167,243,208,.28),transparent 45%),#f2fbff',
      surface: '#ffffff', surface2: '#eaf8ff', text: '#17324d', muted: '#6b879f', line: 'rgba(14,165,233,.22)',
      brand: '#0ea5e9', brand2: '#14b8a6', btn: '#ffffff', input: '#f2fbff' }
,
    
    { id: 'obsidian', name: 'Obsidian Gold', emoji: '🜁', light: false,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(245,158,11,.20),transparent 46%),radial-gradient(ellipse at 82% 10%,rgba(251,191,36,.12),transparent 45%),#080808',
      surface: '#101010', surface2: '#191919', text: '#fff8e7', muted: '#a89b7e', line: 'rgba(245,158,11,.20)',
      brand: '#f59e0b', brand2: '#facc15', btn: '#090909', input: 'rgba(8,8,8,.90)' }
  ];

  function byId(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; }

  /* ── Per-theme override CSS (re-skins the whole UI) ─────────── */
  function themeCss(t) {
    var grad = 'linear-gradient(135deg,' + t.brand + ',' + t.brand2 + ')';
    var S = 'html[data-mcm="' + t.id + '"]';
    return [
      // page
      S + ',' + S + ' body{background:' + t.bg + ' !important;color:' + t.text + ' !important;background-attachment:fixed !important;}',
      // core CSS variables so variable-driven components follow
      S + '{--bg:' + t.bg + ';--card:' + t.surface + ';--card2:' + t.surface2 + ';--text:' + t.text + ';--muted:' + t.muted + ';--line:' + t.line + ';--brand:' + t.brand + ';--brand2:' + t.brand2 + ';}',
      // surfaces
      S + ' .topbar{background:' + t.surface + 'ee !important;border-bottom:1px solid ' + t.line + ' !important;}',
      S + ' .card,' + S + ' .post,' + S + ' .person,' + S + ' .composer,' + S + ' .modal,' + S + ' .bubble,' + S + ' .stat,' + S + ' .authBox,' + S + ' .login-card,' + S + ' .hero-panel,' + S + ' .heroCard,' + S + ' .milan-container{background:' + t.surface + ' !important;border-color:' + t.line + ' !important;color:' + t.text + ' !important;}',
      // text accents / brand wordmark
      S + ' .brand h1,' + S + ' .heroTitle,' + S + ' .logo-center h2,' + S + ' .hero-title{background:' + grad + ' !important;-webkit-background-clip:text !important;background-clip:text !important;color:transparent !important;}',
      S + ' .tag,' + S + ' .muted,' + S + ' .mini,' + S + ' .card-header p{color:' + t.muted + ' !important;}',
      // buttons (primary)
      S + ' button:not(.ghost):not(.soft):not(.mcm-btn):not(.tab):not(.mcm-card):not(.mcm-x):not(.mcm-surprise):not(.mcm-reset),' + S + ' .login-button,' + S + ' #loginBtn,' + S + ' #registerBtn{background:' + grad + ' !important;color:' + t.btn + ' !important;border:0 !important;box-shadow:0 6px 20px ' + t.brand + '44 !important;}',
      // ghost/soft buttons
      S + ' button.ghost{background:transparent !important;color:' + t.brand + ' !important;border:1px solid ' + t.line + ' !important;}',
      // inputs
      S + ' input,' + S + ' textarea,' + S + ' select,' + S + ' .input-field{background:' + t.input + ' !important;border:1px solid ' + t.line + ' !important;color:' + t.text + ' !important;}',
      S + ' input::placeholder,' + S + ' textarea::placeholder{color:' + t.muted + 'aa !important;}',
      // tabs / pills / chips
      S + ' .tab.active,' + S + ' .pill.on,' + S + ' .health,' + S + ' .heroBadge{background:' + t.brand + '22 !important;color:' + t.brand + ' !important;}',
      // avatars / meters
      S + ' .avatar,' + S + ' .privacyMeter span,' + S + ' .privacyMeter i{background:' + grad + ' !important;}',
      // links
      S + ' a{color:' + t.brand + ';}'
    ].join('\n');
  }

  /* ── UI (floating button + panel) CSS ─────────────────────── */
  var UI_CSS = [
    '.mcm-fab{position:fixed;right:18px;bottom:84px;z-index:99998;width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;font-size:21px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.15) inset;transition:transform .2s, box-shadow .2s;}',
    '.mcm-fab:hover{transform:scale(1.08) rotate(8deg);box-shadow:0 14px 40px rgba(217,70,239,.5);}',
    '.mcm-fab:active{transform:scale(.95);}',
    '@media(max-width:780px){.mcm-fab{bottom:134px;right:14px;width:44px;height:44px;font-size:19px;}.mcm-toast{bottom:188px;}}',
    '.mcm-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);display:none;align-items:flex-end;justify-content:center;}',
    '.mcm-overlay.open{display:flex;animation:mcmFade .2s ease;}',
    '@keyframes mcmFade{from{opacity:0}to{opacity:1}}',
    '.mcm-sheet{width:100%;max-width:680px;max-height:86vh;overflow:auto;background:#0c1326;border:1px solid rgba(255,255,255,.12);border-radius:24px 24px 0 0;padding:20px 20px 28px;box-shadow:0 -20px 60px rgba(0,0,0,.5);animation:mcmUp .28s cubic-bezier(.16,.84,.44,1);}',
    '@media(min-width:700px){.mcm-overlay{align-items:center;}.mcm-sheet{border-radius:24px;}}',
    '@keyframes mcmUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}',
    '.mcm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}',
    '.mcm-title{font:800 19px/1.2 Inter,system-ui,sans-serif;color:#fff;letter-spacing:.01em;}',
    '.mcm-sub{font:500 12.5px/1.5 Inter,system-ui,sans-serif;color:#93a0c0;margin:2px 0 16px;}',
    '.mcm-x{background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer;}',
    '.mcm-x:hover{background:rgba(255,255,255,.16);}',
    '.mcm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}',
    '.mcm-card{position:relative;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:0;overflow:hidden;cursor:pointer;background:#0c1326;transition:transform .15s, border-color .15s, box-shadow .15s;text-align:left;}',
    '.mcm-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3);box-shadow:0 10px 26px rgba(0,0,0,.4);}',
    '.mcm-card.active{border-color:#fff;box-shadow:0 0 0 2px #fff inset;}',
    '.mcm-swatch{height:74px;display:flex;align-items:center;justify-content:center;font-size:26px;position:relative;}',
    '.mcm-dots{position:absolute;bottom:8px;left:10px;display:flex;gap:5px;}',
    '.mcm-dot{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.25);}',
    '.mcm-meta{padding:9px 11px 11px;}',
    '.mcm-name{font:700 13px/1.2 Inter,system-ui,sans-serif;color:#fff;}',
    '.mcm-tagline{font:500 11px/1.3 Inter,system-ui,sans-serif;color:#8c99ba;margin-top:2px;}',
    '.mcm-check{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:#fff;color:#111;font-size:14px;display:none;align-items:center;justify-content:center;font-weight:900;}',
    '.mcm-card.active .mcm-check{display:flex;}',
    '.mcm-actions{display:flex;gap:10px;margin-top:16px;}',
    '.mcm-btn{flex:1;border:0;border-radius:13px;padding:12px;font:700 13.5px Inter,system-ui,sans-serif;cursor:pointer;}',
    '.mcm-surprise{background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;}',
    '.mcm-reset{background:rgba(255,255,255,.08);color:#cdd6ee;}',
    '.mcm-toast{position:fixed;left:50%;bottom:88px;transform:translateX(-50%) translateY(20px);z-index:100000;background:#0c1326;color:#fff;border:1px solid rgba(255,255,255,.16);padding:11px 20px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;opacity:0;transition:opacity .25s, transform .25s;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.4);}',
    '.mcm-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
    // smooth full-page transition when switching
    'html.mcm-anim,html.mcm-anim body,html.mcm-anim .card,html.mcm-anim .topbar,html.mcm-anim .post,html.mcm-anim button,html.mcm-anim input{transition:background .45s ease,color .45s ease,border-color .45s ease !important;}'
  ].join('\n');

  /* ── Apply / persist ──────────────────────────────────────── */
  function apply(id, announce) {
    var t = byId(id); if (!t) return;
    document.documentElement.classList.add('mcm-anim');
    document.documentElement.setAttribute('data-mcm', id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t.light ? '#fff2f7' : (t.surface || '#050e2b'));
    } catch (e) {}
    refreshActive();
    if (announce) toast(t.emoji + '  ' + t.name);
    setTimeout(function () { document.documentElement.classList.remove('mcm-anim'); }, 500);
  }

  function refreshActive() {
    var cur = document.documentElement.getAttribute('data-mcm');
    var cards = document.querySelectorAll('.mcm-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('active', cards[i].getAttribute('data-id') === cur);
  }

  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mcm-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  /* ── Build the panel ──────────────────────────────────────── */
  function buildPanel() {
    var overlay = document.createElement('div'); overlay.className = 'mcm-overlay';
    var cards = THEMES.map(function (t) {
      return '<button class="mcm-card" data-id="' + t.id + '">' +
        '<div class="mcm-check">✓</div>' +
        '<div class="mcm-swatch" style="background:' + t.bg + '">' + t.emoji +
        '<div class="mcm-dots">' +
        '<span class="mcm-dot" style="background:' + t.brand + '"></span>' +
        '<span class="mcm-dot" style="background:' + t.brand2 + '"></span>' +
        '<span class="mcm-dot" style="background:' + t.surface + '"></span>' +
        '</div></div>' +
        '<div class="mcm-meta"><div class="mcm-name">' + t.name + '</div>' +
        '<div class="mcm-tagline">' + (t.light ? 'Light' : 'Dark') + ' theme</div></div>' +
        '</button>';
    }).join('');
    overlay.innerHTML =
      '<div class="mcm-sheet" role="dialog" aria-label="Creative Mode themes">' +
        '<div class="mcm-head"><div style="display:flex;align-items:center;gap:9px"><img src="/assets/icon-192.png" alt="MILAN" style="height:26px;width:26px;border-radius:8px"><div class="mcm-title">Creative Mode</div></div>' +
        '<button class="mcm-x" aria-label="Close">✕</button></div>' +
        '<div class="mcm-sub">Customize the entire look your way — change it with one click. ' + THEMES.length + ' themes.</div>' +
        '<div class="mcm-grid">' + cards + '</div>' +
        '<div class="mcm-actions">' +
          '<button class="mcm-btn mcm-surprise">🎲 Surprise me</button>' +
          '<button class="mcm-btn mcm-reset">↺ Default</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function close() { overlay.classList.remove('open'); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.mcm-x').addEventListener('click', close);
    overlay.querySelectorAll('.mcm-card').forEach(function (c) {
      c.addEventListener('click', function () { apply(c.getAttribute('data-id'), true); });
    });
    overlay.querySelector('.mcm-surprise').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-mcm');
      var pick; do { pick = THEMES[Math.floor(Math.random() * THEMES.length)]; } while (THEMES.length > 1 && pick.id === cur);
      apply(pick.id, true);
    });
    overlay.querySelector('.mcm-reset').addEventListener('click', function () { apply('mono', true); });
    return overlay;
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  function injectStyle() {
    var css = UI_CSS + '\n' + THEMES.map(themeCss).join('\n');
    var s = document.createElement('style'); s.id = 'mcm-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  function boot() {
    injectStyle();
    var fab = document.createElement('button');
    fab.className = 'mcm-fab'; fab.title = 'Creative Mode — change the whole look'; fab.innerHTML = '🎨';

  /* MILAN APP — keep the launcher visible above all app layers */
  fab.style.position = 'fixed';
  fab.style.right = '22px';
  fab.style.bottom = '22px';
  fab.style.zIndex = '2147483000';
  fab.style.display = 'grid';
  fab.style.placeItems = 'center';
  fab.style.visibility = 'visible';
  fab.style.opacity = '1';
  fab.style.pointerEvents = 'auto';
    document.body.appendChild(fab);
    var overlay = buildPanel();

    /* MILAN APP — use the existing topbar Theme button as
       the Creative Mode launcher. Keep the floating FAB for
       pages that do not have the app Theme control. */
    var appThemeButton = document.querySelector('.icon-btn[title="Theme"]');

    if (appThemeButton) {
      appThemeButton.title = 'Creative Mode';
      appThemeButton.setAttribute('aria-label', 'Creative Mode');
      appThemeButton.setAttribute('type', 'button');

      appThemeButton.addEventListener('click', function () {
        overlay.classList.add('open');
        refreshActive();
      });

    } else {
      fab.addEventListener('click', function () {
        overlay.classList.add('open');
        refreshActive();
      });
    }
    // keyboard: Shift+T toggles the panel
    document.addEventListener('keydown', function (e) {
      if ((e.shiftKey) && (e.key === 'T' || e.key === 't') && !/input|textarea|select/i.test((e.target.tagName || ''))) {
        e.preventDefault(); overlay.classList.toggle('open'); refreshActive();
      }
    });
    refreshActive();
  }

  // Apply saved theme ASAP (reduce flash), build UI after DOM ready.
  try {
    var saved = localStorage.getItem(KEY);
    if (saved && byId(saved)) document.documentElement.setAttribute('data-mcm', saved);
  } catch (e) {}
  // Boot on both login and app pages.
  // Login may signal app-ready; app.html can also boot
  // directly once DOM is ready.
  var booted = false;

  function safeBoot() {
    if (booted) return;
    booted = true;
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeBoot, {once:true});
  } else {
    safeBoot();
  }

  window.addEventListener('milan:app-ready', safeBoot, {once:true});
})();
