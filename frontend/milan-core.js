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
    authenticatedAppLinks();
  });

  /* ---------------- Authenticated Open App ---------------- */
  function authenticatedAppLinks() {
    document.addEventListener("click", function (event) {
      const link = event.target.closest && event.target.closest("a");
      if (!link) return;

      const raw = link.getAttribute("href") || "";
      let url;
      try {
        url = new URL(raw, location.href);
      } catch (_) {
        return;
      }

      if (url.origin !== location.origin || !/^\/app\/?$/.test(url.pathname)) {
        return;
      }

      let token = "";
      try {
        token =
          localStorage.getItem("milan_token") ||
          localStorage.getItem("milanToken") ||
          "";
      } catch (_) {}

      event.preventDefault();
      window.location.assign(
        token
          ? "/app.html?entry=" + Date.now()
          : "/index.html"
      );
    });
  }

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

    function isInstalled() {
      return window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        window.navigator.standalone === true;
    }

    function isMobile() {
      return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
        window.matchMedia("(pointer:coarse)").matches;
    }

    function isIOS() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function getButton() {
      var btn = document.getElementById("milan-install-btn");
      if (btn) return btn;

      btn = document.createElement("button");
      btn.id = "milan-install-btn";
      btn.type = "button";
      btn.innerHTML = "⬇️ Install MILAN";
      btn.style.cssText =
        "position:fixed !important;left:50% !important;right:auto !important;" +
        "top:max(12px,env(safe-area-inset-top)) !important;bottom:auto !important;" +
        "z-index:99998 !important;display:none;width:calc(100% - 24px) !important;" +
        "max-width:430px !important;height:auto !important;min-height:0 !important;" +
        "max-height:72px !important;box-sizing:border-box !important;" +
        "padding:13px 17px !important;margin:0 !important;" +
        "border:1px solid rgba(124,58,237,.42) !important;" +
        "border-radius:18px !important;" +
        "background:linear-gradient(135deg,rgba(5,14,43,.98),rgba(18,31,72,.98)) !important;" +
        "color:#fff !important;font-size:15px !important;font-weight:800 !important;" +
        "line-height:1.2 !important;text-align:center !important;" +
        "box-shadow:0 14px 38px rgba(0,0,0,.34),0 0 0 1px rgba(36,93,255,.10) !important;" +
        "backdrop-filter:blur(18px) !important;-webkit-backdrop-filter:blur(18px) !important;" +
        "cursor:pointer !important;appearance:none !important;-webkit-appearance:none !important;" +
        "transform:translate(-50%,-140%) !important;opacity:0 !important;" +
        "transition:transform .42s cubic-bezier(.22,1,.36,1),opacity .3s ease !important;";

      btn.onclick = async function () {
        if (deferred) {
          var promptEvent = deferred;
          deferred = null;
          try {
            promptEvent.prompt();
            await promptEvent.userChoice;
          } catch (_) {}
          hide();
          return;
        }

        if (isIOS()) {
          milanToast("Tap Share ↗ → Add to Home Screen");
          return;
        }

        milanToast("Install is preparing… tap Install MILAN again in a moment.");
      };

      document.body.appendChild(btn);
      return btn;
    }

    function hide() {
      var btn = document.getElementById("milan-install-btn");
      if (btn) btn.style.display = "none";
    }

    function show() {
      if (!isMobile() || isInstalled()) {
        hide();
        return;
      }
      var btn = getButton();
      btn.style.display = "block";
      btn.style.transform = "translate(-50%,-140%)";
      btn.style.opacity = "0";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (btn.style.display !== "none") {
            btn.style.transform = "translate(-50%,0)";
            btn.style.opacity = "1";
          }
        });
      });
    }

    function showIOSInstructions() {
      var btn = getButton();
      btn.textContent = "📲 Add MILAN to Home Screen";
      btn.onclick = function () {
        milanToast("Tap Share ↗ → Add to Home Screen");
      };
      show();
    }

    window.addEventListener("beforeinstallprompt", function (e) {
      if (!isMobile() || isInstalled()) return;

      e.preventDefault();
      deferred = e;

      var btn = getButton();
      btn.textContent = "⬇️ Install MILAN";
      btn.onclick = async function () {
        if (!deferred) return;

        var promptEvent = deferred;
        deferred = null;

        try {
          promptEvent.prompt();
          await promptEvent.userChoice;
        } catch (_) {}

        hide();
      };

      show();
    });

    window.addEventListener("appinstalled", function () {
      deferred = null;
      hide();
      if (typeof milanToast === "function") milanToast("MILAN installed 🎉");
    });

    /* Show the install CTA immediately on mobile when not installed.
       Android/Chrome upgrades it to the native prompt when available. */
    function init() {
      if (!isMobile() || isInstalled()) {
        hide();
        return;
      }

      if (isIOS()) {
        showIOSInstructions();
      } else {
        show();
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }

    window.addEventListener("pageshow", init);
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
