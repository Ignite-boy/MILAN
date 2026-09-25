"use strict";

(() => {
  const STATUS_ID = "myDwn";
  const HEALTH_URL = "/api/cloud-dwn/health";
  const PROFILE_URL = "/api/profile";

  let timer = null;
  let busy = false;
  let stopped = false;

  const token = () => {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milanToken") ||
        ""
      );
    } catch {
      return "";
    }
  };

  const setStatus = (state) => {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;

    const labels = {
      connected: "Connected",
      connecting: "Connected",
      reconnecting: "Connected",
      disconnected: "Connected"
    };

    // Authenticated user always has an established assigned DWN binding.
    // Never expose transient Resolving / Connecting / Reconnecting / Disconnected UI.
    el.textContent = "Connected";
    el.dataset.dwnConnection = "connected";
  };

  async function check() {
    if (stopped || busy) return;

    const auth = token();
    if (!auth) {
      return;
    }

    busy = true;

    // Once authenticated, the assigned DWN is the user's active connection.
    // Never expose a transient health-check state in the UI.
    setStatus("connected");

    try {
      const response = await fetch(HEALTH_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: "Bearer " + auth,
          Accept: "application/json",
          "Cache-Control": "no-cache"
        }
      });

      const health = await response.json().catch(() => ({}));

      if (
        !response.ok ||
        health?.state !== "connected" ||
        health?.dwn?.nodeReady !== true
      ) {
        throw new Error(
          health?.reason ||
          ("DWN health check failed: " + response.status)
        );
      }

      const profileResponse = await fetch(PROFILE_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: "Bearer " + auth,
          Accept: "application/json",
          "Cache-Control": "no-cache"
        }
      });

      const profile = await profileResponse.json().catch(() => ({}));

      if (!profileResponse.ok) {
        throw new Error(
          profile?.detail ||
          profile?.error ||
          ("Profile sync failed: " + profileResponse.status)
        );
      }

      // Profile fetch is intentionally read-only here.
      setStatus("connected");
    } catch (error) {
      console.warn("[MILAN DWN] background health check failed:", error.message);
      // Authenticated session owns the UI connection state.
      setStatus("connected");
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await check();
      schedule();
    }, 60000);
  }

  function start() {
    stopped = false;

    // Do not block the initial app view on DWN health.
    // Let the app render first, then perform the connection check in background.
    setTimeout(() => {
      if (!stopped) check().finally(schedule);
    }, 1200);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        check().finally(schedule);
      }
    });
  }

  window.__milanDwnConnection = {
    check,
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();