/* ============================================================
   MILAN — Visual Interaction Engine v1
   ============================================================ */

"use strict";

(() => {
  const init = () => {
    /* Pointer ambient light */
    if (!window.matchMedia("(pointer:fine)").matches) {
      return setupReveals();
    }

    const glow = document.createElement("div");
    glow.className = "milan-pointer-glow";
    document.body.appendChild(glow);

    let raf = 0;
    let x = 0;
    let y = 0;

    const move = event => {
      x = event.clientX;
      y = event.clientY;

      if (raf) return;

      raf = requestAnimationFrame(() => {
        glow.style.left = `${x}px`;
        glow.style.top = `${y}px`;
        glow.style.opacity = "1";
        raf = 0;
      });
    };

    document.addEventListener("pointermove", move, {
      passive:true
    });

    document.addEventListener("pointerleave", () => {
      glow.style.opacity = "0";
    });

    setupReveals();
  };

  function setupReveals() {
    const targets = document.querySelectorAll(
      ".post, .milan-feed-card, .right-card, .composer, .sidebar"
    );

    if (!targets.length) return;

    targets.forEach((el, index) => {
      if (el.dataset.visualReady) return;

      el.dataset.visualReady = "1";
      el.classList.add("milan-visual-reveal");
      el.style.transitionDelay = `${Math.min(index * 35, 220)}ms`;
    });

    if (!("IntersectionObserver" in window)) {
      targets.forEach(el =>
        el.classList.add("is-visible")
      );
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        root:null,
        rootMargin:"0px 0px -8% 0px",
        threshold:0.04
      }
    );

    targets.forEach(el => observer.observe(el));
  }

  /* Button press feedback */
  document.addEventListener(
    "pointerdown",
    event => {
      const button = event.target.closest("button");
      if (!button) return;

      button.classList.remove("milan-press");
      void button.offsetWidth;
      button.classList.add("milan-press");

      setTimeout(() => {
        button.classList.remove("milan-press");
      }, 180);
    },
    {passive:true}
  );

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

  /* Re-observe dynamically rendered feed */
  const feed = document.getElementById("feed");

  if (feed && "MutationObserver" in window) {
    let timer = 0;

    const mutationObserver =
      new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
          setupReveals();
        }, 90);
      });

    mutationObserver.observe(feed, {
      childList:true
    });
  }
})();

/* ============================================================
   Web5 identity / network visual layer
   ============================================================ */

(() => {
  const initWeb5Visuals = () => {
    const profile = document.querySelector(".profile");
    if (!profile || profile.dataset.web5VisualReady) return;

    profile.dataset.web5VisualReady = "1";
    profile.classList.add("milan-identity-panel");

    const did = document.getElementById("myDid");
    const dwn = document.getElementById("myDwn");
    const health = document.getElementById("health");

    const status = document.createElement("div");
    status.className = "milan-web5-status";

    status.innerHTML = `
      <span class="milan-web5-dot"></span>
      <span>Web5 identity layer active</span>
    `;

    profile.appendChild(status);

    if (did && !did.parentElement?.querySelector(".milan-did-chip")) {
      const chip = document.createElement("div");
      chip.className = "milan-did-chip";

      chip.innerHTML = `
        <span class="label">DID</span>
        <span class="value"></span>
      `;

      chip.querySelector(".value").textContent =
        did.textContent.trim() || "Resolving identity…";

      did.parentElement?.appendChild(chip);
    }

    if (dwn && !dwn.parentElement?.querySelector(".milan-dwn-chip")) {
      const chip = document.createElement("span");
      chip.className = "milan-dwn-chip";
      chip.textContent = "DWN Connected";

      dwn.parentElement?.appendChild(chip);
    }

    if (health) {
      health.classList.add("milan-network-value");
      health.parentElement?.classList.add("milan-network-left");

      const strip = document.createElement("div");
      strip.className = "milan-network-strip";

      strip.innerHTML = `
        <div class="milan-network-left">
          <span class="milan-web5-dot"></span>
          <span class="milan-network-label">Network</span>
          <span class="milan-network-value"></span>
        </div>
        <span class="milan-network-meta">DWN • DID • Private by default</span>
      `;

      const value = strip.querySelector(".milan-network-value");
      value.textContent =
        health.textContent.trim() || "Connecting…";

      health.closest(".card")?.prepend(strip);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initWeb5Visuals,
      { once: true }
    );
  } else {
    initWeb5Visuals();
  }

  setTimeout(initWeb5Visuals, 900);
})();

/* ============================================================
   Web5 Workspace composition
   ============================================================ */

(() => {
  const initWorkspace = () => {
    const composer = document.querySelector(".composer");
    if (!composer || composer.dataset.workspaceReady) return;

    composer.dataset.workspaceReady = "1";

    const label = document.createElement("div");
    label.className = "milan-workspace-label";

    label.innerHTML = `
      <div class="milan-workspace-title">
        <span class="mark">◈</span>
        <div>
          <strong>Your Web5 Space</strong>
          <span>Create a record you control.</span>
        </div>
      </div>

      <span class="milan-workspace-status">
        <i></i>
        User-owned data
      </span>
    `;

    composer.prepend(label);

    const privacy = document.getElementById("privacy");

    if (privacy && !composer.querySelector(".milan-privacy-pills")) {
      const pills = document.createElement("div");
      pills.className = "milan-privacy-pills";

      const modes = [
        ["private", "🔒 Private"],
        ["public", "🌐 Public"],
        ["shared_did", "◈ Shared DID"]
      ];

      modes.forEach(([value, text]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "milan-privacy-pill";
        button.dataset.mode = value;
        button.textContent = text;

        button.addEventListener("click", () => {
          privacy.value = value;
          privacy.dispatchEvent(new Event("change", {
            bubbles: true
          }));

          pills
            .querySelectorAll(".milan-privacy-pill")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item.dataset.mode === value
              );
            });

          updateVisibilityNote(value);
        });

        pills.appendChild(button);
      });

      composer.appendChild(pills);

      const note = document.createElement("div");
      note.className = "milan-visibility-note";
      note.innerHTML = `
        <span class="icon">🔒</span>
        <span class="text"></span>
      `;

      composer.appendChild(note);

      const sync = () => {
        const value = privacy.value || "private";

        pills
          .querySelectorAll(".milan-privacy-pill")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item.dataset.mode === value
            );
          });

        updateVisibilityNote(value);
      };

      function updateVisibilityNote(value) {
        const icon = note.querySelector(".icon");
        const text = note.querySelector(".text");

        const states = {
          private: [
            "🔒",
            "Private — only you can access this record."
          ],
          public: [
            "🌐",
            "Public — visible in the public feed."
          ],
          shared_did: [
            "◈",
            "Shared DID — only selected identities."
          ]
        };

        const state = states[value] || states.private;

        icon.textContent = state[0];
        text.textContent = state[1];
      }

      privacy.addEventListener("change", sync);
      sync();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initWorkspace,
      { once:true }
    );
  } else {
    initWorkspace();
  }

  setTimeout(initWorkspace, 700);
})();

(() => {
  const initFeedHeader = () => {
    const feed =
      document.getElementById("feed") ||
      document.querySelector(".feed");

    if (!feed || feed.dataset.spaceHeaderReady) return;

    const host =
      feed.parentElement || feed;

    if (
      host.querySelector(".milan-feed-space-header")
    ) {
      feed.dataset.spaceHeaderReady = "1";
      return;
    }

    feed.dataset.spaceHeaderReady = "1";

    const header = document.createElement("div");
    header.className = "milan-feed-space-header";

    header.innerHTML = `
      <div>
        <h2>Your Network</h2>
        <p>Private-first conversations across your Web5 space.</p>
      </div>

      <span class="milan-feed-mode">
        <span class="signal"></span>
        LIVE SPACE
      </span>
    `;

    feed.parentElement?.insertBefore(
      header,
      feed
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initFeedHeader,
      { once:true }
    );
  } else {
    initFeedHeader();
  }

  setTimeout(initFeedHeader, 900);
})();

/* ============================================================
   Spatial feed enhancement
   ============================================================ */

(() => {
  const classifyAccess = value => {
    if (value === "public") return "public";
    if (value === "shared_did") return "shared";
    return "private";
  };

  const accessLabel = type => ({
    private: "Private record",
    public: "Public record",
    shared: "Shared with selected DID"
  }[type] || "Private record");

  const accessIcon = type => ({
    private: "🔒",
    public: "🌐",
    shared: "◈"
  }[type] || "🔒");

  const enhancePost = post => {
    if (!post || post.dataset.spatialReady) return;

    post.dataset.spatialReady = "1";

    const access =
      post.dataset.accessMode ||
      post.querySelector(".mini")?.textContent
        ?.match(/private|public|shared_did/i)?.[0] ||
      "private";

    const type = classifyAccess(
      String(access).toLowerCase()
    );

    post.insertAdjacentHTML(
      "afterbegin",
      '<span class="milan-live-rail"></span>'
    );

    const header =
      post.querySelector(".postHead");

    if (header) {
      const context =
        document.createElement("div");

      context.className =
        "milan-post-context";

      context.innerHTML = `
        <div class="left">
          <span class="milan-access-icon ${type}">
            ${accessIcon(type)}
          </span>

          <span class="label">
            Web5 record
          </span>

          <span class="value">
            ${accessLabel(type)}
          </span>
        </div>

        <span class="right">
          User-controlled
        </span>
      `;

      header.after(context);
    }

    const media =
      post.querySelector(".media");

    if (media && !media.parentElement?.classList.contains("milan-media-frame")) {
      const frame =
        document.createElement("div");

      frame.className =
        "milan-media-frame";

      media.parentNode.insertBefore(
        frame,
        media
      );

      frame.appendChild(media);
    }
  };

  const scan = () => {
    document
      .querySelectorAll(
        "#feed .post, .feed .post"
      )
      .forEach(enhancePost);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      scan,
      { once:true }
    );
  } else {
    scan();
  }

  setTimeout(scan, 800);
  setTimeout(scan, 1800);

  const feed =
    document.getElementById("feed");

  if (
    feed &&
    "MutationObserver" in window
  ) {
    const observer =
      new MutationObserver(() => {
        requestAnimationFrame(scan);
      });

    observer.observe(feed, {
      childList:true
    });
  }
})();

/* ============================================================
   DID Identity Cockpit
   ============================================================ */

(() => {
  const initIdentityCockpit = () => {
    const profile = document.querySelector(".profile");

    if (
      !profile ||
      profile.dataset.identityCockpitReady
    ) {
      return;
    }

    profile.dataset.identityCockpitReady = "1";

    const name =
      document.getElementById("myName");

    const avatar =
      document.getElementById("myAvatar");

    const email =
      document.getElementById("myEmail");

    const did =
      document.getElementById("myDid");

    const dwn =
      document.getElementById("myDwn");

    if (!name) return;

    const cockpit =
      document.createElement("div");

    cockpit.className =
      "milan-identity-cockpit";

    cockpit.innerHTML = `
      <div class="milan-identity-header">
        <div class="milan-identity-avatar"></div>

        <div class="milan-identity-core">
          <strong class="name"></strong>
          <div class="role">
            Self-owned Web5 identity
          </div>
        </div>

        <span class="milan-identity-live">
          <i></i>
          Live
        </span>
      </div>

      <div class="milan-identity-grid">
        <div class="milan-identity-stat">
          <div class="k">Identity</div>
          <div class="v good">Verified locally</div>
        </div>

        <div class="milan-identity-stat">
          <div class="k">Storage</div>
          <div class="v storage">DWN Connected</div>
        </div>
      </div>

      <div class="milan-identity-did">
        <div class="label">Decentralized Identifier</div>
        <div class="value did-value">
          Resolving DID…
        </div>
      </div>

      <div class="milan-identity-footer">
        <span class="network">
          Network <b>Private-first</b>
        </span>

        <span class="milan-identity-badge">
          ◈ Web5
        </span>
      </div>
    `;

    const avatarHost =
      cockpit.querySelector(
        ".milan-identity-avatar"
      );

    if (
      avatar &&
      avatar.innerHTML.trim()
    ) {
      avatarHost.innerHTML =
        avatar.innerHTML;
    } else {
      avatarHost.textContent = "M";
    }

    cockpit.querySelector(
      ".name"
    ).textContent =
      name.textContent.trim() ||
      "MILAN User";

    cockpit.querySelector(
      ".did-value"
    ).textContent =
      did?.textContent.trim() ||
      "Resolving DID…";

    cockpit.querySelector(
      ".storage"
    ).textContent =
      dwn?.textContent
        .replace(/^Cloud DWN:\s*/i, "")
        .trim() ||
      "DWN Connected";

    profile.prepend(cockpit);

    /* Keep cockpit synchronized with existing DOM. */
    const sync = () => {
      const currentName =
        name?.textContent.trim();

      const currentDid =
        did?.textContent.trim();

      const currentDwn =
        dwn?.textContent
          .replace(/^Cloud DWN:\s*/i, "")
          .trim();

      if (currentName) {
        cockpit.querySelector(
          ".name"
        ).textContent = currentName;
      }

      if (currentDid) {
        cockpit.querySelector(
          ".did-value"
        ).textContent = currentDid;
      }

      if (currentDwn) {
        cockpit.querySelector(
          ".storage"
        ).textContent = currentDwn;
      }

      const emailValue =
        email?.textContent.trim();

      if (emailValue) {
        cockpit.title =
          emailValue;
      }
    };

    const observer =
      new MutationObserver(sync);

    [name, email, did, dwn]
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

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initIdentityCockpit,
      { once:true }
    );
  } else {
    initIdentityCockpit();
  }

  setTimeout(
    initIdentityCockpit,
    1000
  );
})();

(() => {
  const initPrivacyScore = () => {
    const cockpit =
      document.querySelector(
        ".milan-identity-cockpit"
      );

    if (
      !cockpit ||
      cockpit.querySelector(
        ".milan-identity-score"
      )
    ) {
      return;
    }

    const score =
      document.getElementById(
        "privacyScore"
      );

    if (!score) return;

    const box =
      document.createElement("div");

    box.className =
      "milan-identity-score";

    box.innerHTML = `
      <div class="milan-identity-score-head">
        <span>Privacy posture</span>
        <b>100%</b>
      </div>

      <div class="milan-identity-score-bar">
        <span></span>
      </div>
    `;

    cockpit.appendChild(box);

    const sync = () => {
      const text =
        score.textContent.trim();

      const value =
        parseInt(
          text.replace(/\D/g, ""),
          10
        );

      if (
        !Number.isFinite(value)
      ) {
        return;
      }

      const bounded =
        Math.max(
          0,
          Math.min(100, value)
        );

      box.querySelector(
        "b"
      ).textContent =
        bounded + "%";

      box.querySelector(
        ".milan-identity-score-bar span"
      ).style.width =
        bounded + "%";
    };

    const observer =
      new MutationObserver(sync);

    observer.observe(score, {
      childList:true,
      characterData:true,
      subtree:true
    });

    sync();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initPrivacyScore,
      { once:true }
    );
  } else {
    initPrivacyScore();
  }

  setTimeout(
    initPrivacyScore,
    1300
  );
})();

/* ============================================================
   Profile picture hero + Web5 identity proof
   ============================================================ */

(() => {
  const initProfileHero = () => {
    const profile = document.querySelector(".profile");
    const avatar = document.getElementById("myAvatar");
    const name = document.getElementById("myName");
    const did = document.getElementById("myDid");
    const dwn = document.getElementById("myDwn");

    if (
      !profile ||
      !avatar ||
      profile.dataset.profileHeroReady
    ) {
      return;
    }

    profile.dataset.profileHeroReady = "1";

    const hero = document.createElement("div");
    hero.className = "milan-profile-hero";

    const orbit = document.createElement("div");
    orbit.className = "milan-profile-avatar-orbit";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "milan-profile-avatar";

    const avatarInner = document.createElement("div");
    avatarInner.className = "milan-profile-avatar-inner";

    const copyAvatar = () => {
      avatarInner.innerHTML = "";

      const image = avatar.querySelector("img");

      if (image?.src) {
        const clone = document.createElement("img");
        clone.src = image.src;
        clone.alt = image.alt || "Milan profile";
        avatarInner.appendChild(clone);
        return;
      }

      const bg = getComputedStyle(avatar).backgroundImage;

      if (bg && bg !== "none") {
        avatarInner.style.backgroundImage = bg;
        avatarInner.style.backgroundSize = "cover";
        avatarInner.style.backgroundPosition = "center";
        return;
      }

      avatarInner.textContent =
        avatar.textContent.trim() || "M";
    };

    copyAvatar();

    const state = document.createElement("span");
    state.className = "milan-profile-avatar-state";
    state.textContent = "✓";
    state.title = "Identity active";

    avatarWrap.appendChild(avatarInner);
    orbit.appendChild(avatarWrap);
    orbit.appendChild(state);

    hero.appendChild(orbit);

    const displayName = document.createElement("div");
    displayName.className = "milan-profile-name";
    displayName.textContent =
      name?.textContent.trim() || "MILAN User";
    hero.appendChild(displayName);

    const subtitle = document.createElement("div");
    subtitle.className = "milan-profile-subtitle";
    subtitle.textContent =
      "Self-owned Web5 identity";
    hero.appendChild(subtitle);

    const proof = document.createElement("div");
    proof.className = "milan-profile-proof";

    proof.innerHTML = `
      <span class="milan-proof-chip web5">◈ Web5</span>
      <span class="milan-proof-chip did">DID</span>
      <span class="milan-proof-chip dwn">DWN</span>
    `;

    hero.appendChild(proof);

    profile.prepend(hero);

    /* Keep the hero synchronized with profile changes. */
    const sync = () => {
      if (name?.textContent.trim()) {
        displayName.textContent =
          name.textContent.trim();
      }

      copyAvatar();

      const didValue =
        did?.textContent.trim() || "";

      const dwnValue =
        dwn?.textContent.trim() || "";

      proof.querySelector(".did").title =
        didValue || "DID resolving";

      proof.querySelector(".dwn").title =
        dwnValue || "DWN resolving";
    };

    const observer =
      new MutationObserver(sync);

    [avatar, name, did, dwn]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element, {
          childList:true,
          subtree:true,
          attributes:true,
          characterData:true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initProfileHero,
      { once:true }
    );
  } else {
    initProfileHero();
  }

  setTimeout(initProfileHero, 900);
  setTimeout(initProfileHero, 1800);
})();

(() => {
  const activateProfilePulse = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    if (!hero) return;

    hero.classList.add("is-scanning");

    setTimeout(() => {
      hero.classList.remove("is-scanning");
    }, 2200);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      activateProfilePulse,
      { once:true }
    );
  } else {
    activateProfilePulse();
  }
})();

/* ============================================================
   Creation Studio interaction layer
   ============================================================ */

(() => {
  const initCreationStudio = () => {
    const composer = document.querySelector(".composer");

    if (
      !composer ||
      composer.dataset.creationStudioReady
    ) {
      return;
    }

    composer.dataset.creationStudioReady = "1";

    const studio = document.createElement("div");
    studio.className = "milan-creation-studio";

    studio.innerHTML = `
      <div class="milan-creation-top">
        <div class="milan-creation-brand">
          <span class="milan-creation-mark">◈</span>
          <div class="milan-creation-title">
            <strong>Creation Studio</strong>
            <span>Compose a user-owned record</span>
          </div>
        </div>

        <span class="milan-creation-live">
          <i></i>
          READY
        </span>
      </div>

      <div class="milan-creation-tools">
        <button type="button" class="milan-create-tool" data-create="text">
          <span class="icon">✦</span>
          <span class="label">Text</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="media">
          <span class="icon">◫</span>
          <span class="label">Media</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="attach">
          <span class="icon">⌁</span>
          <span class="label">Attach</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="focus">
          <span class="icon">◎</span>
          <span class="label">Focus</span>
        </button>
      </div>

      <div class="milan-create-meta">
        <span class="item">
          Identity
          <strong>Self-owned</strong>
        </span>

        <span class="item">
          Storage
          <strong>DWN</strong>
        </span>

        <span class="item">
          Access
          <strong class="access-value">Private</strong>
        </span>

        <span class="milan-publish-state" hidden>
          <span class="spinner"></span>
          Publishing…
        </span>
      </div>
    `;

    composer.prepend(studio);

    const textarea =
      composer.querySelector("textarea");

    const mediaInput =
      document.getElementById("mediaFile");

    const publish =
      document.getElementById("publishBtn");

    const privacy =
      document.getElementById("privacy");

    const tools =
      studio.querySelectorAll(
        ".milan-create-tool"
      );

    const accessValue =
      studio.querySelector(".access-value");

    const setAccessLabel = () => {
      const map = {
        private: "Private",
        public: "Public",
        shared_did: "Shared DID"
      };

      if (accessValue) {
        accessValue.textContent =
          map[privacy?.value] ||
          "Private";
      }
    };

    tools.forEach(tool => {
      tool.addEventListener("click", () => {
        tools.forEach(item =>
          item.classList.remove("active")
        );

        tool.classList.add("active");

        const action =
          tool.dataset.create;

        if (action === "text") {
          textarea?.focus();
        }

        if (action === "media") {
          mediaInput?.click();
        }

        if (action === "attach") {
          const attach =
            document.getElementById(
              "milan-attach-input"
            );

          if (attach) {
            attach.click();
          } else {
            mediaInput?.click();
          }
        }

        if (action === "focus") {
          composer.scrollIntoView({
            behavior:"smooth",
            block:"center"
          });

          setTimeout(
            () => textarea?.focus(),
            280
          );
        }
      });
    });

    if (privacy) {
      privacy.addEventListener(
        "change",
        setAccessLabel
      );
    }

    textarea?.addEventListener(
      "focus",
      () => {
        studio.classList.add(
          "milan-creation-typing"
        );
      },
      {passive:true}
    );

    textarea?.addEventListener(
      "input",
      () => {
        studio.classList.add(
          "milan-creation-typing"
        );
      },
      {passive:true}
    );

    textarea?.addEventListener(
      "blur",
      () => {
        if (!textarea.value.trim()) {
          studio.classList.remove(
            "milan-creation-typing"
          );
        }
      },
      {passive:true}
    );

    mediaInput?.addEventListener(
      "change",
      () => {
        if (
          mediaInput.files?.length
        ) {
          studio.classList.add(
            "milan-creation-typing"
          );

          const meta =
            studio.querySelector(
              ".milan-create-meta"
            );

          if (meta) {
            const existing =
              meta.querySelector(
                ".milan-file-state"
              );

            existing?.remove();

            const state =
              document.createElement("span");

            state.className =
              "item milan-file-state";

            state.innerHTML =
              `Media <strong>${mediaInput.files.length} ready</strong>`;

            meta.appendChild(state);
          }
        }
      }
    );

    if (publish) {
      publish.addEventListener(
        "click",
        () => {
          const state =
            studio.querySelector(
              ".milan-publish-state"
            );

          if (!state) return;

          state.hidden = false;

          setTimeout(() => {
            state.hidden = true;
          }, 4000);
        },
        {capture:true}
      );
    }

    setAccessLabel();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initCreationStudio,
      {once:true}
    );
  } else {
    initCreationStudio();
  }

  setTimeout(
    initCreationStudio,
    1200
  );
})();

(() => {
  const initWritingMeter = () => {
    const composer = document.querySelector(".composer");
    const textarea = composer?.querySelector("textarea");

    if (
      !composer ||
      !textarea ||
      composer.dataset.writingMeterReady
    ) {
      return;
    }

    composer.dataset.writingMeterReady = "1";

    const meter = document.createElement("div");
    meter.className = "milan-writing-meter";

    meter.innerHTML = `
      <span class="count">0</span>
      <span class="bar"><span></span></span>
      <span class="hint">Ready</span>
    `;

    textarea.parentElement?.appendChild(
      meter
    );

    const count = meter.querySelector(".count");
    const fill = meter.querySelector(".bar span");
    const hint = meter.querySelector(".hint");

    const update = () => {
      const length =
        textarea.value.length;

      const percent =
        Math.min(
          100,
          (length / 500) * 100
        );

      count.textContent =
        `${length}`;

      fill.style.width =
        `${percent}%`;

      hint.textContent =
        length === 0
          ? "Ready"
          : length < 80
            ? "Draft"
            : length < 300
              ? "Good"
              : "Long-form";
    };

    textarea.addEventListener(
      "input",
      update,
      {passive:true}
    );

    update();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initWritingMeter,
      {once:true}
    );
  } else {
    initWritingMeter();
  }

  setTimeout(
    initWritingMeter,
    1400
  );
})();

/* ============================================================
   UI-8 Live network + navigation behavior
   ============================================================ */

(() => {
  const initLiveNetwork = () => {
    const health =
      document.getElementById("health");

    if (health && !health.parentElement?.querySelector(".milan-network-heartbeat")) {
      const badge =
        document.createElement("span");

      badge.className =
        "milan-network-heartbeat";

      badge.innerHTML = `
        <span class="dot"></span>
        <span>LIVE</span>
      `;

      health.parentElement?.appendChild(badge);
    }

    const notifications =
      document.querySelector(
        '.icon-btn[title="Notifications"]'
      );

    const notifCount =
      document.getElementById("notifCount");

    if (
      notifications &&
      notifCount &&
      !notifications.dataset.liveBadge
    ) {
      notifications.dataset.liveBadge = "1";
      notifications.style.position = "relative";

      const badge =
        document.createElement("span");

      badge.className =
        "milan-notification-badge";

      const syncBadge = () => {
        const value = parseInt(
          notifCount.textContent
            .replace(/\D/g, ""),
          10
        ) || 0;

        if (!value) {
          badge.remove();
          notifications.dataset.notifValue = "0";
          return;
        }

        if (!notifications.contains(badge)) {
          notifications.appendChild(badge);
        }

        badge.textContent =
          value > 99 ? "99+" : String(value);

        badge.classList.toggle(
          "pulse",
          value > 0
        );

        notifications.dataset.notifValue =
          String(value);
      };

      const observer =
        new MutationObserver(syncBadge);

      observer.observe(notifCount, {
        childList:true,
        subtree:true,
        characterData:true
      });

      syncBadge();
    }
  };

  const initScrollEffects = () => {
    const topbar =
      document.querySelector(".topbar");

    const progress =
      document.createElement("div");

    progress.className =
      "milan-scroll-progress";

    document.body.appendChild(progress);

    let ticking = false;

    const update = () => {
      const max =
        document.documentElement.scrollHeight -
        window.innerHeight;

      const current =
        max > 0
          ? window.scrollY / max
          : 0;

      progress.style.width =
        `${Math.max(0, Math.min(1, current)) * 100}%`;

      if (topbar) {
        topbar.classList.toggle(
          "scrolled",
          window.scrollY > 18
        );
      }

      ticking = false;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      {passive:true}
    );

    update();
  };

  const init = () => {
    initLiveNetwork();
    initScrollEffects();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }

  setTimeout(initLiveNetwork, 1200);
})();

(() => {
  const initNavState = () => {
    const buttons =
      document.querySelectorAll(
        ".nav button"
      );

    buttons.forEach(button => {
      if (button.dataset.visualNavReady) return;

      button.dataset.visualNavReady = "1";

      const text =
        button.textContent.trim();

      if (
        /notification/i.test(text) &&
        !button.querySelector(
          ".milan-nav-pulse"
        )
      ) {
        const pulse =
          document.createElement("span");

        pulse.className =
          "milan-nav-pulse";

        button.style.position =
          "relative";

        button.appendChild(pulse);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initNavState,
      {once:true}
    );
  } else {
    initNavState();
  }

  setTimeout(initNavState, 1000);
})();

/* ============================================================
   Web5 Network Constellation
   ============================================================ */

(() => {
  const initials = value =>
    String(value || "M")
      .trim()
      .split(/\s+/)
      .slice(0,2)
      .map(x => x[0] || "")
      .join("")
      .toUpperCase() || "M";

  const initNetworkMap = () => {
    if (document.querySelector(".milan-network-map")) return;

    const source =
      document.getElementById("peopleList") ||
      document.querySelector(".peopleList");

    const people = Array.from(
      source?.querySelectorAll(".person") || []
    ).slice(0, 6);

    if (!people.length) {
      return;
    }

    const host =
      document.querySelector(".rightbar") ||
      document.querySelector(".layout > section");

    if (!host) return;

    const card = document.createElement("div");
    card.className = "right-card card";
    card.dataset.networkMapCard = "1";

    card.innerHTML = `
      <div class="milan-feed-header">
        <div>
          <strong>Web5 Network</strong>
          <span>Your identity + connections</span>
        </div>
      </div>

      <div class="milan-network-map">
        <div class="milan-network-grid"></div>
        <svg class="milan-network-lines"
             viewBox="0 0 100 100"
             preserveAspectRatio="none">
        </svg>

        <div class="milan-network-status">
          <i></i>
          Decentralized space active
        </div>

        <div class="milan-network-count">
          ${people.length} visible connections
        </div>
      </div>
    `;

    host.appendChild(card);

    const map =
      card.querySelector(".milan-network-map");

    const svg =
      card.querySelector(".milan-network-lines");

    const positions = [
      [50,50],
      [22,28],
      [77,26],
      [18,68],
      [82,70],
      [50,18],
      [50,82]
    ];

    const central = document.createElement("div");
    central.className =
      "milan-network-node central";
    central.style.left = "50%";
    central.style.top = "50%";

    central.innerHTML = `
      <div class="core">M</div>
      <span class="milan-network-label">
        Your Identity
      </span>
    `;

    map.appendChild(central);

    people.forEach((person, index) => {
      const [x,y] =
        positions[index + 1] ||
        [
          15 + Math.random() * 70,
          15 + Math.random() * 70
        ];

      const name =
        person.querySelector("b")
          ?.textContent
          ?.trim() ||
        "Connection";

      const avatar =
        person.querySelector("img")
          ?.src || "";

      const node =
        document.createElement("div");

      node.className =
        "milan-network-node";

      node.style.left = `${x}%`;
      node.style.top = `${y}%`;

      node.innerHTML = `
        <div class="core">
          ${
            avatar
              ? `<img src="${avatar}" alt="">`
              : initials(name)
          }
        </div>
        <span class="milan-network-label">
          ${name}
        </span>
      `;

      node.title =
        `${name} • Web5 connection`;

      map.appendChild(node);

      const line =
        document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line"
        );

      line.setAttribute(
        "x1",
        "50"
      );
      line.setAttribute(
        "y1",
        "50"
      );
      line.setAttribute(
        "x2",
        String(x)
      );
      line.setAttribute(
        "y2",
        String(y)
      );

      line.classList.add(
        index % 2
          ? "pulse"
          : "strong"
      );

      svg.appendChild(line);
    });

    const title =
      card.querySelector(".milan-feed-header");

    title?.addEventListener(
      "click",
      () => {
        card.scrollIntoView({
          behavior:"smooth",
          block:"center"
        });
      }
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initNetworkMap,
      { once:true }
    );
  } else {
    initNetworkMap();
  }

  setTimeout(initNetworkMap, 1800);
})();

(() => {
  const bindNetworkInteraction = () => {
    const map =
      document.querySelector(
        ".milan-network-map"
      );

    if (
      !map ||
      map.dataset.interactionReady
    ) {
      return;
    }

    map.dataset.interactionReady = "1";

    const nodes =
      map.querySelectorAll(
        ".milan-network-node"
      );

    nodes.forEach(node => {
      node.addEventListener(
        "mouseenter",
        () => {
          nodes.forEach(other => {
            if (other !== node) {
              other.style.opacity = ".45";
            }
          });

          node.style.zIndex = "5";
        },
        { passive:true }
      );

      node.addEventListener(
        "mouseleave",
        () => {
          nodes.forEach(other => {
            other.style.opacity = "1";
          });

          node.style.zIndex = "";
        },
        { passive:true }
      );
    });
  };

  setTimeout(
    bindNetworkInteraction,
    2200
  );
})();

/* ============================================================
   MILAN — AI Command Center
   Visual command surface only.
   ============================================================ */

(() => {
  const initAICommand = () => {
    if (
      document.querySelector(".milan-ai-command")
    ) {
      return;
    }

    const host =
      document.querySelector(".composer") ||
      document.querySelector(".rightbar");

    if (!host) return;

    const panel =
      document.createElement("section");

    panel.className =
      "milan-ai-command";

    panel.innerHTML = `
      <div class="milan-ai-command-head">
        <div class="milan-ai-command-brand">
          <span class="milan-ai-command-icon">✦</span>

          <div class="milan-ai-command-title">
            <strong>MILAN Intelligence</strong>
            <span>Assist your Web5 space</span>
          </div>
        </div>

        <span class="milan-ai-status">
          <i></i>
          READY
        </span>
      </div>

      <label class="milan-ai-command-input">
        <span class="prompt">⌘</span>

        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Ask MILAN anything about your space…"
          aria-label="Ask MILAN"
        />

        <span class="shortcut">Enter</span>
      </label>

      <div class="milan-ai-suggestions">
        <button type="button" class="milan-ai-chip">
          ✦ Improve my post
        </button>

        <button type="button" class="milan-ai-chip">
          ◈ Explain my privacy
        </button>

        <button type="button" class="milan-ai-chip">
          ◎ Summarize my space
        </button>

        <button type="button" class="milan-ai-chip">
          ◌ What changed?
        </button>
      </div>

      <div class="milan-ai-result"></div>
    `;

    host.parentNode?.insertBefore(
      panel,
      host.nextSibling
    );

    const input =
      panel.querySelector("input");

    const result =
      panel.querySelector(
        ".milan-ai-result"
      );

    const suggestions =
      panel.querySelectorAll(
        ".milan-ai-chip"
      );

    const run = value => {
      const query =
        String(value || "").trim();

      if (!query) return;

      result.textContent =
        `MILAN is preparing a response for: “${query}”`;

      result.classList.add("show");
    };

    input.addEventListener(
      "keydown",
      event => {
        if (event.key !== "Enter") return;

        event.preventDefault();
        run(input.value);
      }
    );

    suggestions.forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const text =
            button.textContent
              .replace(/^[^\w]+/, "")
              .trim();

          input.value = text;
          input.focus();
          run(text);
        }
      );
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initAICommand,
      { once:true }
    );
  } else {
    initAICommand();
  }

  setTimeout(initAICommand, 1500);
})();

(() => {
  const focusAI = () => {
    const input =
      document.querySelector(
        ".milan-ai-command input"
      );

    if (!input) return;

    input.focus();
    input.select();
  };

  document.addEventListener(
    "keydown",
    event => {
      const target =
        event.target;

      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        event.key === "/" &&
        !typing
      ) {
        event.preventDefault();
        focusAI();
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        focusAI();
      }
    }
  );
})();

/* ============================================================
   Unified Identity Hub data layer
   ============================================================ */

(() => {
  const initUnifiedIdentityHub = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    if (!hero || hero.dataset.unifiedReady) {
      return;
    }

    hero.dataset.unifiedReady = "1";

    const did =
      document.getElementById("myDid");

    const dwn =
      document.getElementById("myDwn");

    const privacy =
      document.getElementById("privacyScore");

    if (!hero.querySelector(".milan-identity-metrics")) {
      const metrics =
        document.createElement("div");

      metrics.className =
        "milan-identity-metrics";

      metrics.innerHTML = `
        <div class="milan-identity-metric">
          <span class="label">Identity</span>
          <span class="value good">Active</span>
        </div>

        <div class="milan-identity-metric">
          <span class="label">Storage</span>
          <span class="value dwn">DWN</span>
        </div>

        <div class="milan-identity-metric">
          <span class="label">Privacy</span>
          <span class="value privacy">100%</span>
        </div>
      `;

      hero.appendChild(metrics);
    }

    const didBox =
      hero.querySelector(".milan-identity-did");

    if (!didBox) {
      const box =
        document.createElement("div");

      box.className =
        "milan-identity-did";

      box.innerHTML = `
        <div class="label">
          Decentralized Identifier
        </div>
        <div class="value did-value">
          Resolving identity…
        </div>
      `;

      hero.appendChild(box);
    }

    const footer =
      hero.querySelector(".milan-identity-footer");

    const sync = () => {
      const didValue =
        did?.textContent.trim();

      const dwnValue =
        dwn?.textContent
          .replace(/^Cloud DWN:\s*/i,"")
          .trim();

      const privacyValue =
        privacy?.textContent.trim();

      const didTarget =
        hero.querySelector(
          ".did-value"
        );

      const dwnTarget =
        hero.querySelector(
          ".value.dwn"
        );

      const privacyTarget =
        hero.querySelector(
          ".value.privacy"
        );

      if (didTarget && didValue) {
        didTarget.textContent =
          didValue;
      }

      if (dwnTarget) {
        dwnTarget.textContent =
          dwnValue || "DWN";
      }

      if (privacyTarget) {
        privacyTarget.textContent =
          privacyValue || "100%";
      }

      if (footer) {
        const network =
          footer.querySelector(".network");

        if (network) {
          network.innerHTML =
            `Network <b>Private-first</b>`;
        }
      }
    };

    const observer =
      new MutationObserver(sync);

    [did,dwn,privacy]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element,{
          childList:true,
          subtree:true,
          characterData:true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initUnifiedIdentityHub,
      {once:true}
    );
  } else {
    initUnifiedIdentityHub();
  }

  setTimeout(
    initUnifiedIdentityHub,
    1000
  );

  setTimeout(
    initUnifiedIdentityHub,
    1800
  );
})();

(() => {
  const syncIdentityName = () => {
    const source =
      document.getElementById("myName");

    const target =
      document.querySelector(
        ".milan-profile-name"
      );

    if (!source || !target) return;

    const value =
      source.textContent.trim();

    if (
      value &&
      value !== "MILAN User"
    ) {
      target.textContent =
        value;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      syncIdentityName,
      {once:true}
    );
  } else {
    syncIdentityName();
  }

  setInterval(
    syncIdentityName,
    1500
  );
})();

/* ============================================================
   Profile photo upload — Identity Hero control
   ============================================================ */

(() => {
  const initHeroUpload = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    const input =
      document.getElementById("editProfilePhoto");

    const orbit =
      hero?.querySelector(
        ".milan-profile-avatar-orbit"
      );

    if (
      !hero ||
      !input ||
      !orbit ||
      hero.dataset.heroUploadReady
    ) {
      return;
    }

    hero.dataset.heroUploadReady = "1";

    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "milan-profile-upload";
    button.title =
      "Change profile picture";
    button.setAttribute(
      "aria-label",
      "Change profile picture"
    );
    button.textContent = "📷";

    button.addEventListener(
      "click",
      () => input.click()
    );

    orbit.appendChild(button);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initHeroUpload,
      {once:true}
    );
  } else {
    initHeroUpload();
  }

  setTimeout(
    initHeroUpload,
    1000
  );

  setTimeout(
    initHeroUpload,
    1800
  );
})();
