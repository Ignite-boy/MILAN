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

function showMessage(message, isError = true) {
  const el = document.getElementById("authMsg");
  if (!el) return;
  el.innerText = message;
  el.style.color = isError ? "#e5484d" : "#10b981";
}

function setActiveTab(mode) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.dataset.auth === mode
      ? tab.classList.add("active")
      : tab.classList.remove("active");
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
    headers: {
      "Accept": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function registerUser(name, email, password) {
  return api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
}

async function loginUser(email, password) {
  return api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

window.togglePasswordVisibility = function () {
  const input = document.getElementById("loginPass");
  if (input) input.type = input.type === "password" ? "text" : "password";
};

async function loginWithID3() {
  showMessage("ID3 login is loading...", false);
  try {
    const options = await api("/did/passkey/login/options");
    const lib = await loadSimpleWebAuthnBrowser();
    if (lib.browserSupportsWebAuthn && !lib.browserSupportsWebAuthn()) throw new Error("This browser does not support ID3/passkeys.");
    const assertion = await lib.startAuthentication({ optionsJSON: options });
    const result = await api("/did/passkey/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assertion)
    });
    if (!result.token) throw new Error("No MILAN token received.");
    setToken(result.token);
    window.location.replace("/app.html?login=" + Date.now());
  } catch (error) {
    showMessage(error?.message || String(error) || "ID3 login failed.", true);
  }
}

let simpleWebAuthnPromise = null;
function loadSimpleWebAuthnBrowser() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (simpleWebAuthnPromise) return simpleWebAuthnPromise;
  simpleWebAuthnPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/simplewebauthn-browser.min.js";
    script.async = true;
    script.onload = () => window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error("ID3 security module unavailable"));
    script.onerror = () => reject(new Error("Could not load ID3 security module"));
    document.head.appendChild(script);
  });
  return simpleWebAuthnPromise;
}

function bind() {
  document.querySelectorAll(".tab").forEach(tab => {
    if (tab.dataset.milanAuthBound) return;
    tab.dataset.milanAuthBound = "1";
    tab.addEventListener("click", () => setActiveTab(tab.dataset.auth));
  });

  const switchLink = document.getElementById("switchToRegister");
  if (switchLink && !switchLink.dataset.milanAuthBound) {
    switchLink.dataset.milanAuthBound = "1";
    switchLink.addEventListener("click", event => {
      event.preventDefault();
      setActiveTab("register");
    });
  }

  const registerBtn = document.getElementById("registerBtn");
  if (registerBtn && !registerBtn.dataset.milanAuthBound) {
    registerBtn.dataset.milanAuthBound = "1";
    registerBtn.addEventListener("click", async event => {
      event.preventDefault();
      const name = document.getElementById("regName")?.value?.trim() || "";
      const email = document.getElementById("regEmail")?.value?.trim().toLowerCase() || "";
      const password = document.getElementById("regPass")?.value || "";
      if (!name || !email || !password) return showMessage("Please fill all fields.", true);
      if (password.length < 8) return showMessage("Password must be at least 8 characters.", true);
      registerBtn.disabled = true;
      registerBtn.textContent = "Creating account...";
      try {
        await registerUser(name, email, password);

        // Fast registration: account is saved in Supabase, then
        // immediately switch the user to the Login tab.
        const loginTab = document.querySelector('[data-auth="login"]');
        if (loginTab) loginTab.click();

        const loginEmail = document.getElementById("loginEmail");
        if (loginEmail) loginEmail.value = email;

        const loginPass = document.getElementById("loginPass");
        if (loginPass) loginPass.value = "";

        showMessage("✅ Account created. Please login.", false);
      } catch (error) {
        showMessage(error?.message || String(error) || "Registration failed.", true);
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = "Create my MILAN space";
      }
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
      loginBtn.disabled = true;
      loginBtn.textContent = "Logging in...";
      try {
        const data = await loginUser(email, password);
        if (!data.token) throw new Error("No token received.");
        setToken(data.token);
        window.location.replace("/app.html?login=" + Date.now());
      } catch (error) {
        clearToken();
        showMessage(error?.message || String(error) || "Login failed.", true);
        loginBtn.disabled = false;
        loginBtn.textContent = "Login →";
      }
    });
  }

async function registerID3() {
    const didBtn =
        document.getElementById(
            "didLoginBtn"
        );

    if (!getToken()) {
        showMessage(
            "Sign in once with your password to enable ID3 on this device.",
            true
        );
        return;
    }

    try {
        didBtn.disabled = true;
        didBtn.innerHTML =
            '<span class="did-badge">did</span> Enabling ID3...';

        showMessage(
            "Create your secure ID3 passkey on this device...",
            false
        );

        const {
            startRegistration,
            browserSupportsWebAuthn
        } =
            await loadSimpleWebAuthnBrowser();

        if (
            browserSupportsWebAuthn &&
            !browserSupportsWebAuthn()
        ) {
            throw new Error(
                "This browser does not support secure ID3/passkey login."
            );
        }

        const options =
            await authenticatedJson(
                "/api/did/passkey/register/options"
            );

        const registrationResponse =
            await startRegistration({
                optionsJSON: options
            });

        const verification =
            await authenticatedJson(
                "/api/did/passkey/register/verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify(
                            registrationResponse
                        )
                }
            );

        if (!verification.verified) {
            throw new Error(
                "ID3 registration was not verified."
            );
        }

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        showMessage(
            "✅ ID3 enabled. You can now sign in with one click.",
            false
        );

        setTimeout(() => {
            window.location.replace(
                "/app.html?login=" +
                Date.now()
            );
        }, 900);

    } catch (error) {
        console.error(
            "[MILAN ID3] registration failed:",
            error
        );

        didBtn.disabled = false;

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        const name = String(error?.name || "").trim();
        const message =
            typeof error?.message === "string"
                ? error.message.trim()
                : "";

        if (name === "NotAllowedError") {
            showMessage(
                "Passkey setup was cancelled or timed out. Please try again.",
                true
            );
        } else if (
            name === "InvalidStateError" ||
            /previously registered/i.test(message)
        ) {
            showMessage(
                "This device already has a MILAN passkey. Try Sign with ID3.",
                true
            );
        } else if (name === "SecurityError") {
            showMessage(
                "MILAN could not verify this passkey request. Please try again from milanlife.in.",
                true
            );
        } else if (name === "AbortError") {
            showMessage(
                "Passkey setup was interrupted. Please try again.",
                true
            );
        } else {
            showMessage(
                message || "Could not enable ID3. Please try again.",
                true
            );
        }
    }
}


  const didBtn = document.getElementById("didLoginBtn");
  if (didBtn && !didBtn.dataset.milanAuthBound) {
    didBtn.dataset.milanAuthBound = "1";
    didBtn.addEventListener("click", async event => {
      event.preventDefault();

      try {
        if (!getToken()) {
          // No password session: discoverable ID3 login must run directly.
          await loginWithID3();
          return;
        }

        const status = await authenticatedJson("/api/did/passkey/status");

        if (status?.registered) {
          await loginWithID3();
        } else {
          await registerID3();
        }
      } catch (error) {
        showMessage(
          error?.message ||
          String(error) ||
          "Could not start ID3. Please try again.",
          true
        );
      }
    });
  }

  try {
    if (getToken()) window.location.replace("/app.html");
  } catch (_) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind, { once: true });
} else {
  bind();
}
