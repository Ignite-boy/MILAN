/* ============================================================================
   MILAN — App Pro interactions  (v1)
   ----------------------------------------------------------------------------
   Pairs with /milan-app-pro.css. Presentation only.

   HARD RULES
   • Never preventDefault / stopPropagation on app controls. Navigation,
     publishing, uploads, refresh and the control centre stay owned by their
     own modules.
   • Never read or write tokens, post text, or form state.
   • Never replace a button's textContent — only prepend decorative spans.
   • Every feature degrades silently if its target is absent.
   ========================================================================== */
"use strict";

(function () {
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  /* ══════════════════════════════════════════════════════════════════════
     1. Background — aurora + faint grid. Deliberately lighter than the
        login page: no starfield canvas, because this page is content-heavy.
     ══════════════════════════════════════════════════════════════════════ */
  function buildBackground() {
    if ($("#map-bg")) return;

    var bg = document.createElement("div");
    bg.id = "map-bg";
    bg.setAttribute("aria-hidden", "true");

    ["a", "b", "c"].forEach(function (k) {
      var b = document.createElement("div");
      b.className = "map-blob map-blob--" + k;
      bg.appendChild(b);
    });

    var grid = document.createElement("div");
    grid.className = "map-grid";
    bg.appendChild(grid);

    document.body.insertBefore(bg, document.body.firstChild);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. Quick stats — count up on first paint, bump when the value changes.
        The numbers are written by app.html's own sync loop, so we only
        observe; we never write the value ourselves.
     ══════════════════════════════════════════════════════════════════════ */
  var STAT_IDS = ["uiPeopleCount", "uiPostCount", "uiPrivacyScore"];

  function bindQuickStats() {
    var seen = {};
    var last = {};

    function numeric(text) {
      var n = parseInt(String(text).replace(/[^\d-]/g, ""), 10);
      return isFinite(n) ? n : null;
    }

    function countUp(el, from, to) {
      var start = null;
      var dur = 620;

      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        // easeOutCubic
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(from + (to - from) * e));
        if (t < 1) window.requestAnimationFrame(step);
        else el.textContent = String(to);
      }

      window.requestAnimationFrame(step);
    }

    function bump(card) {
      if (!card || reduceMotion) return;
      card.classList.remove("is-bump");
      void card.offsetWidth;
      card.classList.add("is-bump");
      window.setTimeout(function () { card.classList.remove("is-bump"); }, 420);
    }

    function check() {
      STAT_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var text = (el.textContent || "").trim();
        if (text === last[id]) return;

        var value = numeric(text);
        var card = el.closest ? el.closest(".quickStat") : null;

        if (!seen[id]) {
          seen[id] = true;
          if (value !== null && !reduceMotion && value > 0 && value < 10000) {
            countUp(el, 0, value);
          }
        } else {
          bump(card);
        }
        last[id] = text;
      });
    }

    check();
    // the intro block is injected on DOMContentLoaded by app.html's own script
    window.setTimeout(check, 300);
    window.setTimeout(check, 1200);
    window.setInterval(check, 1500);
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. Publish — ripple + magnetic hover, mirroring the login CTA.
        No handler touches the click itself.
     ══════════════════════════════════════════════════════════════════════ */
  function bindPublish() {
    var btn = document.getElementById("publishBtn");
    if (!btn) return;

    on(btn, "pointerdown", function (e) {
      if (btn.disabled || reduceMotion) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var dot = document.createElement("span");
      dot.className = "map-ripple";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(dot);
      window.setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 700);
    });

    if (reduceMotion) return;

    on(btn, "pointermove", function (e) {
      if (btn.disabled) return;
      var r = btn.getBoundingClientRect();
      if (!r.width) return;
      var dx = ((e.clientX - r.left) / r.width - 0.5) * 7;
      var dy = ((e.clientY - r.top) / r.height - 0.5) * 5;
      btn.style.transform =
        "translate3d(" + dx.toFixed(2) + "px," + (dy - 2).toFixed(2) + "px,0)";
    }, { passive: true });

    on(btn, "pointerleave", function () { btn.style.transform = ""; });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. Refresh — spin the button while the list refreshes. Purely visual
        feedback; the click itself is left completely alone.
     ══════════════════════════════════════════════════════════════════════ */
  function bindRefresh() {
    var btn = document.getElementById("milanFeedRefresh");
    var list = document.getElementById("milanFeedList");
    if (!btn) return;

    var timer = null;

    function spin(ms) {
      if (reduceMotion) return;
      btn.classList.add("is-spinning");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        btn.classList.remove("is-spinning");
      }, ms || 700);
    }

    on(btn, "click", function () { spin(900); });

    // if the feed re-renders shortly after, stop early
    if (list && window.MutationObserver) {
      new window.MutationObserver(function () {
        if (btn.classList.contains("is-spinning")) spin(320);
      }).observe(list, { childList: true });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. Feed — a one-time staggered entrance. Deliberately first-render only:
        the app refreshes the feed on a timer, and re-animating on every
        refresh would be noise.
     ══════════════════════════════════════════════════════════════════════ */
  function bindFeedEntrance() {
    var list = document.getElementById("milanFeedList");
    if (!list) return;

    var done = false;

    function mark() {
      if (done || reduceMotion) return;
      var kids = Array.prototype.filter.call(list.children, function (el) {
        return el.nodeType === 1;
      });
      if (!kids.length) return;
      done = true;
      kids.forEach(function (el, i) {
        el.style.animationDelay = Math.min(i * 45, 400) + "ms";
        el.setAttribute("data-map-reveal", "1");
      });
    }

    mark();
    window.setTimeout(mark, 900);
    window.setTimeout(mark, 2200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     boot
     ══════════════════════════════════════════════════════════════════════ */
  function init() {
    try { buildBackground(); } catch (e) {}
    try { bindQuickStats(); } catch (e) {}
    try { bindPublish(); } catch (e) {}
    try { bindRefresh(); } catch (e) {}
    try { bindFeedEntrance(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
