"use strict";

(() => {
  const $ = id => document.getElementById(id);

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

    if (!did) return "Resolving";
    if (did.length <= 30) return did;

    return `${did.slice(0, 17)}…${did.slice(-10)}`;
  }

  function toast(message) {
    let el = document.querySelector(
      ".milan-identity-toast"
    );

    if (!el) {
      el = document.createElement("div");
      el.className = "milan-identity-toast";
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(el.__timer);

    el.__timer = setTimeout(() => {
      el.classList.remove("show");
    }, 1800);
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

  async function fetchIdentity() {
    const t = token();

    if (!t) return null;

    try {
      const response = await fetch(
        "/api/auth/me",
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + t
          },
          cache: "no-store"
        }
      );

      if (!response.ok) {
        console.warn(
          "[MILAN] identity fetch failed:",
          response.status
        );
        return null;
      }

      const data =
        await response.json();

      const user =
        data?.user ||
        data?.data?.user ||
        data?.data ||
        data;

      const profile =
        data?.profile ||
        data?.data?.profile ||
        user?.profile ||
        {};

      const did = String(
        user?.did ||
        profile?.did ||
        data?.did ||
        ""
      ).trim();

      const dwn =
        user?.dwn ||
        data?.dwn ||
        profile?.dwn ||
        null;

      return {
        did,
        dwn
      };
    } catch (error) {
      console.warn(
        "[MILAN] identity fetch error:",
        error
      );
      return null;
    }
  }

  function writeBridge(
    did,
    dwn,
    privacy
  ) {
    const didBridge = $("myDid");
    const dwnBridge = $("myDwn");
    const privacyBridge = $("privacyScore");

    if (didBridge && did) {
      didBridge.textContent = did;
    }

    if (
      dwnBridge &&
      dwn
    ) {
      if (typeof dwn === "string") {
        dwnBridge.textContent = dwn;
      } else {
        dwnBridge.textContent =
          dwn.spaceId ||
          dwn.mode ||
          dwn.id ||
          "Connected";
      }
    }

    if (
      privacyBridge &&
      privacy
    ) {
      privacyBridge.textContent =
        privacy;
    }
  }

  function updateDidChip(did) {
    const chip =
      document.querySelector(
        ".milan-identity-status-chip.did"
      );

    if (!chip) return;

    let inline =
      chip.querySelector(
        ".milan-did-inline"
      );

    if (!inline) {
      const oldValue =
        chip.querySelector(".value");

      inline =
        document.createElement("div");

      inline.className =
        "milan-did-inline";

      const value =
        document.createElement("span");

      value.className = "value";

      const button =
        document.createElement("button");

      button.type = "button";
      button.className =
        "milan-did-copy";
      button.textContent = "⧉";
      button.title = "Copy full DID";
      button.setAttribute(
        "aria-label",
        "Copy full DID"
      );

      button.addEventListener(
        "click",
        async event => {
          event.preventDefault();
          event.stopPropagation();

          const fullDid =
            button.dataset.fullDid || "";

          if (!fullDid) {
            toast(
              "DID is still resolving"
            );
            return;
          }

          const ok =
            await copyText(fullDid);

          if (ok) {
            button.textContent = "✓";
            button.classList.add(
              "copied"
            );

            toast(
              "DID copied to clipboard"
            );

            setTimeout(() => {
              button.textContent = "⧉";
              button.classList.remove(
                "copied"
              );
            }, 1300);
          } else {
            toast(
              "Copy failed — select the DID manually"
            );
          }
        }
      );

      inline.appendChild(value);
      inline.appendChild(button);

      oldValue?.replaceWith(inline);
    }

    const value =
      inline.querySelector(".value");

    const button =
      inline.querySelector(
        ".milan-did-copy"
      );

    if (!did) {
      value.textContent = "Resolving";
      button.disabled = true;
      button.dataset.fullDid = "";
      chip.title =
        "DID is still resolving";
      return;
    }

    value.textContent =
      shortenDid(did);

    button.disabled = false;
    button.dataset.fullDid = did;

    chip.title = did;
  }

  function updateDwnChip(dwn) {
    const chip =
      document.querySelector(
        ".milan-identity-status-chip.dwn"
      );

    if (!chip) return;

    const value =
      chip.querySelector(".value");

    if (!value) return;

    const raw = String(
      dwn || ""
    ).trim().toLowerCase();

    let state = "Connected";

    if (!raw) {
      state = "Resolving";
    } else if (
      /offline|isolated|disconnected|unavailable/.test(raw)
    ) {
      state = "Isolated";
    }

    value.textContent = state;

    chip.classList.remove(
      "connected",
      "resolving",
      "isolated"
    );

    chip.classList.add(
      state.toLowerCase()
    );

    chip.title =
      dwn
        ? `DWN: ${dwn}`
        : "DWN resolving";
  }

  function updatePrivacyChip() {
    const chip =
      document.querySelector(
        ".milan-identity-status-chip.privacy"
      );

    if (!chip) return;

    const value =
      chip.querySelector(".value");

    const score =
      $("privacyScore")?.textContent.trim();

    if (value) {
      value.textContent =
        score || "100%";
    }
  }

  async function sync() {
    const identity =
      await fetchIdentity();

    if (!identity) {
      updateDidChip("");
      updateDwnChip("");
      updatePrivacyChip();
      return;
    }

    const did =
      identity.did;

    const dwn =
      identity.dwn;

    writeBridge(
      did,
      dwn,
      $("privacyScore")?.textContent.trim()
    );

    updateDidChip(did);
    updateDwnChip(
      typeof dwn === "string"
        ? dwn
        : (
            dwn?.spaceId ||
            dwn?.mode ||
            dwn?.id ||
            ""
          )
    );

    updatePrivacyChip();
  }

  function start() {
    sync();

    /*
     * Identity can become available shortly after
     * the main app boot. Retry briefly, then stop.
     */
    let attempts = 0;

    const timer =
      setInterval(() => {
        sync();

        attempts++;

        if (attempts >= 8) {
          clearInterval(timer);
        }
      }, 750);

    const observer =
      new MutationObserver(() => {
        updatePrivacyChip();
      });

    const privacy =
      $("privacyScore");

    if (privacy) {
      observer.observe(
        privacy,
        {
          childList: true,
          subtree: true,
          characterData: true
        }
      );
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
