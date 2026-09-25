/* ============================================================
   MILAN — Web5 Motion Engine
   Safe interaction layer
   ============================================================ */

"use strict";

(() => {
  const finePointer =
    window.matchMedia("(pointer:fine)").matches;

  function initPointerLight() {
    if (!finePointer) return;

    const light =
      document.createElement("div");

    light.className =
      "milan-pointer-light";

    document.body.appendChild(light);

    let raf = 0;
    let x = 0;
    let y = 0;

    document.addEventListener(
      "pointermove",
      event => {
        x = event.clientX;
        y = event.clientY;

        if (raf) return;

        raf = requestAnimationFrame(() => {
          light.style.left = `${x}px`;
          light.style.top = `${y}px`;
          light.style.opacity = "1";
          raf = 0;
        });
      },
      { passive:true }
    );

    document.addEventListener(
      "pointerleave",
      () => {
        light.style.opacity = "0";
      },
      { passive:true }
    );
  }

  function initReveals() {
    const selector = [
      ".post",
      ".milan-feed-card",
      ".right-card",
      ".composer",
      ".sidebar"
    ].join(",");

    const elements =
      document.querySelectorAll(selector);

    elements.forEach((element, index) => {
      if (element.dataset.motionReady) return;

      element.dataset.motionReady = "1";
      element.classList.add("milan-reveal");

      element.style.transitionDelay =
        `${Math.min(index * 35, 180)}ms`;
    });

    if (!("IntersectionObserver" in window)) {
      elements.forEach(element =>
        element.classList.add("milan-visible")
      );
      return;
    }

    const observer =
      new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            entry.target.classList.add(
              "milan-visible"
            );

            observer.unobserve(
              entry.target
            );
          });
        },
        {
          root:null,
          rootMargin:"0px 0px -6% 0px",
          threshold:0.04
        }
      );

    elements.forEach(element =>
      observer.observe(element)
    );
  }

  function initCardFocus() {
    const selector = [
      ".post",
      ".milan-feed-card",
      ".right-card",
      ".composer"
    ].join(",");

    document.addEventListener(
      "pointerover",
      event => {
        if (!finePointer) return;

        const card =
          event.target.closest(selector);

        if (!card) return;

        card.classList.add(
          "milan-card-focus"
        );
      },
      { passive:true }
    );

    document.addEventListener(
      "pointerout",
      event => {
        const card =
          event.target.closest(selector);

        if (!card) return;

        if (
          event.relatedTarget &&
          card.contains(event.relatedTarget)
        ) {
          return;
        }

        card.classList.remove(
          "milan-card-focus"
        );
      },
      { passive:true }
    );
  }

  function initButtonPress() {
    document.addEventListener(
      "pointerdown",
      event => {
        const button =
          event.target.closest("button");

        if (!button) return;

        button.classList.remove(
          "milan-press"
        );

        void button.offsetWidth;

        button.classList.add(
          "milan-press"
        );

        setTimeout(() => {
          button.classList.remove(
            "milan-press"
          );
        }, 180);
      },
      { passive:true }
    );
  }

  function initHeaderDepth() {
    const header =
      document.querySelector(".topbar");

    if (!header) return;

    let ticking = false;

    const update = () => {
      header.classList.toggle(
        "milan-scrolled",
        window.scrollY > 16
      );

      ticking = false;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;

        ticking = true;

        requestAnimationFrame(update);
      },
      { passive:true }
    );

    update();
  }

  function initLiveState() {
    const targets =
      document.querySelectorAll(
        '[title="Notifications"],' +
        '.publish,' +
        '.right-card'
      );

    targets.forEach(element => {
      if (
        element.dataset.liveMotion
      ) {
        return;
      }

      element.dataset.liveMotion = "1";
    });
  }

  function init() {
    initPointerLight();
    initReveals();
    initCardFocus();
    initButtonPress();
    initHeaderDepth();
    initLiveState();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once:true }
    );
  } else {
    init();
  }

  /* Feed is dynamic, so re-run only the reveal scan. */
  const feed =
    document.getElementById("feed");

  if (
    feed &&
    "MutationObserver" in window
  ) {
    let timer = 0;

    const observer =
      new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
          initReveals();
        }, 100);
      });

    observer.observe(feed, {
      childList:true
    });
  }
})();
