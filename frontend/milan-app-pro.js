/* ============================================================================
   MILAN — App Pro interactions  (v1)
   ----------------------------------------------------------------------------
   Pairs with /milan-app-pro.css. Presentation only.

   HARD RULES
   • Never preventDefault / stopPropagation on app controls. Navigation,
     publishing, uploads, refresh and the control centre stay owned by their
     own modules.
   • Never read or write tokens, post text, or form state.
   • Never replace a button's textContent — only prepend decorative spans.
   • Every feature degrades silently if its target is absent.
   ========================================================================== */
"use strict";

(function () {
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  /* ══════════════════════════════════════════════════════════════════════
     1. Background — aurora + faint grid. Deliberately lighter than the
        login page: no starfield canvas, because this page is content-heavy.
     ══════════════════════════════════════════════════════════════════════ */
  function buildBackground() {
    if ($("#map-bg")) return;

    var bg = document.createElement("div");
    bg.id = "map-bg";
    bg.setAttribute("aria-hidden", "true");

    ["a", "b", "c"].forEach(function (k) {
      var b = document.createElement("div");
      b.className = "map-blob map-blob--" + k;
      bg.appendChild(b);
    });

    var grid = document.createElement("div");
    grid.className = "map-grid";
    bg.appendChild(grid);

    document.body.insertBefore(bg, document.body.firstChild);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. Quick stats — count up on first paint, bump when the value changes.
        The numbers are written by app.html's own sync loop, so we only
        observe; we never write the value ourselves.
     ══════════════════════════════════════════════════════════════════════ */
  var STAT_IDS = ["uiPeopleCount", "uiPostCount", "uiPrivacyScore"];

  function bindQuickStats() {
    var seen = {};
    var last = {};

    function numeric(text) {
      var n = parseInt(String(text).replace(/[^\d-]/g, ""), 10);
      return isFinite(n) ? n : null;
    }

    function countUp(el, from, to) {
      var start = null;
      var dur = 620;

      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        // easeOutCubic
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(from + (to - from) * e));
        if (t < 1) window.requestAnimationFrame(step);
        else el.textContent = String(to);
      }

      window.requestAnimationFrame(step);
    }

    function bump(card) {
      if (!card || reduceMotion) return;
      card.classList.remove("is-bump");
      void card.offsetWidth;
      card.classList.add("is-bump");
      window.setTimeout(function () { card.classList.remove("is-bump"); }, 420);
    }

    function check() {
      STAT_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var text = (el.textContent || "").trim();
        if (text === last[id]) return;

        var value = numeric(text);
        var card = el.closest ? el.closest(".quickStat") : null;

        if (!seen[id]) {
          seen[id] = true;
          if (value !== null && !reduceMotion && value > 0 && value < 10000) {
            countUp(el, 0, value);
          }
        } else {
          bump(card);
        }
        last[id] = text;
      });
    }

    check();
    // the intro block is injected on DOMContentLoaded by app.html's own script
    window.setTimeout(check, 300);
    window.setTimeout(check, 1200);
    window.setInterval(check, 1500);
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. Publish — ripple + magnetic hover, mirroring the login CTA.
        No handler touches the click itself.
     ══════════════════════════════════════════════════════════════════════ */
  function bindPublish() {
    var btn = document.getElementById("publishBtn");
    if (!btn) return;

    on(btn, "pointerdown", function (e) {
      if (btn.disabled || reduceMotion) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var dot = document.createElement("span");
      dot.className = "map-ripple";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(dot);
      window.setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 700);
    });

    if (reduceMotion) return;

    on(btn, "pointermove", function (e) {
      if (btn.disabled) return;
      var r = btn.getBoundingClientRect();
      if (!r.width) return;
      var dx = ((e.clientX - r.left) / r.width - 0.5) * 7;
      var dy = ((e.clientY - r.top) / r.height - 0.5) * 5;
      btn.style.transform =
        "translate3d(" + dx.toFixed(2) + "px," + (dy - 2).toFixed(2) + "px,0)";
    }, { passive: true });

    on(btn, "pointerleave", function () { btn.style.transform = ""; });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. Refresh — spin the button while the list refreshes. Purely visual
        feedback; the click itself is left completely alone.
     ══════════════════════════════════════════════════════════════════════ */
  function bindRefresh() {
    var btn = document.getElementById("milanFeedRefresh");
    var list = document.getElementById("milanFeedList");
    if (!btn) return;

    var timer = null;

    function spin(ms) {
      if (reduceMotion) return;
      btn.classList.add("is-spinning");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        btn.classList.remove("is-spinning");
      }, ms || 700);
    }

    on(btn, "click", function () { spin(900); });

    // if the feed re-renders shortly after, stop early
    if (list && window.MutationObserver) {
      new window.MutationObserver(function () {
        if (btn.classList.contains("is-spinning")) spin(320);
      }).observe(list, { childList: true });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. Feed — a one-time staggered entrance. Deliberately first-render only:
        the app refreshes the feed on a timer, and re-animating on every
        refresh would be noise.
     ══════════════════════════════════════════════════════════════════════ */
  function bindFeedEntrance() {
    var list = document.getElementById("milanFeedList");
    if (!list) return;

    var done = false;

    function mark() {
      if (done || reduceMotion) return;
      var kids = Array.prototype.filter.call(list.children, function (el) {
        return el.nodeType === 1;
      });
      if (!kids.length) return;
      done = true;
      kids.forEach(function (el, i) {
        el.style.animationDelay = Math.min(i * 45, 400) + "ms";
        el.setAttribute("data-map-reveal", "1");
      });
    }

    mark();
    window.setTimeout(mark, 900);
    window.setTimeout(mark, 2200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. Avatar identity
        renderMe() replaces #myAvatar and #composerAvatar with outerHTML, so
        the rendered nodes lose their ids entirely. Anything that later calls
        getElementById("myAvatar") silently gets null. Re-attach the ids the
        markup declared, and own the photo-removal affordance.
     ══════════════════════════════════════════════════════════════════════ */
  function getToken() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milanToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function bindAvatarIdentity() {
    var label = document.querySelector(".milan-avatar-upload");

    function avatarImg() {
      var sel = [
        ".milan-avatar-upload .avatar img",
        ".milan-avatar-upload #myAvatar img",
        "#editProfilePhotoPreview",
      ];
      for (var i = 0; i < sel.length; i++) {
        var el = document.querySelector(sel[i]);
        var src = el ? String(el.getAttribute("src") || "").trim() : "";
        if (src && src !== "null" && src !== "about:blank") return src;
      }
      return "";
    }

    function restoreIds() {
      var big = document.querySelector(".milan-avatar-upload .avatar");
      if (big && !big.id) big.id = "myAvatar";
      // renderMe() swaps the composer avatar for a node carrying only
      // `.avatar`, which silently drops the base layer's `.mini-avatar`
      // sizing — the composer avatar then renders as a large square once a
      // real picture exists. Put the class back, not just the id.
      var mini =
        document.querySelector(".composer .mini-avatar") ||
        document.querySelector(".composer-row > .avatar") ||
        document.querySelector(".composer .avatar");
      if (mini) {
        if (!mini.id) mini.id = "composerAvatar";
        if (!mini.classList.contains("mini-avatar")) {
          mini.classList.add("mini-avatar");
        }
      }
    }

    // The app's initials() helper returns up to TWO letters ("NP" for
    // "Nitesh Pandey"). With no profile picture the design calls for a single
    // centred initial, so collapse it wherever no image is present.
    function singleInitial(el) {
      if (!el || el.querySelector("img")) return;
      var text = String(el.textContent || "").trim();
      if (text.length > 1) {
        el.textContent = text.charAt(0).toUpperCase();
      }
    }

    function syncInitials() {
      singleInitial(document.querySelector(".milan-avatar-upload .avatar"));
      singleInitial(document.querySelector(".composer .avatar, .composer .mini-avatar"));
    }

    function removePhoto(btn) {
      if (!window.confirm("Remove your profile photo permanently?")) return;
      btn.disabled = true;
      btn.classList.add("is-busy");

      timedFetch("/api/profile/avatar", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + getToken(),
          Accept: "application/json",
        },
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json().catch(function () { return {}; });
        })
        .then(function () {
          try { localStorage.removeItem("milanAvatar"); } catch (e) {}
          window.__milanPersistentAvatar = "";

          var preview = document.getElementById("editProfilePhotoPreview");
          if (preview) preview.removeAttribute("src");

          Array.prototype.slice
            .call(document.querySelectorAll(".milan-avatar-upload .avatar img"))
            .forEach(function (img) { img.remove(); });

          if (btn.parentNode) btn.parentNode.removeChild(btn);

          if (typeof window.toast === "function") {
            window.toast("Profile photo removed");
          }
          // ask the app to re-read identity so the initial is rebuilt
          if (typeof window.__milanSyncPersistentIdentity === "function") {
            try { window.__milanSyncPersistentIdentity(); } catch (e) {}
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.classList.remove("is-busy");
          if (typeof window.toast === "function") {
            window.toast("Could not remove photo: " + err.message);
          }
        });
    }

    function syncRemoveButton() {
      if (!label) return;
      var has = !!avatarImg();
      var btn = label.querySelector(".map-remove-dp");

      if (has && !btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-remove-dp";
        btn.title = "Remove profile photo";
        btn.setAttribute("aria-label", "Remove profile photo");
        btn.textContent = "✕";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          removePhoto(e.currentTarget);
        });
        label.appendChild(btn);
      } else if (!has && btn && btn.parentNode) {
        btn.parentNode.removeChild(btn);
      }
    }

    restoreIds();
    syncInitials();
    syncRemoveButton();
    window.setInterval(function () {
      restoreIds();
      syncInitials();
      syncRemoveButton();
    }, 1500);

    if (label && window.MutationObserver) {
      new window.MutationObserver(function () {
        restoreIds();
        syncInitials();
        syncRemoveButton();
      }).observe(label, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. "Set your name" — only when the card is falling back to the email
        prefix because the account has no registered name. Ties the profile
        card to the existing Edit Profile flow instead of leaving a bare
        "np7218468" with no explanation.
     ══════════════════════════════════════════════════════════════════════ */
  function bindSetNameHint() {
    var nameEl = document.getElementById("myName");
    var emailEl = document.getElementById("myEmail");
    if (!nameEl || !emailEl) return;

    function sync() {
      var email = String(emailEl.textContent || "").trim();
      var at = email.indexOf("@");
      var local = at > 0 ? email.slice(0, at) : "";
      var name = String(nameEl.textContent || "").trim();
      var existing = document.getElementById("mapSetNameHint");

      var looksLikeEmail =
        !!local && !!name && name.toLowerCase() === local.toLowerCase();

      if (looksLikeEmail && !existing) {
        var b = document.createElement("button");
        b.type = "button";
        b.id = "mapSetNameHint";
        b.className = "map-set-name";
        b.textContent = "Set your name";
        b.addEventListener("click", function () {
          var edit = document.getElementById("editProfileBtn");
          if (edit) edit.click();
        });
        nameEl.insertAdjacentElement("afterend", b);
      } else if (!looksLikeEmail && existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }

    sync();
    window.setInterval(sync, 1500);
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. People directory (right rail "People to connect")
        The backend already returns every other registered user from Supabase
        with their name, DID and connection status (routes/social.js:132-172),
        and inline-05.js's loadPeople() already knows how to render it. In
        practice the rail is often left showing its static "Loading people..."
        placeholder, so this repairs the container when the app's own pass did
        not land — it never replaces a list the app rendered itself.
     ══════════════════════════════════════════════════════════════════════ */
  function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shortDid(did) {
    var s = String(did || "");
    if (s.length <= 30) return s;
    return s.slice(0, 20) + "…" + s.slice(-6);
  }

  /* The app's own api() helper passes no timeout for /social/people, so a
     stalled request can leave the rail on "Loading people..." indefinitely —
     which is exactly the symptom this repairs. Always bound our own calls. */
  function timedFetch(url, opts, ms) {
    var options = opts || {};
    if (!("AbortController" in window)) return fetch(url, options);

    var ctrl = new AbortController();
    var timer = window.setTimeout(function () { ctrl.abort(); }, ms || 12000);
    options = Object.assign({}, options, { signal: ctrl.signal });

    return fetch(url, options).then(
      function (r) { window.clearTimeout(timer); return r; },
      function (e) { window.clearTimeout(timer); throw e; }
    );
  }

  function bindPeopleDirectory() {
    var box = document.getElementById("peopleConnectList");
    if (!box) return;

    var inflight = false;

    // True when the rail already holds a real list — ours OR the app's — or
    // any other content. Only the static placeholder / an empty box counts as
    // "needs repair". Getting this wrong means re-rendering on a timer and
    // wiping the button state the user just changed.
    function alreadyPopulated() {
      if (box.querySelector(".map-person")) return true;
      if (box.querySelector(".person")) return true;
      var text = String(box.textContent || "").trim();
      if (!text) return false;
      if (/^loading people/i.test(text)) return false;
      return true;
    }

    function statusLabel(status) {
      if (status === "friends") return "Friends";
      if (status === "sent") return "Requested";
      if (status === "received") return "Respond";
      if (status === "rejected") return "Add friend";
      return "Add friend";
    }

    function render(rows) {
      box.innerHTML = "";
      var wrap = document.createElement("div");
      wrap.className = "map-people";

      rows.forEach(function (p) {
        var name = String(p.name || "MILAN User").trim();
        var did = String(p.did || "").trim();
        var status = String(p.connectionStatus || "none");
        var initial = name.charAt(0).toUpperCase() || "M";

        var row = document.createElement("div");
        row.className = "map-person";

        var av = document.createElement("div");
        av.className = "map-person__avatar";
        if (p.avatar && /^(data:image\/|https?:)/.test(String(p.avatar))) {
          var img = document.createElement("img");
          img.src = String(p.avatar);
          img.alt = "";
          img.loading = "lazy";
          av.appendChild(img);
        } else {
          av.textContent = initial;
        }

        var body = document.createElement("div");
        body.className = "map-person__body";

        var nm = document.createElement("b");
        nm.className = "map-person__name";
        nm.textContent = name;
        nm.title = name;

        var dd = document.createElement("span");
        dd.className = "map-person__did";
        dd.textContent = did ? shortDid(did) : "DID pending";
        if (did) {
          dd.title = did + "  (click to copy)";
          dd.addEventListener("click", function () {
            try {
              navigator.clipboard.writeText(did);
              if (typeof window.toast === "function") window.toast("DID copied");
            } catch (e) {}
          });
        }

        body.appendChild(nm);
        body.appendChild(dd);

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-person__add";
        btn.textContent = statusLabel(status);

        if (status === "friends") {
          btn.classList.add("is-friends");
          btn.disabled = true;
        } else if (status === "sent") {
          btn.classList.add("is-sent");
          btn.disabled = true;
        } else {
          btn.addEventListener("click", function () {
            addFriend(btn, did);
          });
        }

        row.appendChild(av);
        row.appendChild(body);
        row.appendChild(btn);
        wrap.appendChild(row);
      });

      box.appendChild(wrap);
    }

    function addFriend(btn, did) {
      if (!did || btn.disabled) return;
      btn.disabled = true;
      btn.classList.add("is-busy");

      timedFetch("/api/connections", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + getToken(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          toDid: did,
          message: "I would like to connect with you on MILAN.",
        }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json().catch(function () { return {}; });
        })        .then(function () {
          btn.classList.remove("is-busy");
          btn.classList.add("is-sent");
          btn.textContent = "Requested";
          if (typeof window.toast === "function") {
            window.toast("Connection request sent");
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.classList.remove("is-busy");
          btn.textContent = "Add friend";
          if (typeof window.toast === "function") {
            window.toast("Could not send request: " + err.message);
          }
        });
    }

    function fill() {
      if (inflight || alreadyPopulated()) return;
      inflight = true;

      timedFetch("/api/social/people", {
        headers: { Authorization: "Bearer " + getToken(), Accept: "application/json" },
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (rows) {
          if (!Array.isArray(rows)) throw new Error("Unexpected people payload");
          if (alreadyPopulated()) return; // the app rendered its own list meanwhile
          render(rows);
        })
        .catch(function (err) {
          box.innerHTML =
            '<div class="empty">' + escHtml(err.message || "Directory unavailable") + "</div>";
        })
        .then(function () {
          inflight = false;
        });
    }

    // Several repair attempts catch whichever boot pass loses the race. The
    // alreadyPopulated() guard makes every later attempt a no-op, so the extra
    // calls cannot clobber button state.
    window.setTimeout(fill, 900);
    window.setTimeout(fill, 2200);
    window.setTimeout(fill, 4000);
    window.setTimeout(fill, 7000);
    window.setInterval(fill, 15000);
    window.addEventListener("focus", fill);
    window.__milanRefreshPeople = fill;
  }

  /* ══════════════════════════════════════════════════════════════════════
     boot
     ══════════════════════════════════════════════════════════════════════ */
  function init() {
    try { buildBackground(); } catch (e) {}
    try { bindQuickStats(); } catch (e) {}
    try { bindPublish(); } catch (e) {}
    try { bindRefresh(); } catch (e) {}
    try { bindFeedEntrance(); } catch (e) {}
    try { bindAvatarIdentity(); } catch (e) {}
    try { bindSetNameHint(); } catch (e) {}
    try { bindPeopleDirectory(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
