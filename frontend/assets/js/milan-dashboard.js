(function () {
  "use strict";
  if (window.__milanDashboardV1) return;
  window.__milanDashboardV1 = true;

  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  var css = document.createElement("style");
  css.id = "milan-dashboard-v1-style";
  css.textContent = `
    #milanDashboardNavBtn{cursor:pointer}
    #milanDashboardOverlay{display:none;position:fixed;inset:0;z-index:99980;background:rgba(3,7,18,.88);backdrop-filter:blur(12px);overflow:auto;padding:clamp(10px,3vw,30px);box-sizing:border-box;color:#e7edf8}
    #milanDashboardOverlay.is-open{display:block}
    #milanDashboardOverlay *{box-sizing:border-box}
    #milanDashboardOverlay .md-shell{max-width:1180px;margin:0 auto;padding-bottom:28px}
    #milanDashboardOverlay .md-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:8px 0 24px}
    #milanDashboardOverlay .md-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#8da5ff;font-weight:800}
    #milanDashboardOverlay .md-title{font-size:clamp(27px,4vw,40px);font-weight:850;letter-spacing:-.04em;margin:6px 0}
    #milanDashboardOverlay .md-sub{color:#9cabc4;font-size:13px;line-height:1.6}
    #milanDashboardOverlay .md-btn{border:1px solid #33445f;background:#142039;color:#eaf0fc;border-radius:11px;padding:10px 14px;font-weight:750;cursor:pointer}
    #milanDashboardOverlay .md-btn:hover{background:#1d2d4a}
    #milanDashboardOverlay .md-btn-primary{background:#344ce0;border-color:#5268f0;color:#fff}
    #milanDashboardOverlay .md-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    #milanDashboardOverlay .md-card{min-width:0;border:1px solid #253653;border-radius:17px;background:linear-gradient(145deg,rgba(19,33,57,.96),rgba(10,19,36,.96));padding:17px;box-shadow:0 12px 32px rgba(0,0,0,.12)}
    #milanDashboardOverlay .md-metric-label{color:#97a8c4;font-size:12px;font-weight:700}
    #milanDashboardOverlay .md-metric-value{font-size:clamp(25px,3vw,34px);font-weight:850;letter-spacing:-.04em;margin:9px 0 3px;color:#f7f9ff}
    #milanDashboardOverlay .md-metric-note{font-size:11px;color:#8192ae;line-height:1.5}
    #milanDashboardOverlay .md-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:14px}
    #milanDashboardOverlay .md-section-title{font-size:16px;font-weight:800;margin:0 0 5px}
    #milanDashboardOverlay .md-section-sub{color:#8fa0bd;font-size:12px;margin-bottom:15px;line-height:1.5}
    #milanDashboardOverlay .md-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid rgba(132,153,187,.14)}
    #milanDashboardOverlay .md-row:first-child{border-top:0}
    #milanDashboardOverlay .md-row-main{min-width:0;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-row-title{font-size:13px;font-weight:750;color:#eaf0fc;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-meta{font-size:11px;color:#899bb8;line-height:1.6;margin-top:4px;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-tag{display:inline-block;font-size:10px;font-weight:750;border:1px solid #344764;border-radius:99px;padding:3px 8px;color:#bdcbea;white-space:nowrap}
    #milanDashboardOverlay .md-copy{flex-shrink:0;border:1px solid #344764;border-radius:8px;background:#15243c;color:#dbe7ff;padding:7px 9px;font-size:11px;font-weight:700;cursor:pointer}
    #milanDashboardOverlay .md-empty{padding:20px 0;color:#93a4c1;font-size:13px;line-height:1.7}
    #milanDashboardOverlay .md-note{margin-top:14px;padding:13px 15px;border:1px solid #34415a;border-radius:13px;color:#aebbd1;background:rgba(17,28,48,.75);font-size:12px;line-height:1.7}
    #milanDashboardOverlay .md-footer-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}
    #milanDashboardOverlay .md-status{font-size:12px;color:#8fa8ff;min-height:18px;margin-top:10px}
    @media(max-width:760px){#milanDashboardOverlay .md-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#milanDashboardOverlay .md-grid{grid-template-columns:1fr}#milanDashboardOverlay .md-card{padding:14px}#milanDashboardOverlay .md-top{align-items:flex-start}}
    @media(max-width:390px){#milanDashboardOverlay .md-metrics{gap:8px}#milanDashboardOverlay .md-metric-value{font-size:25px}#milanDashboardOverlay .md-btn{padding:9px 10px}}
  `;
  document.head.appendChild(css);

  var overlay = document.createElement("div");
  overlay.id = "milanDashboardOverlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="md-shell" role="dialog" aria-modal="true" aria-labelledby="milanDashTitle">
      <div class="md-top">
        <div>
          <div class="md-eyebrow">MILAN · Web5 space</div>
          <h1 class="md-title" id="milanDashTitle">Your Dashboard</h1>
          <div class="md-sub" id="milanDashWelcome">Your records, uploads and account activity in one place.</div>
        </div>
        <button type="button" class="md-btn" id="milanDashClose" aria-label="Close dashboard">✕ Close</button>
      </div>
      <div id="milanDashStatus" class="md-status" role="status" aria-live="polite">Loading your dashboard…</div>
      <div class="md-metrics" id="milanDashMetrics"></div>
      <div class="md-grid">
        <section class="md-card">
          <h2 class="md-section-title">🗂️ Your records</h2>
          <div class="md-section-sub">Records returned by your authenticated account. Private records belonging to other users are not requested.</div>
          <div id="milanDashRecords"><div class="md-empty">Loading records…</div></div>
        </section>
        <section class="md-card">
          <h2 class="md-section-title">🕘 Recent activity</h2>
          <div class="md-section-sub">Recent events from your account activity history.</div>
          <div id="milanDashActivity"><div class="md-empty">Loading activity…</div></div>
        </section>
      </div>
      <div class="md-note"><strong>Archive and restore:</strong> the current backend does not expose a confirmed archive/restore workflow, so this dashboard does not show simulated archive actions.</div>
      <div class="md-card" style="margin-top:14px">
        <h2 class="md-section-title">⚙️ Account tools</h2>
        <div class="md-section-sub">Open the existing admin console for registered-user overview and administration. It requires a valid admin token; ordinary login is not admin authorization.</div>
        <div class="md-footer-actions">
          <button type="button" class="md-btn" id="milanDashRefresh">↻ Refresh dashboard</button>
          <button type="button" class="md-btn md-btn-primary" id="milanDashAdmin">Open Admin Console ↗</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  var navButton = document.createElement("button");
  navButton.id = "milanDashboardNavBtn";
  navButton.type = "button";
  navButton.textContent = "📊 Dashboard";
  navButton.setAttribute("aria-controls", "milanDashboardOverlay");
  navButton.setAttribute("aria-haspopup", "dialog");

  function addNavButton() {
    if (document.getElementById("milanDashboardNavBtn")) return;
    var nav = document.querySelector("#appView .nav") ||
              document.querySelector(".sidebar .nav") ||
              document.querySelector(".nav");
    if (nav) nav.appendChild(navButton);
  }

  function tokenValue() {
    try { return String(localStorage.getItem("milan_token") || "").trim(); }
    catch (_) { return ""; }
  }

  async function apiGet(path) {
    var token = tokenValue();
    if (!token) throw new Error("Please sign in to load your personal dashboard.");
    var response = await fetch("/api" + path, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json", Authorization: "Bearer " + token }
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error || ("Request failed (" + response.status + ")"));
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function dateLabel(value) {
    if (!value) return "Date unavailable";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
  }

  function actionLabel(action) {
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
      "settings.password_changed": "Password changed",
      "connection.request.sent": "Connection request sent",
      "connection.approved": "Connection approved",
      "protocol.installed": "Protocol installed",
      "auth.email_verified": "Email verified",
      "auth.password_reset_completed": "Password reset completed"
    };
    var key = String(action || "");
    return labels[key] || key.replace(/[._]+/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || "Account activity";
  }

  function metric(label, value, note) {
    return '<div class="md-card"><div class="md-metric-label">' + esc(label) +
      '</div><div class="md-metric-value">' + esc(value) +
      '</div><div class="md-metric-note">' + esc(note) + '</div></div>';
  }

  function renderRecords(records) {
    var target = document.getElementById("milanDashRecords");
    if (!records.length) {
      target.innerHTML = '<div class="md-empty">No records were returned for your account yet. Upload a file or create a record to see it here.</div>';
      return;
    }
    target.innerHTML = records.slice(0, 12).map(function (record) {
      var mode = String(record.accessMode || (record.published ? "public" : "private"));
      var title = record.title || record.schema || "Untitled record";
      var id = String(record.id || record.dwnRecordId || "");
      var type = String(record.dataFormat || "Record");
      return '<div class="md-row"><div class="md-row-main">' +
        '<div class="md-row-title">' + esc(title) + '</div>' +
        '<div class="md-meta">' + esc(type) + ' · ' + esc(dateLabel(record.dateModified || record.dateCreated)) + '</div>' +
        '<div style="margin-top:6px"><span class="md-tag">' + esc(mode.replace(/_/g, " ")) + '</span></div>' +
        '</div><button type="button" class="md-copy" data-copy-id="' + esc(id) + '">Copy ID</button></div>';
    }).join("");
  }

  function renderActivity(items) {
    var target = document.getElementById("milanDashActivity");
    if (!items.length) {
      target.innerHTML = '<div class="md-empty">No activity has been recorded yet. Your future uploads and account actions will appear here.</div>';
      return;
    }
    target.innerHTML = items.slice(0, 12).map(function (item) {
      return '<div class="md-row"><div class="md-row-main">' +
        '<div class="md-row-title">' + esc(actionLabel(item.action)) + '</div>' +
        '<div class="md-meta">' + esc(dateLabel(item.at)) + '</div>' +
        '</div></div>';
    }).join("");
  }

  async function refreshDashboard() {
    var status = document.getElementById("milanDashStatus");
    status.textContent = "Loading your records and activity…";

    var results = await Promise.allSettled([
      apiGet("/records?dbPage=1&limit=100"),
      apiGet("/records/stats"),
      apiGet("/activity")
    ]);

    var records = results[0].status === "fulfilled" && Array.isArray(results[0].value)
      ? results[0].value : [];
    var stats = results[1].status === "fulfilled" ? results[1].value : {};
    var activity = results[2].status === "fulfilled" && Array.isArray(results[2].value)
      ? results[2].value : [];

    var failures = results.filter(function (item) { return item.status === "rejected"; });
    var uploads = activity.filter(function (item) {
      return /media\.record\.(chunked|streamed)\.to\.dwn/.test(String(item.action || ""));
    }).length;
    var total = Number.isFinite(Number(stats.total)) ? Number(stats.total) : records.length;
    var privateCount = Number.isFinite(Number(stats.private)) ? Number(stats.private) : 0;
    var publicCount = Number.isFinite(Number(stats.public)) ? Number(stats.public) : 0;
    var sharedCount = Number.isFinite(Number(stats.sharedByMe)) ? Number(stats.sharedByMe) : 0;

    document.getElementById("milanDashMetrics").innerHTML = [
      metric("Your records", total, "Total reported by your records API"),
      metric("Private records", privateCount, "Visible only to your account"),
      metric("Public records", publicCount, "Records marked public"),
      metric("Recent media uploads", uploads, "Media uploads in the latest activity entries")
    ].join("");

    renderRecords(records);
    renderActivity(activity);

    if (failures.length === 3 && failures.every(function (item) { return item.reason && item.reason.status === 401; })) {
      status.textContent = "Your session may have expired. Sign in again to view your dashboard.";
    } else if (failures.length) {
      status.textContent = "Some dashboard data could not be loaded. Use Refresh dashboard to retry.";
    } else {
      status.textContent = "Dashboard updated · " + dateLabel(new Date().toISOString());
    }

    var welcome = document.getElementById("milanDashWelcome");
    try {
      var user = JSON.parse(localStorage.getItem("milan_user") || "{}");
      var name = user.profile && user.profile.display_name || user.displayName || user.name || user.email || "";
      welcome.textContent = name ? "Welcome back, " + name + ". Here is your personal MILAN activity." :
        "Your records, uploads and account activity in one place.";
    } catch (_) {
      welcome.textContent = "Your records, uploads and account activity in one place.";
    }
  }

  function openDashboard() {
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    refreshDashboard().catch(function () {
      document.getElementById("milanDashStatus").textContent = "Could not load your dashboard. Please try refreshing.";
    });
  }

  function closeDashboard() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  }

  navButton.addEventListener("click", openDashboard);
  document.getElementById("milanDashClose").addEventListener("click", closeDashboard);
  document.getElementById("milanDashRefresh").addEventListener("click", function () {
    refreshDashboard().catch(function () {
      document.getElementById("milanDashStatus").textContent = "Refresh failed. Please try again.";
    });
  });
  document.getElementById("milanDashAdmin").addEventListener("click", function () {
    window.location.href = "/admin-users.html";
  });
  overlay.addEventListener("click", function (event) {
    if (event.target === overlay) closeDashboard();
    var copyButton = event.target.closest("[data-copy-id]");
    if (copyButton) {
      var id = copyButton.getAttribute("data-copy-id") || "";
      if (!id) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(function () {
          document.getElementById("milanDashStatus").textContent = "Record ID copied.";
        }).catch(function () {
          window.prompt("Copy record ID", id);
        });
      } else {
        window.prompt("Copy record ID", id);
      }
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) closeDashboard();
  });

  addNavButton();
  if (!document.getElementById("milanDashboardNavBtn")) {
    window.addEventListener("milan:app-ready", addNavButton, { once: true });
  }
})();
