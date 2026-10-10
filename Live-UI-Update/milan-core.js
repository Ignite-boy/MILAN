/* MILAN V7.2 — Master interaction layer.
 * Additive only. Loaded on every page. Never renames/removes existing handlers.
 * Provides: toast, dead-link guard, scroll-top FAB, free-music banner,
 * footer nav, service-worker register, install prompt, Esc-closes-modals, share/copy.
 */
(function () {
  "use strict";

  /* ---------------- Toast ---------------- */
  function milanToast(msg, ms) {
    ms = ms || 2200;
    var t = document.getElementById("milan-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "milan-toast";
      t.setAttribute("role", "status");
      t.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0b1437;color:#fff;padding:12px 18px;border-radius:12px;font:14px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.4);z-index:99999;opacity:0;transition:.25s;max-width:90vw;text-align:center";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(function () { t.style.opacity = "1"; });
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, ms);
  }
  window.milanToast = window.milanToast || milanToast;

  /* ---------------- Share / Copy ---------------- */
  window.milanShare = async function (url, title) {
    url = url || location.href;
    title = title || document.title || "MILAN";
    if (navigator.share) {
      try { await navigator.share({ title: title, url: url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); milanToast("Link copied"); }
    catch (e) { milanToast("Couldn't copy link"); }
  };
  window.milanCopy = async function (text) {
    try { await navigator.clipboard.writeText(text); milanToast("Copied"); return true; }
    catch (e) { milanToast("Couldn't copy"); return false; }
  };

  var PAGE = location.pathname.replace(/\/index\.html$/, "/");
  var isHome = PAGE === "/" || /index\.html$/.test(location.pathname);
  var isApp = /\/app(\.html)?$/.test(location.pathname);
  var isMusic = /\/music(\.html)?$/.test(location.pathname);
  var APP_SURFACE = isApp || isMusic ||
    /\/(settings|admin-users|reset-password|verify-email|launch)/.test(location.pathname);

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    // Auth / full-screen login screen: keep it clean — no injected banner/footer/FAB.
    var isAuth = !!document.querySelector(".login-card");
    deadLinkGuard();
    if (!isAuth) scrollTopFab();
    if (!APP_SURFACE && !isAuth) footerNav();
    if ((isHome || isApp) && !isAuth) freeMusicBanner();
    if (isMusic) musicExtras();
    swRegister();
    installPrompt();
    escClosesModals();
  });

  /* ---------------- Dead-link guard ----------------
     Stops a[href="#"] from jumping to top. If the link has no real handler,
     give visible feedback instead of doing nothing. Never blocks existing onclick. */
  function deadLinkGuard() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href="#"], a[href=""]');
      if (!a) return;
      // Let real handlers run, just cancel the hash jump.
      e.preventDefault();
      var hasHandler = a.getAttribute("onclick") || a.dataset.action || a.id || a.getAttribute("href").length > 1;
      if (!hasHandler) {
        var label = (a.textContent || a.getAttribute("aria-label") || "This").trim().slice(0, 40);
        milanToast(label + " — coming soon");
      }
    });
  }

  /* ---------------- Scroll-to-top FAB ---------------- */
  function scrollTopFab() {
    var fab = document.createElement("button");
    fab.id = "milan-fab-top";
    fab.type = "button";
    fab.setAttribute("aria-label", "Scroll to top");
    fab.innerHTML = "↑";
    document.body.appendChild(fab);
    fab.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        fab.classList.toggle("show", window.scrollY > 600);
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------------- Footer nav (crawl depth + consistency) ---------------- */
  function footerNav() {
    if (document.getElementById("milan-footer-nav")) return;
    var links = [
      ["/", "Home"], ["/app", "App"], ["/music", "Music"], ["/about", "About"],
      ["/privacy", "Privacy"], ["/terms", "Terms"], ["/keywords", "Topics"]
    ];
    var f = document.createElement("nav");
    f.id = "milan-footer-nav";
    f.setAttribute("aria-label", "Footer");
    f.innerHTML =
      links.map(function (l) { return '<a href="' + l[0] + '">' + l[1] + "</a>"; }).join("·") +
      '<span class="mfn-copy">© ' + new Date().getFullYear() +
      ' MILAN · Your data, your network — built on Web5.</span>';
    document.body.appendChild(f);
  }

  /* ---------------- Free-music banner ---------------- */
  function freeMusicBanner() {
    if (localStorage.getItem("milan_music_banner_dismissed") === "1") return;
    if (document.getElementById("milan-music-banner")) return;
    var b = document.createElement("div");
    b.id = "milan-music-banner";
    b.innerHTML =

      '<button class="mmb-close" type="button" aria-label="Dismiss">×</button>';
    document.body.insertBefore(b, document.body.firstChild);
    b.querySelector(".mmb-close").addEventListener("click", function () {
      b.remove();
      try { localStorage.setItem("milan_music_banner_dismissed", "1"); } catch (e) {}
    });
  }

  /* ---------------- Music page extras ---------------- */
  function musicExtras() {
    if (!document.querySelector(".milan-backfeed")) {
      var a = document.createElement("a");
      a.className = "milan-backfeed";
      a.href = "/app";
      a.innerHTML = "← Back to Feed";
      a.style.cssText = "position:fixed;left:14px;top:14px;z-index:60";
      document.body.appendChild(a);
    }
  }

  /* ---------------- Service worker ---------------- */
  function swRegister() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  /* ---------------- Install prompt (A2HS) ---------------- */
  function installPrompt() {
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      var btn = document.getElementById("milan-install-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "milan-install-btn";
        btn.type = "button";
        btn.innerHTML = "⬇️ Install MILAN";
        /* Install MILAN button disabled — not added to the DOM. */
        return;
        btn.addEventListener("click", async function () {
          if (!deferred) return;
          deferred.prompt();
          try { await deferred.userChoice; } catch (e) {}
          deferred = null;
          btn.classList.remove("show");
        });
      }
      btn.classList.add("show");
    });
    window.addEventListener("appinstalled", function () {
      var btn = document.getElementById("milan-install-btn");
      if (btn) btn.classList.remove("show");
      milanToast("MILAN installed 🎉");
    });
  }

  /* ---------------- Esc closes modals ---------------- */
  function escClosesModals() {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      ["closeModal", "closeAIModal", "closeAiModal", "closeComposer"].forEach(function (fn) {
        if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
      });
      var b = document.getElementById("milan-music-banner");
      // (don't auto-dismiss banner on Esc; only modals)
    });
  }
})();
