"use strict";

(() => {
  const STATUS_ID = "myDwn";
  const HEALTH_URL = "/api/cloud-dwn/status";
  const PROFILE_URL = "/api/profile";

  let timer = null;
  let busy = false;
  let stopped = false;

  const token = () => {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milan_token") ||
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
      connected: "Cloud storage connected",
      connecting: "Checking cloud storage...",
      reconnecting: "Checking cloud storage...",
      disconnected: "Cloud storage unavailable"
    };

    el.textContent = labels[state] || "Cloud storage status unknown";
    el.dataset.dwnConnection = state;
    el.title = state === "connected"
      ? "PostgreSQL core storage is reachable. Signed DWN protocol execution is not integrated."
      : "Cloud storage configuration or authenticated profile check needs attention.";
  };

  async function check() {
    if (stopped || busy) return;

    const auth = token();
    if (!auth) {
      return;
    }

    busy = true;

    // Only show connected after cloud storage and profile checks succeed.
    setStatus("connecting");

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
        health?.ok !== true ||
        health?.mode !== "postgresql" ||
        health?.storage?.mode !== "postgresql" ||
        health?.storage?.databaseReachable !== true
      ) {
        throw new Error(
          "PostgreSQL core storage is not reachable (HTTP " +
          response.status + ")."
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
      setStatus("disconnected");
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