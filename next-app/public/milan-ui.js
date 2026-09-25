/* MILAN V7.2 UI activator — load LAST. Adds the structural bits the mockup
   needs (status stack, avatar menu, System Status card, nav icons) on top of
   the existing markup. Pure presentation/DOM decoration; no app logic changed. */
(function () {
  'use strict';

  document.documentElement.classList.add('milan-v72');

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ---- 1. Top-bar status stack (Cloud DWN / AI / DWN) ----
  function buildStatus() {
    var nav = $('.navlinks');
    if (!nav || $('#milan-v72-status')) return;
    var box = el('div'); box.id = 'milan-v72-status';
    box.innerHTML =
      '<div class="st"><span class="dot"></span>Cloud DWN: <span class="ok">Online</span></div>' +
      '<div class="st"><span class="dot"></span>AI: <span class="ok">Ready</span></div>' +
      '<div class="st"><span class="dot"></span>DWN: <span class="ok">On</span></div>';
    nav.innerHTML = '';
    nav.appendChild(box);
  }

  // ---- 2. Avatar button + dropdown (Usage Stats / Admin / Logout) ----
  function buildUserMenu() {
    var actions = $('.topActions');
    if (!actions || $('#milan-v72-userbtn')) return;

    var name = ($('#myName') && $('#myName').textContent) || 'NP';
    var inits = name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase() || 'NP';

    var btn = el('button'); btn.id = 'milan-v72-userbtn';
    btn.innerHTML = '<span class="av">' + inits + '</span><span>▾</span>';
    actions.appendChild(btn);

    var menu = el('div'); menu.id = 'milan-v72-menu';
    menu.innerHTML =
      '<button data-act="usage">📊 Usage Stats</button>' +
      '<button data-act="admin">⚙️ Admin Panel</button>' +
      '<div class="sep"></div>' +
      '<button data-act="logout">⤴ Logout</button>';
    document.body.appendChild(menu);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });

    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      menu.classList.remove('open');
      var act = b.dataset.act;
      if (act === 'logout') {
        var lo = $('#logoutBtn'); if (lo) lo.click();
      } else if (act === 'usage') {
        var u = $('#milan-usage-btn'); if (u) { u.click(); } else { window.location.href = '/admin-users'; }
      } else if (act === 'admin') {
        window.location.href = '/admin-users';
      }
    });
  }

  // ---- 3. View Profile link under the avatar ----
  function buildViewProfile() {
    var card = $('.leftRail .profileCard');
    if (!card || $('#milan-v72-viewprofile')) return;
    var emailEl = $('#myEmail', card);
    var link = el('a'); link.id = 'milan-v72-viewprofile';
    link.href = 'javascript:void 0'; link.textContent = 'View Profile';
    link.style.cssText = 'display:block;margin-top:6px;';
    link.onclick = function () { var p = $('#profileBtn'); if (p) p.click(); };
    if (emailEl && emailEl.parentNode) emailEl.parentNode.insertBefore(link, emailEl.nextSibling);
    else card.appendChild(link);
  }

  // ---- 4. Nav icons + labels (decorate existing menu buttons) ----
  var ICONS = {
    'feed': '🏠', 'home': '🏠', 'all': '🏠',
    'myfeed': '📡', 'my feed': '📡',
    'explore': '🧭', 'people': '👥', 'groups': '👨‍👩‍👧', 'files': '📄',
    'settings': '⚙️', 'profile': '👤'
  };
  function decorateNav() {
    var btns = document.querySelectorAll('.menu button');
    btns.forEach(function (b) {
      if (b.dataset.v72ico === '1') return;
      b.dataset.v72ico = '1';
      var label = (b.textContent || '').trim().toLowerCase();
      var icon = ICONS[label] || ICONS[label.replace(/\s+/g, '')] || '•';
      // only prepend if it doesn't already start with an emoji
      if (!/^\p{Emoji}/u.test(b.textContent.trim())) {
        b.innerHTML = '<span style="width:22px;display:inline-block;text-align:center">' + icon + '</span>' + b.innerHTML;
      }
    });
  }

  // ---- 5. System Status card from the summary counters ----
  function buildSysStatus() {
    var leftRail = $('.leftRail');
    if (!leftRail || $('#milan-v72-sysstatus')) return;
    function val(id) { var e = document.getElementById(id); return e ? (e.textContent || '0') : '0'; }
    var box = el('div'); box.id = 'milan-v72-sysstatus';
    box.innerHTML =
      '<h4>System Status</h4>' +
      '<div class="row"><span>People:</span><b id="v72-ppl">' + val('peopleCount') + '</b></div>' +
      '<div class="row"><span>Posts:</span><b id="v72-posts">' + val('postCount') + '</b></div>' +
      '<div class="row"><span>Visible Posts:</span><b id="v72-vis">' + val('postCount') + '</b></div>' +
      '<div class="row"><span>Alerts:</span><b id="v72-alerts">' + val('notifCount') + '</b></div>';
    leftRail.appendChild(box);

    // keep it in sync when the app updates its hidden counters
    var sync = function () {
      var m = { 'v72-ppl': 'peopleCount', 'v72-posts': 'postCount', 'v72-vis': 'postCount', 'v72-alerts': 'notifCount' };
      Object.keys(m).forEach(function (k) {
        var t = document.getElementById(k), s = document.getElementById(m[k]);
        if (t && s) t.textContent = s.textContent || '0';
      });
    };
    setInterval(sync, 4000);
  }

  function run() {
    try { buildStatus(); } catch (_) {}
    try { buildUserMenu(); } catch (_) {}
    try { buildViewProfile(); } catch (_) {}
    try { decorateNav(); } catch (_) {}
    try { buildSysStatus(); } catch (_) {}
  }

  // Run now and again after the app boots / renders the shell.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 300); });
  } else {
    setTimeout(run, 300);
  }
  setTimeout(run, 1200);
  setTimeout(run, 2500);

  try { console.log('%c[MILAN V7.2] UI active', 'color:#3b82f6;font-weight:800;'); } catch (_) {}
})();
