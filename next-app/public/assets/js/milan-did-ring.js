"use strict";

(() => {
  const init = () => {
    const upload =
      document.querySelector(
        ".profile .milan-avatar-upload"
      );

    if (!upload || upload.dataset.didRingReady) {
      return;
    }

    upload.dataset.didRingReady = "1";
    upload.classList.add(
      "milan-did-identity"
    );

    const did =
      document.getElementById("myDid");

    if (did?.textContent.trim()) {
      upload.setAttribute(
        "data-did-state",
        "active"
      );
      upload.title =
        "Milan Web5 identity • DID active";
    } else {
      upload.setAttribute(
        "data-did-state",
        "resolving"
      );
      upload.title =
        "Milan Web5 identity • resolving DID";
    }

    const sync = () => {
      if (!did) return;

      const value =
        did.textContent.trim();

      if (value) {
        upload.setAttribute(
          "data-did-state",
          "active"
        );
        upload.title =
          "Milan Web5 identity • DID active";
      }
    };

    if (did) {
      new MutationObserver(sync).observe(did, {
        childList:true,
        subtree:true,
        characterData:true
      });
    }

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once:true }
    );
  } else {
    init();
  }

  setTimeout(init, 700);
})();
