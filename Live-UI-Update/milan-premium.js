/* ============================================================
   MILAN Premium — upgrade + Razorpay checkout (static add-on)
   Loaded by app.html. Self-contained, no build step, no deps.

   GO LIVE (real payments):
     1. Set window.MILAN_RAZORPAY_KEY below (or define it before this
        script loads) to your Razorpay Key ID (rzp_live_... / rzp_test_...).
     2. Implement backend routes (milan-app/backend):
          POST /api/billing/order   -> create Razorpay order  { id, amount }
          POST /api/billing/verify  -> verify razorpay_signature (HMAC-SHA256)
     3. Make sure server.js CSP allows checkout.razorpay.com (done in this update).
   Without a key it runs in DEMO mode: a realistic simulated success so the
   whole flow is testable. No real charge in demo mode.
   ============================================================ */
(function () {
  "use strict";
  if (window.__milanPremiumLoaded) return;
  window.__milanPremiumLoaded = true;

  /* ── Config ───────────────────────────────────────────── */
  var RAZORPAY_KEY = window.MILAN_RAZORPAY_KEY || "";   // empty => demo mode
  var DEMO = !RAZORPAY_KEY;
  var API_BASE = window.MILAN_API_BASE || "";           // same-origin by default
  var STORE_KEY = "milan_premium";

  var PLANS = {
    premium: {
      id: "premium",
      name: "MILAN Premium",
      tagline: "The full self-sovereign experience.",
      price: { monthly: 199, annual: 1499 }
    }
  };

  var PERKS = [
    ["✔", "Gold verified badge"],
    ["🤖", "Unlimited MILAN AI"],
    ["📊", "Creator analytics"],
    ["☁", "100 GB DWN storage"],
    ["🎨", "Premium themes"],
    ["🚫", "No ads, ever"],
    ["✨", "Early access drops"],
    ["🎧", "24×7 priority support"]
  ];

  /* ── Helpers ──────────────────────────────────────────── */
  function inr(n) {
    try {
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    } catch (e) { return "₹" + n; }
  }
  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function annualSavePct(p) {
    var year = p.price.monthly * 12;
    return year ? Math.round((1 - p.price.annual / year) * 100) : 0;
  }
  function monthlyEq(p) { return Math.round(p.price.annual / 12); }

  /* ── Entitlement (localStorage) ───────────────────────── */
  function getEntitlement() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }
  function setEntitlement(e) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(e)); } catch (x) {}
    applyPremiumState();
  }
  function isPremium() { var e = getEntitlement(); return !!(e && e.plan && e.plan !== "free"); }

  /* best-effort current user (for Razorpay prefill) */
  function currentUser() {
    var name = "", email = "";
    try {
      var n = document.querySelector(".profileCard .name, .profileRow .name, #profileName");
      if (n) name = (n.textContent || "").trim();
      var stored = JSON.parse(localStorage.getItem("milan_user") || localStorage.getItem("user") || "null");
      if (stored) { name = name || stored.display_name || stored.name || ""; email = stored.email || ""; }
    } catch (e) {}
    return { name: name, email: email };
  }

  /* ── Razorpay loader ──────────────────────────────────── */
  var sdkPromise = null;
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve(true);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.body.appendChild(s);
    });
    return sdkPromise;
  }

  function createOrder(amountPaise) {
    return fetch(API_BASE + "/api/billing/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR" })
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function verifyPayment(resp) {
    return fetch(API_BASE + "/api/billing/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resp)
    }).then(function (r) { return r.ok; }).catch(function () { return true; });
  }

  /* returns a Promise<{ok, paymentId, demo}> ; rejects on cancel/fail */
  function startCheckout(plan, cycle) {
    var paise = plan.price[cycle] * 100;

    if (DEMO) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ ok: true, paymentId: "demo_pay_" + Math.random().toString(36).slice(2, 12), demo: true });
        }, 1400);
      });
    }

    return loadRazorpay().then(function (ready) {
      if (!ready) throw new Error("Could not load the payment gateway. Check your connection.");
      return createOrder(paise).then(function (order) {
        var u = currentUser();
        return new Promise(function (resolve, reject) {
          var opts = {
            key: RAZORPAY_KEY,
            amount: paise,
            currency: "INR",
            name: "MILAN Premium",
            description: plan.name + " · " + (cycle === "annual" ? "Annual" : "Monthly"),
            order_id: order ? order.id : undefined,
            prefill: { name: u.name, email: u.email },
            theme: { color: "#d8b35a", backdrop_color: "#0a0b12" },
            notes: { plan: plan.id, cycle: cycle },
            handler: function (resp) {
              verifyPayment(resp).then(function (ok) {
                resolve({ ok: ok, paymentId: resp.razorpay_payment_id, demo: false });
              });
            },
            modal: { ondismiss: function () { reject(new Error("__cancelled__")); } }
          };
          try {
            var rzp = new window.Razorpay(opts);
            rzp.on("payment.failed", function (r) { reject(new Error((r && r.error && r.error.description) || "Payment failed.")); });
            rzp.open();
          } catch (e) { reject(new Error("Could not open the payment gateway.")); }
        });
      });
    });
  }

  /* ── Modal UI ─────────────────────────────────────────── */
  var overlay = null, state = { cycle: "annual" };

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("mp-open");
    var o = overlay;
    setTimeout(function () { if (o && o.parentNode) o.parentNode.removeChild(o); }, 260);
    overlay = null;
    document.body.style.overflow = "";
  }

  function openModal() {
    if (overlay) return;
    if (isPremium()) { renderManage(); return; }
    state.cycle = "annual";
    overlay = el('<div class="mp-overlay" role="dialog" aria-modal="true" aria-label="Upgrade to MILAN Premium"><div class="mp-modal"><button class="mp-close" aria-label="Close">×</button><div class="mp-modal-pad" id="mpBody"></div></div></div>');
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    overlay.querySelector(".mp-close").addEventListener("click", closeModal);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { overlay.classList.add("mp-open"); });
    document.addEventListener("keydown", escClose);
    renderReview();
  }
  function escClose(e) { if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", escClose); } }

  function body() { return overlay && overlay.querySelector("#mpBody"); }

  function renderReview() {
    var b = body(); if (!b) return;
    var p = PLANS.premium, cyc = state.cycle, save = annualSavePct(p);
    var perks = PERKS.map(function (x) {
      return '<li><span class="mp-ic">' + x[0] + '</span>' + x[1] + '</li>';
    }).join("");
    b.innerHTML =
      '<div class="mp-hero">' +
        '<div class="mp-hero-crown">👑</div>' +
        '<h2>Upgrade to <span class="mp-gold-text">Premium</span></h2>' +
        '<p>' + p.tagline + '</p>' +
      '</div>' +
      '<div class="mp-toggle" id="mpToggle">' +
        '<button data-c="monthly" class="' + (cyc === "monthly" ? "mp-active" : "") + '">Monthly</button>' +
        '<button data-c="annual" class="' + (cyc === "annual" ? "mp-active" : "") + '">Annual' +
          (save > 0 ? '<span class="mp-save">-' + save + '%</span>' : '') + '</button>' +
      '</div>' +
      '<div class="mp-price"><b>' + inr(p.price[cyc]) + '</b><span>/' + (cyc === "annual" ? "year" : "month") + '</span></div>' +
      (cyc === "annual" ? '<p class="mp-sub">Just ' + inr(monthlyEq(p)) + '/mo · billed annually</p>' : '') +
      '<ul class="mp-perks">' + perks + '</ul>' +
      '<button class="mp-pay mp-shimmer" id="mpPay">🔒 Pay ' + inr(p.price[cyc]) + ' securely</button>' +
      '<p class="mp-secure">' + (DEMO
        ? 'Demo mode · <b>no real charge</b>'
        : '<b>Secured by Razorpay</b> · UPI, cards, netbanking') + '</p>';

    b.querySelector("#mpToggle").addEventListener("click", function (e) {
      var t = e.target.closest("button[data-c]"); if (!t) return;
      state.cycle = t.getAttribute("data-c"); renderReview();
    });
    b.querySelector("#mpPay").addEventListener("click", pay);
  }

  function renderProcessing() {
    var b = body(); if (!b) return;
    var p = PLANS.premium;
    b.innerHTML =
      '<div class="mp-state">' +
        '<div class="mp-pulse"><div class="mp-spin"></div></div>' +
        '<h2 style="margin-top:26px;font-size:16px">' + (DEMO ? "Simulating secure payment…" : "Opening secure gateway…") + '</h2>' +
        '<p>' + inr(p.price[state.cycle]) + ' · ' + p.name + ' · ' + state.cycle + '<br><span style="font-size:11px;opacity:.7">Please don\'t close this window.</span></p>' +
      '</div>';
  }

  function renderSuccess() {
    var b = body(); if (!b) return;
    var p = PLANS.premium;
    b.innerHTML =
      '<div class="mp-state">' +
        '<div class="mp-tick">✓</div>' +
        '<h2>Welcome to Premium ✨</h2>' +
        '<p>Your ' + p.name + ' (' + state.cycle + ') is now active. Your gold badge is live across MILAN.</p>' +
        '<button class="mp-pay" id="mpDone" style="margin-top:24px">Explore Premium</button>' +
      '</div>';
    b.querySelector("#mpDone").addEventListener("click", closeModal);
  }

  function renderError(msg) {
    var b = body(); if (!b) return;
    b.innerHTML =
      '<div class="mp-state">' +
        '<div class="mp-cross">!</div>' +
        '<h2>Payment didn\'t go through</h2>' +
        '<p>' + (msg || "Something went wrong.") + '</p>' +
        '<div class="mp-row"><button class="mp-ghost" id="mpBack">Back</button><button class="mp-pay" id="mpRetry" style="margin-top:0">Try again</button></div>' +
      '</div>';
    b.querySelector("#mpBack").addEventListener("click", renderReview);
    b.querySelector("#mpRetry").addEventListener("click", pay);
  }

  function renderManage() {
    if (!overlay) {
      overlay = el('<div class="mp-overlay" role="dialog" aria-modal="true"><div class="mp-modal"><button class="mp-close" aria-label="Close">×</button><div class="mp-modal-pad" id="mpBody"></div></div></div>');
      overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
      overlay.querySelector(".mp-close").addEventListener("click", closeModal);
      document.body.appendChild(overlay);
      document.body.style.overflow = "hidden";
      requestAnimationFrame(function () { overlay.classList.add("mp-open"); });
    }
    var e = getEntitlement() || {};
    var since = e.since ? new Date(e.since).toLocaleDateString("en-IN") : "—";
    body().innerHTML =
      '<div class="mp-hero">' +
        '<div class="mp-hero-crown">👑</div>' +
        '<h2 class="mp-gold-text">You\'re Premium</h2>' +
        '<p>Active since ' + since + ' · ' + (e.cycle || "annual") + ' plan</p>' +
      '</div>' +
      '<ul class="mp-perks" style="margin-top:22px">' +
        PERKS.map(function (x) { return '<li><span class="mp-ic">' + x[0] + '</span>' + x[1] + '</li>'; }).join("") +
      '</ul>' +
      '<button class="mp-ghost" id="mpCancel" style="width:100%;margin-top:22px">Cancel subscription</button>';
    body().querySelector("#mpCancel").addEventListener("click", function () {
      try { localStorage.removeItem(STORE_KEY); } catch (x) {}
      applyPremiumState(); closeModal();
    });
  }

  function pay() {
    var p = PLANS.premium, cyc = state.cycle;
    renderProcessing();
    startCheckout(p, cyc).then(function (res) {
      if (!res.ok) { renderError("We couldn't confirm your payment."); return; }
      setEntitlement({ plan: p.id, cycle: cyc, since: new Date().toISOString(), paymentId: res.paymentId });
      renderSuccess();
    }).catch(function (err) {
      if (err && err.message === "__cancelled__") { renderReview(); return; }
      renderError(err && err.message);
    });
  }

  /* ── Inject buttons into the running app ──────────────── */
  function injectSidebar() {
    var menu = document.querySelector("#appView .card.menu") || document.querySelector(".card.menu");
    if (!menu) return false;
    if (menu.querySelector(".mp-side-btn")) return true;
    var btn = el(
      '<button class="mp-side-btn mp-shimmer" id="mpSideBtn">' +
        '<span class="mp-crown">👑</span>' +
        '<span style="text-align:left;flex:1">Go Premium<small>Gold badge, AI &amp; more</small></span>' +
      '</button>'
    );
    btn.addEventListener("click", openModal);
    menu.appendChild(btn);
    return true;
  }

  function injectTopbar() {
    var inner = document.querySelector("#appView .topbar .topinner") || document.querySelector(".topbar .topinner");
    if (!inner) return false;
    if (inner.querySelector(".mp-top-pill")) return true;
    var pill = el('<button class="mp-top-pill mp-shimmer" id="mpTopPill"><span>👑</span> Upgrade</button>');
    pill.addEventListener("click", openModal);
    inner.appendChild(pill);
    return true;
  }

  function applyPremiumState() {
    var prem = isPremium();
    // hide upgrade CTAs when premium, relabel where useful
    document.querySelectorAll(".mp-side-btn, .mp-top-pill").forEach(function (b) {
      b.style.display = prem ? "none" : "";
    });
    // gold badge next to brand title / profile name
    document.querySelectorAll(".mp-badge").forEach(function (n) { n.remove(); });
    if (prem) {
      var nameNode = document.querySelector("#appView .profileCard .name, #appView .profileRow .name, .profileCard .name");
      if (nameNode && !nameNode.querySelector(".mp-badge")) {
        nameNode.appendChild(el('<span class="mp-badge" title="MILAN Premium">' + goldCheckSvg() + '</span>'));
      }
    }
  }

  function goldCheckSvg() {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>';
  }

  function tryInject() {
    var a = injectSidebar();
    var b = injectTopbar();
    if (a || b) applyPremiumState();
    return a && b;
  }

  /* The app view starts hidden and renders after login; observe for it. */
  function boot() {
    tryInject();
    var obs = new MutationObserver(function () { tryInject(); });
    obs.observe(document.body, { childList: true, subtree: true });
    // safety re-tries for slow renders
    var n = 0, iv = setInterval(function () { tryInject(); if (++n > 20) clearInterval(iv); }, 700);
    window.MilanPremium = { open: openModal, isPremium: isPremium };
  }

  if (document.readyState === "loading") {
    if (window.__milanAppReady) boot(); else window.addEventListener("milan:app-ready", boot, {once:true});
  } else { boot(); }
})();
