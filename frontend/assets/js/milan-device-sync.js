/* Keep an account's feed current when it is also open on another phone,
   desktop browser, or app tab. The server remains the source of truth. */
(function () {
  "use strict";
  var timer = null;
  var channel = "BroadcastChannel" in window
    ? new BroadcastChannel("milan-feed-updates")
    : null;

  function refresh() {
    if (timer || document.hidden || !navigator.onLine) return;
    timer = setTimeout(function () {
      timer = null;
      if (typeof window.milanRefreshHomeFeed === "function") {
        window.milanRefreshHomeFeed();
      }
    }, 250);
  }

  if (channel) channel.onmessage = refresh;
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
  });
  // A lightweight polling fallback covers distinct devices, where browser
  // BroadcastChannel is intentionally not shared.
  setInterval(refresh, 30000);
})();
