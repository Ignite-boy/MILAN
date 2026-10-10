"use strict";

(() => {
  function openCreative() {
    const fab =
      document.querySelector(".mcm-fab");

    const overlay =
      document.querySelector(".mcm-overlay");

    if (!overlay) {
      console.warn(
        "[MILAN] Creative Mode overlay not ready"
      );
      return false;
    }

    overlay.classList.add("open");

    /* Force the exact login-page panel to be visible. */
    overlay.style.setProperty(
      "display",
      "flex",
      "important"
    );

    overlay.style.setProperty(
      "visibility",
      "visible",
      "important"
    );

    overlay.style.setProperty(
      "opacity",
      "1",
      "important"
    );

    overlay.style.setProperty(
      "pointer-events",
      "auto",
      "important"
    );

    overlay.style.setProperty(
      "z-index",
      "2147483646",
      "important"
    );

    fab?.style.setProperty(
      "z-index",
      "2147483647",
      "important"
    );

    return true;
  }

  function bind() {
    const fab =
      document.querySelector(".mcm-fab");

    if (!fab) {
      return false;
    }

    fab.type = "button";
    fab.setAttribute(
      "aria-label",
      "Creative Mode"
    );
    fab.title =
      "Creative Mode — change the whole look";

    fab.style.setProperty(
      "position",
      "fixed",
      "important"
    );

    fab.style.setProperty(
      "right",
      "22px",
      "important"
    );

    fab.style.setProperty(
      "bottom",
      "22px",
      "important"
    );

    fab.style.setProperty(
      "width",
      "48px",
      "important"
    );

    fab.style.setProperty(
      "height",
      "48px",
      "important"
    );

    fab.style.setProperty(
      "display",
      "grid",
      "important"
    );

    fab.style.setProperty(
      "place-items",
      "center",
      "important"
    );

    fab.style.setProperty(
      "visibility",
      "visible",
      "important"
    );

    fab.style.setProperty(
      "opacity",
      "1",
      "important"
    );

    fab.style.setProperty(
      "pointer-events",
      "auto",
      "important"
    );

    fab.style.setProperty(
      "cursor",
      "pointer",
      "important"
    );

    fab.style.setProperty(
      "z-index",
      "2147483647",
      "important"
    );

    if (!fab.dataset.milanBridgeBound) {
      fab.dataset.milanBridgeBound = "1";

      fab.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        true
      );

      fab.addEventListener(
        "pointerup",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        true
      );

      fab.addEventListener(
        "touchend",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        { capture: true, passive: false }
      );
    }

    return true;
  }

  function start() {
    if (bind()) return;

    const observer =
      new MutationObserver(() => {
        if (bind()) {
          observer.disconnect();
        }
      });

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );

    setTimeout(() => {
      bind();
      observer.disconnect();
    }, 5000);
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

/* ============================================================
   CREATIVE MODE — FINAL CLOSE HANDLER
   Removes the forced-open inline state as well as .open.
   ============================================================ */

(() => {
  function closeCreative() {
    const overlay =
      document.querySelector(".mcm-overlay");

    if (!overlay) return;

    overlay.classList.remove("open");

    overlay.style.removeProperty("display");
    overlay.style.removeProperty("visibility");
    overlay.style.removeProperty("opacity");
    overlay.style.removeProperty("pointer-events");
    overlay.style.removeProperty("z-index");
  }

  document.addEventListener(
    "click",
    event => {
      const closeButton =
        event.target.closest(".mcm-x");

      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        closeCreative();
        return;
      }

      const overlay =
        event.target.closest(".mcm-overlay");

      /* Click on the dark area outside the sheet */
      if (
        overlay &&
        event.target === overlay
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeCreative();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        closeCreative();
      }
    },
    true
  );
})();
