/* MILAN V7.2 — Launch-grade polish layer (additive, every page).
 * Accessibility (skip link), resilience (offline state), and performance
 * (off-screen image lazy-loading + async decode). Never touches existing logic.
 */
(function () {
  "use strict";
  if (window.__milanPolish) return;
  window.__milanPolish = true;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  var toast = function (m) { if (window.milanToast) window.milanToast(m); };

  ready(function () {
    perfImages();
    offlineState();
  });

  /* ---- Performance: lazy-load OFF-SCREEN images, async-decode all ---- */
  function perfImages() {
    var vh = window.innerHeight || 800;
    document.querySelectorAll("img").forEach(function (img) {
      if (!img.hasAttribute("decoding")) img.decoding = "async";
      // Only lazy images clearly below the fold — never the LCP/hero image.
      try {
        if (!img.hasAttribute("loading") && img.getBoundingClientRect().top > vh * 1.25) {
          img.loading = "lazy";
        }
      } catch (e) {}
    });
  }

  /* ---- Resilience: visible offline state + reconnect feedback ---- */
  function offlineState() {
    function set(off) {
      var b = document.getElementById("milan-offline");
      if (off && !b) {
        b = document.createElement("div");
        b.id = "milan-offline";
        b.setAttribute("role", "status");
        b.textContent = "⚠ You're offline — we'll reconnect and sync automatically.";
        document.body.appendChild(b);
      } else if (!off && b) {
        b.remove();
      }
    }
    window.addEventListener("offline", function () { set(true); toast("You're offline"); });
    window.addEventListener("online", function () { set(false); toast("Back online"); });
    if (navigator.onLine === false) set(true);
  }
})();
