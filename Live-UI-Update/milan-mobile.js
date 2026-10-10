/* MILAN V7.2 — Premium mobile navigation drawer (hamburger + Logout).
 * Self-contained: builds its own overlay drawer and forwards clicks to the
 * page's REAL menu buttons + #logoutBtn, so nothing existing is renamed or broken.
 * Activates only on the post-login app surface and only on small screens.
 */
(function () {
  "use strict";
  if (window.__milanMobileNav) return;
  window.__milanMobileNav = true;

  var isApp = /\/app(\.html)?$/.test(location.pathname);
  if (!isApp) return;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  ready(init);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function init() {
    // Hamburger — bottom-LEFT FAB (right side already has the action dock; no overlap)
    var burger = document.createElement("button");
    burger.id = "milan-burger";
    burger.type = "button";
    burger.setAttribute("aria-label", "Open menu");
    burger.innerHTML = "☰";
    document.body.appendChild(burger);

    var overlay = document.createElement("div");
    overlay.id = "milan-drawer-ov";
    var drawer = document.createElement("aside");
    drawer.id = "milan-drawer";
    drawer.setAttribute("aria-label", "Navigation menu");
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function realMenuButtons() {
      return Array.prototype.slice.call(
        document.querySelectorAll(".leftRail .menu button, .card.menu button, .menu button")
      );
    }

    function build() {
      var nameEl = document.querySelector(
        "#profileName, #userName, .profileCard h3, .profileName, .leftRail .profileCard b"
      );
      var name = (nameEl && nameEl.textContent ? nameEl.textContent : "Your account").trim().slice(0, 40);

      var btns = realMenuButtons();
      var seen = {}, navHtml = "";
      btns.forEach(function (b) {
        var t = (b.textContent || "").trim();
        if (!t || seen[t]) return;
        seen[t] = 1;
        navHtml += '<button class="md-item" data-fwd="1">' + esc(t) + "</button>";
      });
      if (!navHtml) {
        // Fallback nav if the in-page menu isn't found
        navHtml =
          '<a class="md-item" href="/app">🏠 Home Feed</a>' +
          '<a class="md-item" href="/app">📝 My Posts</a>';
      }

      drawer.innerHTML =
        '<div class="md-head"><span class="md-brand">MILAN</span>' +
          '<button class="md-close" type="button" aria-label="Close menu">×</button></div>' +
        '<div class="md-user">👤 ' + esc(name) + "</div>" +
        '<div class="md-sec">Navigate</div>' +
        navHtml +
        '<div class="md-sec">More</div>' +
        '<a class="md-item" href="/music">🎵 Music</a>' +
        '<a class="md-item" href="/settings">⚙️ Settings</a>' +
        '<a class="md-item" href="/about">ℹ️ About</a>' +
        '<button class="md-logout" id="milan-drawer-logout" type="button">⎋ Log out</button>';

      // Forward in-app nav clicks to the real buttons (keeps all existing handlers)
      var byText = {};
      btns.forEach(function (b) { byText[(b.textContent || "").trim()] = b; });
      drawer.querySelectorAll('.md-item[data-fwd="1"]').forEach(function (it) {
        it.addEventListener("click", function () {
          var real = byText[it.textContent.trim()];
          closeDrawer();
          if (real) setTimeout(function () { real.click(); }, 120);
        });
      });
      drawer.querySelectorAll("a.md-item").forEach(function (a) {
        a.addEventListener("click", closeDrawer);
      });
      drawer.querySelector(".md-close").addEventListener("click", closeDrawer);
      drawer.querySelector("#milan-drawer-logout").addEventListener("click", function () {
        var lb = document.getElementById("logoutBtn");
        if (lb) { lb.click(); return; }
        try { localStorage.removeItem("milanToken"); localStorage.removeItem("rememberedEmail"); } catch (e) {}
        location.href = "/";
      });
    }

    function openDrawer() { build(); document.body.classList.add("milan-drawer-open"); }
    function closeDrawer() { document.body.classList.remove("milan-drawer-open"); }

    burger.addEventListener("click", openDrawer);
    overlay.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
  }
})();
