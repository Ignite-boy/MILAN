/* ============================================================================
   MILAN — "More ▾" collapse for the left nav rail.
   Keeps the 5 essential scopes visible; tucks the rest (Edit Profile, Copy DID,
   MILAN AI, Premium…) under a "More ▾" toggle. Fully defensive: if anything is
   unexpected it does nothing, so it can never break the existing menu.
   Moving the buttons preserves their click handlers.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__milanMoreMenu) return;
  window.__milanMoreMenu = true;

  var CSS =
    '.mm-more-btn{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:6px;padding:11px 14px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.04);color:#c2c8de;font-weight:700;font-size:14px;cursor:pointer;transition:background .16s,color .16s}' +
    '.mm-more-btn:hover{background:rgba(255,255,255,.08);color:#f3f4fb}' +
    '.mm-caret{transition:transform .2s ease;font-size:12px;opacity:.8}' +
    '.mm-more-btn.mm-open .mm-caret{transform:rotate(180deg)}' +
    '.mm-extra{display:grid;gap:4px;overflow:hidden;max-height:0;opacity:0;transition:max-height .28s cubic-bezier(.22,1,.36,1),opacity .2s ease,margin .2s ease;margin-top:0}' +
    '.mm-extra.mm-show{max-height:460px;opacity:1;margin-top:4px}';

  function injectCss() {
    if (document.getElementById('mm-style')) return;
    var st = document.createElement('style');
    st.id = 'mm-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function setup() {
    try {
      var menu = document.querySelector('#appView .card.menu') || document.querySelector('.card.menu');
      if (!menu) return false;
      if (menu.querySelector('.mm-more-btn')) return true; // already done

      // Direct child buttons of the menu.
      var children = Array.prototype.slice.call(menu.children).filter(function (n) {
        return n.tagName === 'BUTTON' || (n.classList && n.classList.contains('mp-side-btn'));
      });
      if (children.length < 6) return true; // nothing worth collapsing yet

      // Essential = the scope buttons (Home/Posts/People/Public/Saved).
      var extras = children.filter(function (b) {
        return !b.hasAttribute('data-scope');
      });
      if (extras.length < 2) return true;

      // Build the collapsible container and move the extras into it (keeps
      // their existing event handlers intact).
      var wrap = document.createElement('div');
      wrap.className = 'mm-extra';
      extras.forEach(function (b) { wrap.appendChild(b); });

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mm-more-btn';
      btn.innerHTML = '<span>More</span><span class="mm-caret">▾</span>';
      var open = false;
      btn.addEventListener('click', function () {
        open = !open;
        wrap.classList.toggle('mm-show', open);
        btn.classList.toggle('mm-open', open);
        btn.querySelector('span').textContent = open ? 'Less' : 'More';
      });

      menu.appendChild(btn);
      menu.appendChild(wrap);
      return true;
    } catch (e) {
      return true; // fail-safe: never throw into the app
    }
  }

  // Remove the floating PWA "Install MILAN" button whenever it appears —
  // by id AND by text, so it's caught no matter how it's created.
  function killInstall() {
    try {
      var b = document.getElementById('milan-install-btn');
      if (b) b.remove();
      var nodes = document.querySelectorAll('body > button, body > a, body > div');
      for (var i = 0; i < nodes.length; i++) {
        var t = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (/^[⬇️📲\s]*install milan/i.test(t) && t.length < 30 && nodes[i].children.length <= 2) {
          nodes[i].remove();
        }
      }
    } catch (e) {}
  }

  function boot() {
    injectCss();
    setup();
    killInstall();
    try {
      var obs = new MutationObserver(function () { setup(); killInstall(); });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    var n = 0, iv = setInterval(function () { killInstall(); if (setup() || ++n > 40) clearInterval(iv); }, 600);
  }

  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();
