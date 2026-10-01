/* ============================================================================
   MILAN — Login Pro interactions  (v1)
   ----------------------------------------------------------------------------
   Pairs with /milan-login-pro.css. Presentation only.

   HARD RULES (do not break these):
   • Never call preventDefault / stopPropagation on the login or register
     buttons. assets/login.js owns authentication completely.
   • Never read, write or clear tokens, passwords or form state.
   • Never replace textContent of a button — only prepend a decorative span.
   • Everything degrades silently: if any target is missing, that feature is
     simply skipped. No exceptions reach the console.
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
  function on(el, ev, fn, opts) {
    if (el) el.addEventListener(ev, fn, opts || false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. Background — aurora blobs, grid, starfield, cursor spotlight
     ══════════════════════════════════════════════════════════════════════ */
  var bg, spot;

  function buildBackground() {
    bg = document.createElement("div");
    bg.id = "mlp-bg";
    bg.setAttribute("aria-hidden", "true");

    ["a", "b", "c"].forEach(function (k) {
      var b = document.createElement("div");
      b.className = "mlp-blob mlp-blob--" + k;
      bg.appendChild(b);
    });

    var grid = document.createElement("div");
    grid.className = "mlp-grid";
    bg.appendChild(grid);

    var canvas = document.createElement("canvas");
    canvas.id = "mlp-stars";
    bg.appendChild(canvas);

    spot = document.createElement("div");
    spot.className = "mlp-spot";
    bg.appendChild(spot);

    document.body.insertBefore(bg, document.body.firstChild);

    if (!reduceMotion) startStarfield(canvas);
  }

  function startStarfield(canvas) {
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var stars = [];
    var pointerX = 0, pointerY = 0;   // -1 .. 1, for parallax
    var px = 0, py = 0;               // eased
    var raf = null;
    var running = true;

    function size() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      var count = Math.round(Math.min(150, Math.max(60, (w * h) / 16000)));
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: 0.25 + Math.random() * 0.75,          // depth → size + parallax
          r: 0.35 + Math.random() * 1.25,
          vx: (Math.random() - 0.5) * 0.09,
          vy: -0.05 - Math.random() * 0.14,
          tw: Math.random() * Math.PI * 2,
          tws: 0.008 + Math.random() * 0.02
        });
      }
    }

    function frame() {
      if (!running) return;
      px += (pointerX - px) * 0.045;
      py += (pointerY - py) * 0.045;

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.x += s.vx;
        s.y += s.vy;
        s.tw += s.tws;

        if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; }
        if (s.x < -4) s.x = w + 4;
        if (s.x > w + 4) s.x = -4;

        var ox = px * 16 * s.z;
        var oy = py * 16 * s.z;
        var alpha = 0.28 + Math.abs(Math.sin(s.tw)) * 0.55;
        var radius = s.r * (0.8 + s.z * 0.5);

        ctx.beginPath();
        ctx.arc(s.x + ox, s.y + oy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(214, 228, 255, " + alpha.toFixed(3) + ")";
        ctx.fill();
      }

      raf = window.requestAnimationFrame(frame);
    }

    on(window, "resize", size);
    on(window, "pointermove", function (e) {
      pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        running = false;
        if (raf) window.cancelAnimationFrame(raf);
        raf = null;
      } else if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    });

    size();
    raf = window.requestAnimationFrame(frame);
  }

  /* ── spotlight sized to the card, so the glass blurs it ────────────────── */
  function bindSpotlight() {
    var card = $(".login-card");
    if (!card || !spot || reduceMotion) return;

    function place() {
      var r = card.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      spot.style.width = r.width + "px";
      spot.style.height = r.height + "px";
      spot.style.transform = "translate3d(" + r.left + "px," + r.top + "px,0)";
    }

    function move(e) {
      var r = card.getBoundingClientRect();
      if (r.width < 2) return;
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      spot.style.setProperty("--mlp-sx", Math.max(0, Math.min(100, x)) + "%");
      spot.style.setProperty("--mlp-sy", Math.max(0, Math.min(100, y)) + "%");
    }

    on(card, "pointerenter", function () {
      place();
      spot.classList.add("is-on");
    });
    on(card, "pointerleave", function () {
      spot.classList.remove("is-on");
    });
    on(card, "pointermove", function (e) {
      move(e);
    }, { passive: true });

    on(window, "resize", place);
    on(window, "scroll", place, { passive: true });

    if (window.ResizeObserver) {
      new window.ResizeObserver(place).observe(card);
    }
    place();
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. Feature cards — cursor sheen + gentle 3D tilt
     ══════════════════════════════════════════════════════════════════════ */
  function bindFeatureCards() {
    if (reduceMotion) return;

    $$(".feature-item").forEach(function (card) {
      on(card, "pointermove", function (e) {
        var r = card.getBoundingClientRect();
        if (!r.width) return;
        var nx = (e.clientX - r.left) / r.width;
        var ny = (e.clientY - r.top) / r.height;

        card.style.setProperty("--mlp-fx", (nx * 100).toFixed(1) + "%");
        card.style.setProperty("--mlp-fy", (ny * 100).toFixed(1) + "%");

        var tiltY = (nx - 0.5) * 5;
        var tiltX = (0.5 - ny) * 4;
        card.style.transform =
          "translate3d(0,-5px,0) perspective(900px) rotateX(" +
          tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg)";
      }, { passive: true });

      on(card, "pointerleave", function () {
        card.style.transform = "";
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. Tabs — sliding pill (geometry is measured, so it survives any
        layout the base stylesheet applies)
     ══════════════════════════════════════════════════════════════════════ */
  function bindTabs() {
    var tabs = $(".tabs");
    if (!tabs) return;

    var pill = document.createElement("span");
    pill.className = "mlp-pill";
    pill.setAttribute("aria-hidden", "true");
    tabs.appendChild(pill);

    function move() {
      var tabsList = $$(".tab", tabs);
      if (!tabsList.length) return;

      var active = null;
      for (var i = 0; i < tabsList.length; i++) {
        if (tabsList[i].classList.contains("active")) { active = tabsList[i]; break; }
      }
      if (!active) active = tabsList[0];

      pill.style.width = active.offsetWidth + "px";
      pill.style.transform = "translateX(" + (active.offsetLeft - 4) + "px)";
    }

    // login.js toggles the .active class → watch it
    if (window.MutationObserver) {
      var mo = new window.MutationObserver(move);
      $$(".tab", tabs).forEach(function (t) {
        mo.observe(t, { attributes: true, attributeFilter: ["class"] });
      });
    }
    $$(".tab", tabs).forEach(function (t) {
      on(t, "click", function () { window.setTimeout(move, 0); });
    });

    on(window, "resize", move);
    if (window.ResizeObserver) new window.ResizeObserver(move).observe(tabs);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(move).catch(function () {});
    }

    move();
    window.setTimeout(move, 60);
    window.setTimeout(move, 400);
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. Auth message → animated, state-aware toast
        login-actions.js signals success/error only through an inline
        style.color, so we read that to pick the visual treatment.
     ══════════════════════════════════════════════════════════════════════ */
  function bindAuthMessage() {
    var el = $("#authMsg");
    if (!el) return;

    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    function sync() {
      var text = (el.textContent || "").trim();
      var colour = (el.style.color || "").toLowerCase();

      if (!text) {
        el.classList.remove("mlp-on", "mlp-flash");
        el.removeAttribute("data-mlp-kind");
        return;
      }

      var kind = "success";
      if (colour.indexOf("e5484d") !== -1 || colour.indexOf("239, 68, 68") !== -1) {
        kind = "error";
      } else if (colour.indexOf("10b981") !== -1 || colour.indexOf("16, 185, 129") !== -1) {
        kind = "success";
      }

      el.setAttribute("data-mlp-kind", kind);
      el.classList.add("mlp-on");

      el.classList.remove("mlp-flash");
      void el.offsetWidth;               // restart the pop animation
      el.classList.add("mlp-flash");
    }

    if (window.MutationObserver) {
      new window.MutationObserver(sync).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"]
      });
    }
    sync();
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. Buttons — ripple, magnetic hover, in-flight spinner
        The spinner is driven by the button's own disabled attribute, so no
        auth code has to know this layer exists.
     ══════════════════════════════════════════════════════════════════════ */
  function bindButton(id) {
    var btn = document.getElementById(id);
    if (!btn) return;

    /* ripple */
    on(btn, "pointerdown", function (e) {
      if (btn.disabled || reduceMotion) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var dot = document.createElement("span");
      dot.className = "mlp-ripple";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(dot);
      window.setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 700);
    });

    /* magnetic hover */
    if (!reduceMotion) {
      on(btn, "pointermove", function (e) {
        if (btn.disabled) return;
        var r = btn.getBoundingClientRect();
        if (!r.width) return;
        var dx = ((e.clientX - r.left) / r.width - 0.5) * 6;
        var dy = ((e.clientY - r.top) / r.height - 0.5) * 4;
        btn.style.setProperty("--mlp-mag", "");
        btn.style.transform =
          "translate3d(" + dx.toFixed(2) + "px," + (dy - 2).toFixed(2) + "px,0)";
      }, { passive: true });

      on(btn, "pointerleave", function () {
        btn.style.transform = "";
      });
    }

    /* loading state */
    function setLoading(on2) {
      var existing = btn.querySelector(".mlp-spinner");
      if (on2) {
        if (existing) return;
        btn.classList.add("is-loading");
        var sp = document.createElement("span");
        sp.className = "mlp-spinner";
        sp.setAttribute("aria-hidden", "true");
        btn.insertBefore(sp, btn.firstChild);
      } else {
        btn.classList.remove("is-loading");
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      }
    }

    if (window.MutationObserver) {
      new window.MutationObserver(function () {
        setLoading(!!btn.disabled);
      }).observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    }
    setLoading(!!btn.disabled);
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. Password strength metre (register form)
        Uses an obvious entropy heuristic — guidance only, never a gate.
     ══════════════════════════════════════════════════════════════════════ */
  function bindStrength() {
    var input = document.getElementById("regPass");
    if (!input) return;

    var group = input.closest(".input-group");
    if (!group) return;

    var wrap = document.createElement("div");
    wrap.className = "mlp-strength";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML =
      '<span class="mlp-strength__track"><span class="mlp-strength__bar"></span></span>' +
      '<span class="mlp-strength__label">—</span>';
    group.appendChild(wrap);

    var bar = wrap.querySelector(".mlp-strength__bar");
    var label = wrap.querySelector(".mlp-strength__label");

    var LEVEL_COLOURS = ["#ef4444", "#ef4444", "#f59e0b", "#84cc16", "#10b981"];
    var LEVEL_NAMES = ["—", "Weak", "Weak", "Fair", "Good", "Strong"];

    function score(v) {
      if (!v) return 0;
      var s = 0;
      if (v.length >= 8) s++;
      if (v.length >= 12) s++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      return Math.min(s, 4);
    }

    on(input, "input", function () {
      var v = input.value || "";
      var s = score(v);

      if (!v) {
        wrap.classList.remove("is-on");
        bar.style.width = "0%";
        label.textContent = "—";
        return;
      }

      wrap.classList.add("is-on");
      var pct = [12, 34, 58, 80, 100][s];
      bar.style.width = pct + "%";
      bar.style.setProperty("--mlp-level-color", LEVEL_COLOURS[s]);
      label.style.color = LEVEL_COLOURS[s];
      label.textContent = LEVEL_NAMES[s + 1] || "Strong";
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. Hero — whisper-quiet parallax
     ══════════════════════════════════════════════════════════════════════ */
  function bindHeroParallax() {
    if (reduceMotion) return;

    var hero = $(".hero-panel");
    var grid = $(".feature-grid", hero || document);
    if (!hero || !grid) return;

    on(hero, "pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      if (!r.width) return;
      var nx = (e.clientX - r.left) / r.width - 0.5;
      var ny = (e.clientY - r.top) / r.height - 0.5;

      // the grid drifts a few pixels against the cursor; individual cards
      // still get their own tilt from bindFeatureCards()
      grid.style.transform =
        "translate3d(" + (-nx * 7).toFixed(2) + "px," +
        (-ny * 5).toFixed(2) + "px,0)";
    }, { passive: true });

    on(hero, "pointerleave", function () {
      grid.style.transform = "";
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     boot
     ══════════════════════════════════════════════════════════════════════ */
  function init() {
    try { buildBackground(); } catch (e) { /* decorative only */ }
    try { bindSpotlight(); } catch (e) {}
    try { bindFeatureCards(); } catch (e) {}
    try { bindTabs(); } catch (e) {}
    try { bindAuthMessage(); } catch (e) {}
    try { bindButton("loginBtn"); } catch (e) {}
    try { bindButton("registerBtn"); } catch (e) {}
    try { bindStrength(); } catch (e) {}
    try { bindHeroParallax(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
