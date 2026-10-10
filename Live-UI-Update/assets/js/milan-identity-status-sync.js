"use strict";

(() => {
  const $ = id => document.getElementById(id);

  function sync() {
    const privacy =
      $("privacyScore")?.textContent.trim();

    const privacyChip =
      document.querySelector(
        ".milan-identity-status-chip.privacy .value"
      );

    if (privacyChip) {
      privacyChip.textContent =
        /^\d+%$/.test(privacy || "")
          ? privacy
          : "100%";
    }

    const did =
      $("myDid")?.textContent.trim();

    const didValue =
      document.querySelector(
        ".milan-identity-status-chip.did .value"
      );

    if (
      didValue &&
      !didValue.closest(".milan-did-inline")
    ) {
      didValue.textContent =
        did
          ? (
              did.length > 27
                ? did.slice(0,16) +
                  "…" +
                  did.slice(-9)
                : did
            )
          : "Resolving";
    }
  }

  function init() {
    sync();

    [
      $("myDid"),
      $("myDwn"),
      $("privacyScore")
    ]
      .filter(Boolean)
      .forEach(node => {
        new MutationObserver(sync).observe(
          node,
          {
            childList:true,
            subtree:true,
            characterData:true
          }
        );
      });

    setInterval(sync, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }
})();
