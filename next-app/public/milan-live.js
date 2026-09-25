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
  if (window.__milanLive) return;
  window.__milanLive = 1;

  var token = "";
  try { token = localStorage.getItem("milanToken") || ""; } catch (_) {}
  if (!token || !/\/app(\.html)?$/.test(location.pathname)) return;

  var url = location.origin + "/api/events?token=" + encodeURIComponent(token);

  function onEvent(raw) {
    var msg = raw;
    try { if (typeof raw === "string") msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || msg.type !== "notify") return;
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

  function start() { viaSharedWorker() || direct(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
