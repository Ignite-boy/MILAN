/* ═══════════════════════════════════════════════════════════════
   MILAN — Geo India Module (White-Hat SEO, 2026)
   One URL for the whole country. No doorway pages, no cloaking:
   Googlebot and humans see the same page; this script only adds a
   client-side personalization layer (progressive enhancement).
   - Detects the visitor's city (with permission) via browser
     geolocation + reverse geocoding, or lets them pick/type it.
   - Works for EVERY city/town in India: the built-in list (857
     cities, all 36 states & UTs) powers autocomplete, and any
     detected or typed city is accepted too.
   - Remembers the choice in localStorage.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_KEY = 'milan_geo_city';
  var mount = null;

  function cities() {
    return (window.MILAN_INDIA_CITIES || []).map(function (s) {
      var i = s.lastIndexOf('|');
      return { city: s.slice(0, i), state: s.slice(i + 1) };
    });
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function save(c) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function setBadge(c) {
    var el = document.getElementById('milan-geo-badge');
    if (!el) return;
    if (c && c.city) {
      el.innerHTML = '📍 MILAN is live in <strong>' + esc(c.city) +
        (c.state ? ', ' + esc(c.state) : '') +
        '</strong> — and every other city in India. ' +
        '<button type="button" id="milan-geo-change" class="milan-geo-link">Change</button>';
      var btn = document.getElementById('milan-geo-change');
      if (btn) btn.addEventListener('click', function () {
        var inp = document.getElementById('milan-geo-search');
        if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    } else {
      el.innerHTML = '📍 MILAN works in <strong>every city & town in India</strong> — from metros to villages. Find yours below.';
    }
  }

  function detect() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      var u = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
        pos.coords.latitude + '&longitude=' + pos.coords.longitude + '&localityLanguage=en';
      fetch(u).then(function (r) { return r.json(); }).then(function (d) {
        var c = {
          city: d.city || d.locality || '',
          state: d.principalSubdivision || ''
        };
        if (c.city) { save(c); setBadge(c); }
      }).catch(function () {});
    }, function () {}, { timeout: 8000, maximumAge: 3600000 });
  }

  function renderResults(q) {
    var box = document.getElementById('milan-geo-results');
    if (!box) return;
    q = (q || '').trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var list = cities().filter(function (c) {
      return c.city.toLowerCase().indexOf(q) === 0 ||
             c.city.toLowerCase().indexOf(q) > -1;
    }).slice(0, 12);
    var html = list.map(function (c) {
      return '<button type="button" class="milan-geo-item" data-city="' + esc(c.city) +
        '" data-state="' + esc(c.state) + '">' + esc(c.city) +
        ' <span>' + esc(c.state) + '</span></button>';
    }).join('');
    // Any city is valid — offer the typed value too
    var exact = list.some(function (c) { return c.city.toLowerCase() === q; });
    if (!exact && q.length > 2) {
      html += '<button type="button" class="milan-geo-item" data-city="' + esc(q.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); })) +
        '" data-state="">Use "' + esc(q) + '" <span>your city</span></button>';
    }
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.milan-geo-item'), function (b) {
      b.addEventListener('click', function () {
        var c = { city: b.getAttribute('data-city'), state: b.getAttribute('data-state') };
        save(c); setBadge(c);
        box.innerHTML = '';
        var inp = document.getElementById('milan-geo-search');
        if (inp) inp.value = '';
      });
    });
  }

  function enhance() {
    mount = document.getElementById('milan-india');
    if (!mount) return;

    var ui = document.createElement('div');
    ui.className = 'milan-geo-ui';
    ui.innerHTML =
      '<p id="milan-geo-badge" class="milan-geo-badge" aria-live="polite"></p>' +
      '<div class="milan-geo-controls">' +
        '<input type="search" id="milan-geo-search" placeholder="Search your city… (e.g. Jaipur, Kochi, Guwahati)" ' +
          'aria-label="Search your city in India" autocomplete="off">' +
        '<button type="button" id="milan-geo-detect" class="milan-geo-btn">📍 Auto-detect my city</button>' +
      '</div>' +
      '<div id="milan-geo-results" class="milan-geo-results" role="listbox" aria-label="City suggestions"></div>';
    var anchor = document.getElementById('milan-india-enhance');
    (anchor || mount).appendChild(ui);

    setBadge(saved());
    var inp = document.getElementById('milan-geo-search');
    if (inp) {
      var t = null;
      inp.addEventListener('input', function () {   // debounced → good INP
        clearTimeout(t);
        t = setTimeout(function () { renderResults(inp.value); }, 120);
      });
    }
    var det = document.getElementById('milan-geo-detect');
    if (det) det.addEventListener('click', detect);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
})();
