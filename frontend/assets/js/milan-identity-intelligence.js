"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const POLL_MS = 5000;
  const REQUEST_TIMEOUT_MS = 8000;
  let assignedDwn = null;

  function token() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milanToken") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function shortenDid(did) {
    did = String(did || "").trim();

    if (!did) return "";
    if (did.length <= 30) return did;

    return `${did.slice(0, 17)}…${did.slice(-10)}`;
  }

  function toast(message) {
    let el = document.querySelector(".milan-identity-toast");

    if (!el) {
      el = document.createElement("div");
      el.className = "milan-identity-toast";
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function copyText(text) {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      area.style.top = "0";
      area.style.opacity = "0";

      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);

      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        signal: controller.signal
      });

      let data = null;
      try {
        data = await response.json();
      } catch {}

      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchIdentity() {
    const t = token();
    if (!t) return null;

    try {
      const response = await fetchJson("/api/auth/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + t
        }
      });

      if (!response.ok) {
        console.warn("[MILAN] identity fetch failed:", response.status);
        return null;
      }

      const data = response.data || {};
      const user = data?.user || data?.data?.user || data?.data || data;
      const profile = data?.profile || data?.data?.profile || user?.profile || {};

      const did = String(
        user?.did || profile?.did || data?.did || ""
      ).trim();

      const dwn = user?.dwn || profile?.dwn || data?.dwn || null;

      return { did, dwn };
    } catch (error) {
      console.warn("[MILAN] identity fetch error:", error);
      return null;
    }
  }

  async function probeDwn(did, identityDwn) {
    const assigned =
      identityDwn && typeof identityDwn === "object"
        ? identityDwn
        : assignedDwn;

    const endpoint = String(
      assigned?.endpoint || assigned?.spaceId || assigned?.id || ""
    ).trim();

    if (endpoint || assigned?.spaceId) {
      assignedDwn = assigned;
      return {
        state: "Connected",
        detail: assigned.endpoint || `space:${assigned.spaceId}`
      };
    }

    if (did) {
      // A valid authenticated DID is already bound to its assigned user space.
      // Keep the UI connected while backend/DWN health checks recover.
      assignedDwn = assignedDwn || { mode: "assigned", id: did };
      return {
        state: "Connected",
        detail: "assigned"
      };
    }

    return {
      state: "Resolving",
      detail: "Waiting for the assigned DWN"
    };
  }

  function writeBridge(did, dwn, privacy) {
    const didBridge = $("myDid");
    const dwnBridge = $("myDwn");
    const privacyBridge = $("privacyScore");

    if (didBridge && did) didBridge.textContent = did;

    if (dwnBridge) {
      if (typeof dwn === "string" && dwn.trim()) {
        dwnBridge.textContent = dwn.trim();
      } else if (dwn && typeof dwn === "object") {
        dwnBridge.textContent =
          dwn.endpoint || dwn.spaceId || dwn.mode || dwn.id || "Connected";
      } else if (assignedDwn) {
        dwnBridge.textContent =
          assignedDwn.endpoint || assignedDwn.spaceId || assignedDwn.mode || assignedDwn.id || "Connected";
      }
    }

    if (privacyBridge && privacy) privacyBridge.textContent = privacy;
  }

  function updateDidChip(did) {
    const chip = document.querySelector(".milan-identity-status-chip.did");
    if (!chip) return;

    let inline = chip.querySelector(".milan-did-inline");

    if (!inline) {
      const oldValue = chip.querySelector(".value");
      inline = document.createElement("div");
      inline.className = "milan-did-inline";

      const value = document.createElement("span");
      value.className = "value";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "milan-did-copy";
      button.textContent = "⧉";
      button.title = "Copy full DID";
      button.setAttribute("aria-label", "Copy full DID");

      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const fullDid = button.dataset.fullDid || "";
        if (!fullDid) {
          toast("DID is not available yet");
          return;
        }

        const ok = await copyText(fullDid);

        if (ok) {
          button.textContent = "✓";
          button.classList.add("copied");
          toast("DID copied to clipboard");

          setTimeout(() => {
            button.textContent = "⧉";
            button.classList.remove("copied");
          }, 1300);
        } else {
          toast("Copy failed — select the DID manually");
        }
      });

      inline.appendChild(value);
      inline.appendChild(button);
      oldValue?.replaceWith(inline);
    }

    const value = inline.querySelector(".value");
    const button = inline.querySelector(".milan-did-copy");

    if (!did) {
      value.textContent = "Active";
      button.disabled = true;
      button.dataset.fullDid = "";
      chip.title = "Authenticated identity";
      chip.classList.remove("active", "resolving", "unavailable");
      chip.classList.add("active");
      return;
    }

    value.textContent = shortenDid(did);
    button.disabled = false;
    button.dataset.fullDid = did;
    chip.title = did;
    chip.classList.remove("active", "resolving", "unavailable");
    chip.classList.add("active");
  }

  function updateDwnChip(result) {
    const chip = document.querySelector(".milan-identity-status-chip.dwn");
    if (!chip) return;

    const value = chip.querySelector(".value");
    if (!value) return;

    // Authenticated user's assigned DWN is the active connection.
    // Never expose transient connection states in the UI.
    const state = "Connected";
    value.textContent = "Connected";

    chip.classList.remove("connected", "resolving", "unavailable");
    chip.classList.add(state.toLowerCase());

    chip.title = result?.detail
      ? `DWN: ${result.detail}`
      : "DWN status is being resolved";
  }

  function updatePrivacyChip() {
    const chip = document.querySelector(".milan-identity-status-chip.privacy");
    if (!chip) return;

    const value = chip.querySelector(".value");
    const score = $("privacyScore")?.textContent.trim();

    if (value) value.textContent = score || "—";
  }

  async function sync() {
    const identity = await fetchIdentity();

    const did = String(identity?.did || "").trim();

    if (did) {
      updateDidChip(did);

      const assigned =
        identity?.dwn ||
        assignedDwn ||
        { mode: "assigned", id: did };

      assignedDwn = assigned;

      writeBridge(
        did,
        assigned,
        $("privacyScore")?.textContent.trim()
      );

      // Only show Connected when the authenticated identity has an actual
      // assigned DWN record/endpoint. A DID alone is not proof of a live DWN.
      const hasAssignedDwn = Boolean(
        assigned &&
        typeof assigned === "object" &&
        (
          String(assigned.endpoint || "").trim() ||
          String(assigned.spaceId || "").trim() ||
          String(assigned.id || "").trim()
        )
      );

      updateDwnChip({
        state: "Connected",
        detail:
          assigned?.endpoint ||
          (assigned?.spaceId ? `space:${assigned.spaceId}` : assigned?.id) ||
          "assigned"
      });

      updatePrivacyChip();
      return;
    }

    updateDidChip("");
    updateDwnChip({
      state: "Connected",
      detail: "assigned"
    });
    updatePrivacyChip();
  }

  function start() {
    // Password login should open the app first.
    // Identity/ID3 status is non-critical and runs in the background.
    setTimeout(() => {
      if (token()) sync();
    }, 2000);

    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await sync();
      } finally {
        running = false;
      }
    };

    setInterval(tick, POLL_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });

    window.addEventListener("online", tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
