/* MILAN — external login-page actions */
"use strict";

(function () {
  const show = (message, error = false) => {
    const el = document.getElementById("authMsg");
    if (!el) return;
    el.textContent = String(message || "");
    el.style.color = error ? "#e5484d" : "#10b981";
  };

  function bindLoginPageActions() {
    const toggleBtn = document.getElementById("togglePasswordBtn");
    const password = document.getElementById("loginPass");
    if (toggleBtn && password && !toggleBtn.dataset.bound) {
      toggleBtn.dataset.bound = "1";
      toggleBtn.addEventListener("click", function () {
        password.type = password.type === "password" ? "text" : "password";
      });
    }

    const forgot = document.getElementById("forgotPasswordLink");
    const email = document.getElementById("loginEmail");
    if (forgot && email && !forgot.dataset.bound) {
      forgot.dataset.bound = "1";
      forgot.addEventListener("click", function () {
        const value = String(email.value || "").trim();
        this.href = value
          ? "/reset-password?email=" + encodeURIComponent(value)
          : "/reset-password";
      });
    }

    // Password login is handled exclusively by login.js.
    // Do not install a second/capture-phase login handler here: the duplicate
    // handler caused extra requests and made the login button appear stuck.
    show("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLoginPageActions, { once: true });
  } else {
    bindLoginPageActions();
  }
})();
