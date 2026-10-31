/* MILAN V8.1 — Mobile navigation DOM placement.
 * Desktop keeps its normal sidebar. Mobile Chrome gets one top-right hamburger
 * and the existing navigation buttons are moved into that drawer.
 */
(function () {
  "use strict";
  if (window.__milanMobileNavV81) return;
  window.__milanMobileNavV81 = true;

  if (!/\/app(\.html)?$/.test(location.pathname)) return;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var topbar = document.querySelector(".topbar");
    var sidebar = document.querySelector(".sidebar");
    var nav = sidebar && sidebar.querySelector(".nav");
    var profileBlock = sidebar && sidebar.querySelector(".profile");
    if (!topbar || !sidebar || !nav || !profileBlock) return;

    var mq = window.matchMedia("(max-width:768px)");
    var originalParent = nav.parentNode;
    var originalNext = nav.nextSibling;
    var mobileMoved = false;
    var profileMoved = false;

    var style = document.createElement("style");
    style.id = "milan-mobile-nav-v81-style";
    style.textContent = `
      #milan-burger-v81,#milan-drawer-v81,#milan-drawer-ov-v81{display:none!important}
      @media (max-width:768px){
        .topbar{position:sticky!important;top:0!important;min-height:calc(60px + env(safe-area-inset-top))!important;padding:calc(8px + env(safe-area-inset-top)) 58px 8px 12px!important;z-index:3000!important}
        .topbar .search,.topbar .top-actions{display:none!important}
        .topbar .brand{min-width:0!important;flex:1 1 auto!important}
        .topbar .brand-text span{display:none!important}
        .sidebar{display:none!important}
        #milan-burger-v81{display:grid!important;position:absolute!important;right:10px!important;top:50%!important;transform:translateY(-50%)!important;width:42px!important;height:42px!important;place-items:center!important;padding:0!important;margin:0!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:12px!important;background:#121b2f!important;color:#fff!important;font:700 21px/1 system-ui,sans-serif!important;z-index:3010!important;cursor:pointer!important}
        #milan-drawer-ov-v81{position:fixed!important;inset:0!important;background:rgba(0,0,0,.68)!important;opacity:0!important;visibility:hidden!important;transition:opacity .18s ease,visibility .18s ease!important;z-index:4000!important}
        #milan-drawer-v81{position:fixed!important;top:0!important;right:0!important;bottom:0!important;width:min(88vw,360px)!important;display:flex!important;flex-direction:column!important;overflow:auto!important;box-sizing:border-box!important;padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))!important;background:#091226!important;border-left:1px solid #263652!important;transform:translateX(105%)!important;transition:transform .22s ease!important;z-index:4010!important;box-shadow:-20px 0 50px rgba(0,0,0,.5)!important}
        body.milan-mobile-menu-open #milan-drawer-v81{transform:translateX(0)!important}
        body.milan-mobile-menu-open #milan-drawer-ov-v81{opacity:1!important;visibility:visible!important}
        body.milan-mobile-menu-open{overflow:hidden!important}
        #milan-drawer-v81 .m8-head{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:2px 0 14px!important}
        #milan-drawer-v81 .m8-title{font-size:20px!important;font-weight:800!important;color:#fff!important}
        #milan-drawer-v81 .m8-sub{display:block!important;margin-top:2px!important;font-size:11px!important;color:#7f8fad!important}
        #milan-drawer-v81 .m8-close{width:40px!important;height:40px!important;padding:0!important;border:1px solid #263652!important;border-radius:12px!important;background:#121d33!important;color:#fff!important;font-size:24px!important;cursor:pointer!important}
        #milan-drawer-v81 .m8-mobile-profile{display:block!important;width:auto!important;margin:0 0 14px!important;padding:12px 13px!important;box-sizing:border-box!important;border-radius:14px!important;background:#101b31!important;color:#cdd7ea!important;text-align:center!important}
        #milan-drawer-v81 .m8-mobile-profile .milan-avatar-upload{display:inline-block!important}
        #milan-drawer-v81 .m8-mobile-profile #myAvatar{margin:0 auto!important}
        #milan-drawer-v81 .m8-mobile-profile .profile-stats{display:flex!important;justify-content:space-around!important;margin-top:12px!important;padding-top:12px!important}
        #milan-drawer-v81 .m8-section{margin:0 0 8px!important;color:#7383a3!important;font:800 11px/1 system-ui,sans-serif!important;letter-spacing:.08em!important;text-transform:uppercase!important}
        #milan-drawer-v81 .m8-nav{display:flex!important;flex-direction:column!important;gap:5px!important}
        #milan-drawer-v81 .m8-nav button{width:100%!important;min-height:46px!important;margin:0!important;padding:11px 14px!important;border:1px solid transparent!important;border-radius:12px!important;background:#111c31!important;color:#dce5f5!important;text-align:left!important;font:600 14px/1.25 system-ui,sans-serif!important;cursor:pointer!important}
        #milan-drawer-v81 .m8-nav button.active{background:linear-gradient(90deg,rgba(91,124,250,.2),rgba(91,124,250,.08))!important;border-color:rgba(91,124,250,.3)!important;color:#fff!important}
        #milan-drawer-v81 .m8-nav button.accent{background:linear-gradient(135deg,#6366f1,#8b5cf6)!important;color:#fff!important}
        #milan-drawer-v81 .m8-logout{width:100%!important;min-height:46px!important;margin-top:18px!important;padding:11px 14px!important;border:1px solid #4a2029!important;border-radius:12px!important;background:#25151a!important;color:#fda4af!important;text-align:left!important;font:600 14px/1.25 system-ui,sans-serif!important;cursor:pointer!important}
      }
    `;
    document.head.appendChild(style);

    var burger = document.createElement("button");
    burger.id = "milan-burger-v81";
    burger.type = "button";
    burger.setAttribute("aria-label", "Open navigation");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "milan-drawer-v81");
    burger.textContent = "☰";
    topbar.appendChild(burger);

    var overlay = document.createElement("div");
    overlay.id = "milan-drawer-ov-v81";
    document.body.appendChild(overlay);

    var drawer = document.createElement("aside");
    drawer.id = "milan-drawer-v81";
    drawer.setAttribute("aria-label", "MILAN navigation");
    drawer.setAttribute("aria-hidden", "true");
    drawer.inert = true;
    document.body.appendChild(drawer);

    var head = document.createElement("div");
    head.className = "m8-head";
    head.innerHTML = '<div><div class="m8-title">MILAN</div><span class="m8-sub">Your space</span></div>';
    var close = document.createElement("button");
    close.className = "m8-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close navigation");
    close.textContent = "×";
    head.appendChild(close);
    drawer.appendChild(head);

    var profileMount = document.createElement("div");
    profileMount.className = "m8-profile-mount";
    drawer.appendChild(profileMount);

    var section = document.createElement("div");
    section.className = "m8-section";
    section.textContent = "Navigate";
    drawer.appendChild(section);

    var mobileNav = document.createElement("nav");
    mobileNav.className = "m8-nav";
    mobileNav.setAttribute("aria-label", "Primary navigation");
    drawer.appendChild(mobileNav);

    function moveToDrawer() {
      if (mobileMoved) return;
      if (!profileMoved) {
        profileBlock.classList.add("m8-mobile-profile");
        profileMount.appendChild(profileBlock);
        profileMoved = true;
      }
      while (nav.firstChild) mobileNav.appendChild(nav.firstChild);
      nav.remove();
      mobileMoved = true;
      sidebar.style.display = "none";
    }

    function restoreDesktop() {
      if (!mobileMoved) return;
      originalParent.insertBefore(nav, originalNext);
      while (mobileNav.firstChild) nav.appendChild(mobileNav.firstChild);
      if (profileMoved) {
        profileBlock.classList.remove("m8-mobile-profile");
        sidebar.insertBefore(profileBlock, sidebar.firstChild);
        profileMoved = false;
      }
      mobileMoved = false;
      sidebar.style.display = "";
      closeMenu();
    }

    function syncLayout() {
      if (mq.matches) moveToDrawer();
      else restoreDesktop();
    }

    function openMenu() {
      if (!mq.matches) return;
      drawer.inert = false;
      drawer.setAttribute("aria-hidden", "false");
      document.body.classList.add("milan-mobile-menu-open");
      burger.setAttribute("aria-expanded", "true");
      close.focus();
    }

    function closeMenu() {
      var wasOpen = document.body.classList.contains("milan-mobile-menu-open");
      document.body.classList.remove("milan-mobile-menu-open");
      drawer.setAttribute("aria-hidden", "true");
      drawer.inert = true;
      burger.setAttribute("aria-expanded", "false");
      if (wasOpen && mq.matches) burger.focus();
    }

    var more = document.createElement("div");
    more.className = "m8-section";
    more.style.marginTop = "18px";
    more.textContent = "More";
    drawer.appendChild(more);

    var extras = document.createElement("div");
    extras.innerHTML = '<a href="#" id="milan-dashboard-link">📊 Dashboard</a><a href="/music">🎵 Music</a><a href="/settings">⚙️ Settings</a><a href="/about">ℹ️ About</a>';
    extras.style.cssText = "display:flex;flex-direction:column;gap:5px";
    extras.querySelectorAll("a").forEach(function (a) {
      a.style.cssText = "display:flex;align-items:center;min-height:46px;padding:11px 14px;box-sizing:border-box;border:1px solid transparent;border-radius:12px;background:#111c31;color:#dce5f5;text-decoration:none;font:600 14px/1.25 system-ui,sans-serif";
      a.addEventListener("click", closeMenu);
    });

    drawer.appendChild(extras);

    // Personal Dashboard — served as part of the existing PostgreSQL web service.
    // All data comes from the signed-in user's existing authenticated APIs.
    var dashboardStyle = document.createElement("style");
    dashboardStyle.id = "milan-dashboard-style";
    dashboardStyle.textContent =
      "#milan-dashboard{display:none;position:fixed;inset:0;z-index:5000;overflow:auto;padding:clamp(12px,3vw,28px);background:rgba(3,7,18,.92);backdrop-filter:blur(12px);color:#e8eef9;box-sizing:border-box}" +
      "#milan-dashboard *{box-sizing:border-box}" +
      "#milan-dashboard .mvd-shell{max-width:1120px;margin:0 auto;padding-bottom:30px}" +
      "#milan-dashboard .mvd-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 20px}" +
      "#milan-dashboard .mvd-title{font-size:clamp(26px,4vw,38px);font-weight:850;letter-spacing:-.035em;margin:5px 0}" +
      "#milan-dashboard .mvd-sub{font-size:12px;color:#96a7c3;line-height:1.6}" +
      "#milan-dashboard .mvd-btn{border:1px solid #344864;border-radius:11px;background:#14233b;color:#edf3ff;padding:10px 13px;font-weight:750;cursor:pointer}" +
      "#milan-dashboard .mvd-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}" +
      "#milan-dashboard .mvd-card{min-width:0;border:1px solid #273a58;border-radius:16px;padding:16px;background:linear-gradient(145deg,#14233c,#0b172c)}" +
      "#milan-dashboard .mvd-label{font-size:12px;color:#9cacc6;font-weight:700}" +
      "#milan-dashboard .mvd-value{font-size:clamp(25px,3vw,33px);font-weight:850;margin:8px 0 4px;color:#fff}" +
      "#milan-dashboard .mvd-note{font-size:11px;line-height:1.5;color:#8294b1}" +
      "#milan-dashboard .mvd-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:14px}" +
      "#milan-dashboard .mvd-section{font-size:16px;font-weight:800;margin:0 0 6px}" +
      "#milan-dashboard .mvd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-top:1px solid rgba(145,164,197,.14)}" +
      "#milan-dashboard .mvd-row:first-child{border-top:0}" +
      "#milan-dashboard .mvd-main{min-width:0;overflow-wrap:anywhere}" +
      "#milan-dashboard .mvd-row-title{font-size:13px;font-weight:750;color:#edf3ff;overflow-wrap:anywhere}" +
      "#milan-dashboard .mvd-meta{font-size:11px;color:#8da0bd;line-height:1.6;margin-top:4px;overflow-wrap:anywhere}" +
      "#milan-dashboard .mvd-tag{display:inline-block;font-size:10px;border:1px solid #344966;border-radius:99px;padding:3px 8px;margin-top:5px;color:#bfcde4}" +
      "#milan-dashboard .mvd-copy{flex-shrink:0;border:1px solid #344966;border-radius:8px;background:#13243d;color:#dce8fc;padding:7px 9px;font-size:11px;cursor:pointer}" +
      "#milan-dashboard .mvd-empty{font-size:13px;line-height:1.7;color:#96a7c3;padding:18px 0}" +
      "#milan-dashboard .mvd-status{font-size:12px;color:#98b0ff;min-height:19px}" +
      "@media(max-width:720px){#milan-dashboard .mvd-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#milan-dashboard .mvd-grid{grid-template-columns:1fr}#milan-dashboard .mvd-card{padding:13px}#milan-dashboard .mvd-top{align-items:flex-start}}" +
      "@media(max-width:390px){#milan-dashboard .mvd-btn{padding:9px 10px}}";
    document.head.appendChild(dashboardStyle);

    var dashboard = document.createElement("div");
    dashboard.id = "milan-dashboard";
    dashboard.setAttribute("aria-hidden", "true");
    dashboard.innerHTML =
      '<div class="mvd-shell" role="dialog" aria-modal="true" aria-labelledby="mvdTitle">' +
        '<div class="mvd-top"><div><div class="mvd-sub">MILAN · WEB5 SPACE</div><h1 class="mvd-title" id="mvdTitle">Your Dashboard</h1><div class="mvd-sub">Your records, uploads and account activity in one place.</div></div>' +
        '<button type="button" class="mvd-btn" id="mvdClose">✕ Close</button></div>' +
        '<div class="mvd-status" id="mvdStatus" role="status" aria-live="polite">Ready</div>' +
        '<div class="mvd-metrics" id="mvdMetrics"></div>' +
        '<div class="mvd-grid">' +
          '<section class="mvd-card"><h2 class="mvd-section">🗂️ Your records</h2><div class="mvd-sub">Your authenticated account records only.</div><div id="mvdRecords"><div class="mvd-empty">Loading records…</div></div></section>' +
          '<section class="mvd-card"><h2 class="mvd-section">🕘 Recent activity</h2><div class="mvd-sub">Recent events for your account.</div><div id="mvdActivity"><div class="mvd-empty">Loading activity…</div></div></section>' +
        '</div>' +
        '<div class="mvd-card" style="margin-top:14px"><h2 class="mvd-section">Privacy by default</h2><div class="mvd-sub">This dashboard requests records and activity using your existing authenticated session. It does not request other users’ private records. Archive/restore controls are not shown until a real backend workflow exists.</div><div style="margin-top:14px"><button type="button" class="mvd-btn" id="mvdRefresh">↻ Refresh dashboard</button></div></div>' +
      '</div>';
    document.body.appendChild(dashboard);

    function mvdEsc(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }
    function mvdDate(value) {
      if (!value) return "Date unavailable";
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
    }
    function mvdAction(action) {
      var labels = {
        "record.created.in.dwn": "Record created",
        "record.updated.in.dwn": "Record updated",
        "record.deleted.from.dwn": "Record deleted",
        "record.permissions.updated.in.dwn": "Record permissions changed",
        "record.shared.from.dwn": "Record shared",
        "media.record.chunked.to.dwn": "Media upload completed",
        "media.record.streamed.to.dwn": "Media upload completed",
        "records.imported.to.dwn": "Records imported",
        "profile.updated": "Profile updated",
        "settings.account_updated": "Account settings updated",
        "settings.privacy_updated": "Privacy settings updated",
        "settings.password_changed": "Password changed"
      };
      var key = String(action || "");
      return labels[key] || key.replace(/[._]+/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || "Account activity";
    }
    async function mvdGet(path) {
      var token = "";
      try { token = String(localStorage.getItem("milan_token") || "").trim(); } catch (_) {}
      if (!token) throw new Error("Please sign in to view your dashboard.");
      var response = await fetch("/api" + path, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json", Authorization: "Bearer " + token }
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.error || ("Request failed (" + response.status + ")"));
        error.status = response.status;
        throw error;
      }
      return data;
    }
    function mvdMetric(label, value, note) {
      return '<div class="mvd-card"><div class="mvd-label">' + mvdEsc(label) +
        '</div><div class="mvd-value">' + mvdEsc(value) +
        '</div><div class="mvd-note">' + mvdEsc(note) + '</div></div>';
    }
    function mvdRenderRecords(records) {
      var target = document.getElementById("mvdRecords");
      if (!records.length) {
        target.innerHTML = '<div class="mvd-empty">No records returned for your account yet.</div>';
        return;
      }
      target.innerHTML = records.slice(0, 12).map(function (record) {
        var id = String(record.id || record.dwnRecordId || "");
        var mode = String(record.accessMode || (record.published ? "public" : "private"));
        return '<div class="mvd-row"><div class="mvd-main"><div class="mvd-row-title">' +
          mvdEsc(record.title || record.schema || "Untitled record") + '</div><div class="mvd-meta">' +
          mvdEsc(record.dataFormat || "Record") + ' · ' +
          mvdEsc(mvdDate(record.dateModified || record.dateCreated)) +
          '</div><span class="mvd-tag">' + mvdEsc(mode.replace(/_/g, " ")) +
          '</span></div><button type="button" class="mvd-copy" data-mvd-copy="' +
          mvdEsc(id) + '">Copy ID</button></div>';
      }).join("");
    }
    function mvdRenderActivity(items) {
      var target = document.getElementById("mvdActivity");
      if (!items.length) {
        target.innerHTML = '<div class="mvd-empty">No account activity has been recorded yet.</div>';
        return;
      }
      target.innerHTML = items.slice(0, 12).map(function (item) {
        return '<div class="mvd-row"><div class="mvd-main"><div class="mvd-row-title">' +
          mvdEsc(mvdAction(item.action)) + '</div><div class="mvd-meta">' +
          mvdEsc(mvdDate(item.at)) + '</div></div></div>';
      }).join("");
    }
    async function mvdRefresh() {
      var status = document.getElementById("mvdStatus");
      status.textContent = "Loading your records and activity…";
      var results = await Promise.allSettled([
        mvdGet("/records?dbPage=1&limit=100"),
        mvdGet("/records/stats"),
        mvdGet("/activity")
      ]);
      var records = results[0].status === "fulfilled" && Array.isArray(results[0].value) ? results[0].value : [];
      var stats = results[1].status === "fulfilled" ? results[1].value : {};
      var activity = results[2].status === "fulfilled" && Array.isArray(results[2].value) ? results[2].value : [];
      var failed = results.filter(function (item) { return item.status === "rejected"; });
      var uploads = activity.filter(function (item) {
        return /media\.record\.(chunked|streamed)\.to\.dwn/.test(String(item.action || ""));
      }).length;
      var total = Number.isFinite(Number(stats.total)) ? Number(stats.total) : records.length;
      var priv = Number.isFinite(Number(stats.private)) ? Number(stats.private) : 0;
      var pub = Number.isFinite(Number(stats.public)) ? Number(stats.public) : 0;
      document.getElementById("mvdMetrics").innerHTML = [
        mvdMetric("Your records", total, "Reported by your records API"),
        mvdMetric("Private records", priv, "Visible only to you"),
        mvdMetric("Public records", pub, "Records marked public"),
        mvdMetric("Recent media uploads", uploads, "Within returned activity history")
      ].join("");
      mvdRenderRecords(records);
      mvdRenderActivity(activity);
      status.textContent = failed.length
        ? "Some dashboard data could not be loaded. Refresh to retry."
        : "Updated " + mvdDate(new Date().toISOString());
    }
    function mvdOpen() {
      dashboard.style.display = "block";
      dashboard.setAttribute("aria-hidden", "false");
      mvdRefresh().catch(function () {
        document.getElementById("mvdStatus").textContent = "Could not load dashboard. Please try refresh.";
      });
    }
    function mvdClose() {
      dashboard.style.display = "none";
      dashboard.setAttribute("aria-hidden", "true");
    }
    var dashboardLink = document.getElementById("milan-dashboard-link");
    if (dashboardLink) dashboardLink.addEventListener("click", function (event) {
      event.preventDefault();
      closeMenu();
      mvdOpen();
    });
    document.getElementById("mvdClose").addEventListener("click", mvdClose);
    document.getElementById("mvdRefresh").addEventListener("click", function () {
      mvdRefresh().catch(function () {
        document.getElementById("mvdStatus").textContent = "Refresh failed. Please try again.";
      });
    });
    dashboard.addEventListener("click", function (event) {
      if (event.target === dashboard) mvdClose();
      var copyButton = event.target.closest("[data-mvd-copy]");
      if (!copyButton) return;
      var value = copyButton.getAttribute("data-mvd-copy") || "";
      if (!value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () {
          document.getElementById("mvdStatus").textContent = "Record ID copied.";
        }).catch(function () { window.prompt("Copy record ID", value); });
      } else window.prompt("Copy record ID", value);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && dashboard.style.display === "block") mvdClose();
    });


    var logout = document.createElement("button");
    logout.className = "m8-logout";
    logout.type = "button";
    logout.textContent = "⎋ Log out";
    drawer.appendChild(logout);

    burger.addEventListener("click", function () {
      document.body.classList.contains("milan-mobile-menu-open") ? closeMenu() : openMenu();
    });
    close.addEventListener("click", closeMenu);
    overlay.addEventListener("click", closeMenu);
    mobileNav.addEventListener("click", function () { setTimeout(closeMenu, 60); });
    logout.addEventListener("click", function () {
      var lb = document.getElementById("logoutBtn");
      if (lb) lb.click();
      else location.href = "/";
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (document.body.classList.contains("milan-mobile-menu-open")) closeMenu();
        return;
      }

      if (e.key !== "Tab" ||
          !document.body.classList.contains("milan-mobile-menu-open")) return;

      var focusable = Array.from(drawer.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (el) {
        var style = window.getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        return !el.hidden && style.display !== "none" &&
          style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });

      if (!focusable.length) {
        e.preventDefault();
        close.focus();
        return;
      }

      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;

      if (e.shiftKey && (active === first || !drawer.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawer.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    });

    if (mq.addEventListener) mq.addEventListener("change", syncLayout);
    else if (mq.addListener) mq.addListener(syncLayout);
    syncLayout();
  });
})();
