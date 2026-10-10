"use strict";

(() => {
  const init = () => {
    const profile =
      document.querySelector(".profile");

    if (
      !profile ||
      profile.dataset.identityStatusReady
    ) {
      return;
    }

    const name =
      document.getElementById("myName");

    const did =
      document.getElementById("myDid");

    const dwn =
      document.getElementById("myDwn");

    const privacy =
      document.getElementById("privacyScore");

    if (!name) return;

    profile.dataset.identityStatusReady = "1";

    const row =
      document.createElement("div");

    row.className =
      "milan-identity-status-row";

    row.innerHTML = `
      <div class="milan-identity-status-chip did">
        <span class="label">DID</span>
        <span class="value">Resolving</span>
      </div>

      <div class="milan-identity-status-chip dwn">
        <span class="label">DWN</span>
        <span class="value">Connecting</span>
      </div>

      <div class="milan-identity-status-chip privacy">
        <span class="label">Privacy</span>
        <span class="value">—</span>
      </div>
    `;

    const email =
      document.getElementById("myEmail");

    if (email) {
      email.insertAdjacentElement(
        "afterend",
        row
      );
    } else {
      profile.appendChild(row);
    }

    const didValue =
      row.querySelector(
        ".did .value"
      );

    const dwnValue =
      row.querySelector(
        ".dwn .value"
      );

    const privacyValue =
      row.querySelector(
        ".privacy .value"
      );

    const sync = () => {
      const didText =
        did?.textContent.trim() || "";

      const dwnText =
        dwn?.textContent
          .replace(/^Cloud DWN:\s*/i, "")
          .trim() || "";

      const privacyText =
        privacy?.textContent.trim() || "";

      didValue.textContent =
        didText
          ? "Active"
          : "Resolving";

      dwnValue.textContent =
        dwnText ||
        "Connected";

      privacyValue.textContent =
        privacyText ||
        "—";
    };

    const observer =
      new MutationObserver(sync);

    [did, dwn, privacy]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element, {
          childList:true,
          subtree:true,
          characterData:true
        });
      });

    sync();
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }

  setTimeout(init, 900);
})();
