/* ============================================================================
   MILAN — live updates client (additive, zero-dependency)
   --------------------------------------------------------------------------
   Replaces "poll and hope" with instant push:
     1. SharedWorker + EventSource  — desktop: all open tabs share ONE
        connection to /api/events (SharedWorker is unsupported on Android
        Chrome, so mobile skips straight to 2).
     2. EventSource (direct)       — the normal path; auto-reconnects natively.
     3. WebSocket /ws              — fallback if EventSource is unavailable.
   On a "notify" event the app refreshes notifications + counters exactly
   once, immediately — no heavy periodic work on the main thread.
   ========================================================================== */
(function () {
  "use strict";

  if (!/\/app(\.html)?$/.test(location.pathname)) return;
  if (window.__milanLiveState === "started") return;

  var token = "";
  try { token = localStorage.getItem("milan_token") || ""; } catch (_) {}

  // Login may finish after deferred scripts have executed.
  // Wait for the token, then reload this client exactly once.
  if (!token) {
    if (window.__milanLiveState === "waiting") return;
    window.__milanLiveState = "waiting";

    var retryUrl = "/milan-live.js?v=20261015-networking-initfix";
    try {
      if (document.currentScript && document.currentScript.src) {
        retryUrl = document.currentScript.src;
      }
    } catch (_) {}

    function retryAfterLogin() {
      var latestToken = "";
      try { latestToken = localStorage.getItem("milan_token") || ""; } catch (_) {}

      if (latestToken) {
        window.__milanLiveState = "";
        var script = document.createElement("script");
        script.src = retryUrl;
        script.async = false;
        document.head.appendChild(script);
        return;
      }

      if (/\/app(\.html)?$/.test(location.pathname)) {
        window.setTimeout(retryAfterLogin, 1500);
      } else {
        window.__milanLiveState = "";
      }
    }

    window.setTimeout(retryAfterLogin, 1500);
    return;
  }

  window.__milanLiveState = "started";
  window.__milanLive = 1;

  var url = location.origin + "/api/events?token=" + encodeURIComponent(token);

  function onEvent(raw) {
    var msg = raw;
    try { if (typeof raw === "string") msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || msg.type !== "notify") return;
    var notifType = String(msg.notifType || "");
    if (notifType === "chat_typing" || notifType === "chat_read" || notifType === "chat_message") return;
    try {
      if (typeof loadNotifications === "function") loadNotifications();
      if (typeof loadSummary === "function") loadSummary();
    } catch (_) {}
  }

  /* 1 — SharedWorker holding one EventSource for every tab */
  function viaSharedWorker() {
    if (!("SharedWorker" in window)) return false;
    try {
      var src =
        'var es=null,ports=[];' +
        'function start(u){if(es)return;es=new EventSource(u);' +
        'es.onmessage=function(e){for(var i=0;i<ports.length;i++){try{ports[i].postMessage(e.data)}catch(_){}}}}' +
        'onconnect=function(e){var p=e.ports[0];ports.push(p);' +
        'p.onmessage=function(ev){start(String(ev.data||""))};if(p.start)p.start()};';
      var w = new SharedWorker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.port.onmessage = function (e) { onEvent(e.data); };
      w.port.postMessage(url);
      w.onerror = function () { direct(); };
      return true;
    } catch (_) { return false; }
  }

  /* 2 — plain EventSource (browser handles reconnection) */
  var esErrors = 0;
  function direct() {
    if (!("EventSource" in window)) return viaWebSocket();
    var es;
    try { es = new EventSource(url); } catch (_) { return viaWebSocket(); }
    es.onmessage = function (e) { esErrors = 0; onEvent(e.data); };
    es.onerror = function () {
      // expired session etc. — stop hammering after repeated failures
      if (++esErrors > 12) { try { es.close(); } catch (_) {} }
    };
    return true;
  }

  /* 3 — WebSocket fallback */
  function viaWebSocket() {
    // Vercel production uses SSE/polling; no Node WebSocket upgrade listener is attached.
    var host = String(location.hostname || "").toLowerCase();
    if (host === "milanlife.in" || host === "www.milanlife.in" || host.endsWith(".vercel.app")) return false;
    if (!("WebSocket" in window)) return false;
    var delay = 2000;
    function conn() {
      var ws;
      try {
        ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") +
          location.host + "/ws?token=" + encodeURIComponent(token));
      } catch (_) { return; }
      ws.onmessage = function (e) { delay = 2000; onEvent(e.data); };
      ws.onclose = function () {
        delay = Math.min(delay * 2, 60000);
        setTimeout(conn, delay);
      };
    }
    conn();
    return true;
  }

  function start() {
    var host = String(location.hostname || "").toLowerCase();

    if (
      host === "milanlife.in" ||
      host === "www.milanlife.in" ||
      host.endsWith(".vercel.app")
    ) {
      // Serverless fallback owns notification/summary polling on this host.
      window.__milanLivePollingActive = true;
      var refreshing = false;

      function refresh() {
        if (refreshing || document.hidden || (typeof mediaPlaying === "function" && mediaPlaying())) return;
        refreshing = true;

        var tasks = [];
        try {
          if (typeof loadNotifications === "function") {
            tasks.push(Promise.resolve(loadNotifications()));
          }
        } catch (_) {}

        try {
          if (typeof loadSummary === "function") {
            tasks.push(Promise.resolve(loadSummary()));
          }
        } catch (_) {}

        Promise.all(tasks.map(function (task) {
          return Promise.resolve(task).catch(function () {});
        })).then(
          function () { refreshing = false; },
          function () { refreshing = false; }
        );
      }

      refresh();
      window.setInterval(refresh, 30000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) refresh();
      });
      return;
    }

    window.__milanLivePushActive = viaSharedWorker() || direct();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
