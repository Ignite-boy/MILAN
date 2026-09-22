/* MILAN login/register — production auth client */
"use strict";

const API_BASE = "/api";

function getToken() {
  try { return String(localStorage.getItem("milan_token") || "").trim(); }
  catch (_) { return ""; }
}
function setToken(token) {
  localStorage.setItem("milan_token", String(token));
  localStorage.removeItem("milanBootCache");
}
function clearToken() { localStorage.removeItem("milan_token"); }
function formatError(value, fallback = "Request failed") {
  if (value instanceof Error && value.message) return String(value.message);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value?.message && typeof value.message === "string") return value.message;
  if (value?.error?.message && typeof value.error.message === "string") return value.error.message;
  if (value?.error && typeof value.error === "string") return value.error;
  try { const json = JSON.stringify(value); if (json && json !== "{}" && json !== "null") return json; } catch (_) {}
  return fallback;
}
function showMessage(message, isError = true) {
  const el = document.getElementById("authMsg");
  if (!el) return;
  el.textContent = formatError(message, "");
  el.style.color = isError ? "#e5484d" : "#10b981";
}
function setActiveTab(mode) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.dataset.auth === mode ? tab.classList.add("active") : tab.classList.remove("active");
  });
  document.getElementById("loginBox")?.classList.toggle("hidden", mode !== "login");
  document.getElementById("registerBox")?.classList.toggle("hidden", mode !== "register");
  const msg = document.getElementById("authMsg");
  if (msg) msg.innerText = "";
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Accept": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(formatError(data?.error ?? data, `Request failed (${response.status})`));
    error.status = response.status;
    throw error;
  }
  return data;
}
async function registerUser(name, email, password) {
  return api("/auth/register", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,email,password}) });
}
async function loginUser(email, password) {
  return api("/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email,password}) });
}
window.togglePasswordVisibility = function () {
  const input = document.getElementById("loginPass");
  if (input) input.type = input.type === "password" ? "text" : "password";
};
let simpleWebAuthnPromise = null;
function loadSimpleWebAuthnBrowser() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (simpleWebAuthnPromise) return simpleWebAuthnPromise;
  simpleWebAuthnPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/simplewebauthn-browser.min.js?v=id3-20260908-3";
    script.async = true;
    script.onload = () => window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error("ID3 security module unavailable"));
    script.onerror = () => reject(new Error("Could not load ID3 security module"));
    document.head.appendChild(script);
  });
  return simpleWebAuthnPromise;
}
async function loginWithID3() {
  const didBtn = document.getElementById("didLoginBtn");
  if (didBtn) didBtn.disabled = true;
  showMessage("ID3 login is loading...", false);
  try {
    const options = await api("/did/passkey/login/options");
    const lib = await loadSimpleWebAuthnBrowser();
    if (lib.browserSupportsWebAuthn && !lib.browserSupportsWebAuthn()) throw new Error("This browser does not support ID3/passkeys.");
    const assertion = await lib.startAuthentication({ optionsJSON: options });
    const result = await api("/did/passkey/login/verify", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(assertion) });
    if (!result.token) throw new Error("No MILAN token received.");
    setToken(result.token);
    window.location.replace("/app?login=" + Date.now());
  } catch (error) {
    showMessage(formatError(error, "ID3 login failed."), true);
    if (didBtn) didBtn.disabled = false;
  }
}

function initStorageUpgrade() {
  const modal = document.getElementById("milanPaymentModal");
  const title = document.getElementById("milanPaymentTitle");
  const amount = document.getElementById("milanPaymentAmount");
  const utr = document.getElementById("milanPaymentUtr");
  const status = document.getElementById("milanPaymentStatus");
  const submit = document.getElementById("milanPaymentSubmit");

  const plans = {
    "500mb": { label: "500 MB", amount: 500 },
    "1gb": { label: "1 GB", amount: 1000 }
  };

  let selectedPlan = "";

  const close = () => {
    modal?.classList.add("hidden");
    if (status) status.textContent = "";
  };

  document.querySelectorAll("[data-storage-close]").forEach(el => {
    if (el.dataset.milanStorageBound) return;
    el.dataset.milanStorageBound = "1";
    el.addEventListener("click", close);
  });

  document.querySelectorAll("[data-storage-plan]").forEach(button => {
    if (button.dataset.milanStorageBound) return;
    button.dataset.milanStorageBound = "1";

    button.addEventListener("click", () => {
      selectedPlan = button.dataset.storagePlan || "";
      const plan = plans[selectedPlan];
      if (!plan || !modal) return;

      if (title) title.textContent = `${plan.label} Storage Upgrade`;
      if (amount) amount.textContent = `Pay ₹${plan.amount.toLocaleString("en-IN")} via UPI`;
      if (utr) utr.value = "";
      if (status) status.textContent = "";

      modal.classList.remove("hidden");
    });
  });

  submit?.addEventListener("click", async () => {
    const plan = plans[selectedPlan];
    const auth = getToken();
    const value = String(utr?.value || "").trim();

    if (!plan || !auth) {
      if (status) status.textContent = "Please login first, then submit the payment request.";
      return;
    }

    if (value.length < 6) {
      if (status) status.textContent = "Enter a valid UTR / transaction reference.";
      return;
    }

    submit.disabled = true;
    submit.textContent = "Submitting...";

    try {
      const response = await fetch(`${API_BASE}/storage/upgrade-request`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": "Bearer " + auth
        },
        body: JSON.stringify({
          plan: selectedPlan,
          utr: value
        }),
        cache: "no-store"
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      if (status) {
        status.textContent = "✅ Payment request submitted. Upgrade will apply after verification.";
      }
      submit.textContent = "Request Submitted ✓";
    } catch (error) {
      if (status) status.textContent = formatError(error, "Payment request failed.");
      submit.disabled = false;
      submit.textContent = "Submit Payment Request";
    }
  });
}

function bind() {
  initStorageUpgrade();
  document.querySelectorAll(".tab").forEach(tab => {
    if (tab.dataset.milanAuthBound) return;
    tab.dataset.milanAuthBound = "1";
    tab.addEventListener("click", () => setActiveTab(tab.dataset.auth));
  });
  const switchLink = document.getElementById("switchToRegister");
  if (switchLink && !switchLink.dataset.milanAuthBound) {
    switchLink.dataset.milanAuthBound = "1";
    switchLink.addEventListener("click", event => { event.preventDefault(); setActiveTab("register"); });
  }
  const registerBtn = document.getElementById("registerBtn");
  if (registerBtn && !registerBtn.dataset.milanAuthBound) {
    registerBtn.dataset.milanAuthBound = "1";
    registerBtn.addEventListener("click", async () => {
      const name = document.getElementById("regName")?.value?.trim() || "";
      const email = document.getElementById("regEmail")?.value?.trim().toLowerCase() || "";
      const password = document.getElementById("regPass")?.value || "";
      if (!name || !email || !password) return showMessage("Please fill all fields.", true);
      if (password.length < 8) return showMessage("Password must be at least 8 characters.", true);
      registerBtn.disabled = true; registerBtn.textContent = "Creating account...";
      try {
        await registerUser(name, email, password);
        setActiveTab("login");
        const loginEmail = document.getElementById("loginEmail"); if (loginEmail) loginEmail.value = email;
        const loginPass = document.getElementById("loginPass"); if (loginPass) loginPass.value = "";
        showMessage("✅ Registration successful. Please login.", false);
      } catch (error) {
        showMessage(formatError(error, "Registration failed."), true);
      } finally { registerBtn.disabled = false; registerBtn.textContent = "Create my MILAN space"; }
    });
  }
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn && !loginBtn.dataset.milanAuthBound) {
    loginBtn.dataset.milanAuthBound = "1";
    loginBtn.addEventListener("click", async event => {
      event.preventDefault();
      const email = document.getElementById("loginEmail")?.value?.trim().toLowerCase() || "";
      const password = document.getElementById("loginPass")?.value || "";
      if (!email || !password) return showMessage("Please enter email and password.", true);
      loginBtn.disabled = true; loginBtn.textContent = "Logging in...";
      try {
        const data = await loginUser(email, password);
        if (!data.token) throw new Error("No token received.");
        setToken(data.token);
        showMessage("✅ Login successful. Opening MILAN...", false);
        window.location.replace("/app?login=" + Date.now());
      } catch (error) {
        clearToken(); showMessage(formatError(error, "Login failed."), true);
        loginBtn.disabled = false; loginBtn.textContent = "Login →";
      }
    });
  }
  const didBtn = document.getElementById("didLoginBtn");
  if (didBtn && !didBtn.dataset.milanAuthBound) {
    didBtn.dataset.milanAuthBound = "1";
    didBtn.addEventListener("click", loginWithID3);
  }
  if (getToken()) window.location.replace("/app");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, {once:true}); else bind();