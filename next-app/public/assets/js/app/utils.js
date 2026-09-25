/* ============================================================
   MILAN APP — Shared Utilities
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MilanUtils = {
  esc(value = "") {
    return String(value).replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
    );
  },

  initials(value = "MILAN") {
    return (
      String(value || "M")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || "")
        .join("")
        .toUpperCase() || "M"
    );
  },

  toast(message) {
    let container = document.getElementById("milanToastContainer");

    if (!container) {
      container = document.createElement("div");
      container.id = "milanToastContainer";
      container.style.cssText =
        "position:fixed;top:18px;right:18px;z-index:99999;" +
        "display:flex;flex-direction:column;gap:8px;" +
        "pointer-events:none;";
      document.body.appendChild(container);
    }

    const el = document.createElement("div");
    el.textContent = String(message || "");
    el.style.cssText =
      "background:rgba(15,23,42,.92);color:#fff;" +
      "padding:10px 18px;border-radius:12px;font-size:13px;" +
      "font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.22);" +
      "opacity:0;transform:translateY(-8px);" +
      "transition:opacity .22s,transform .22s;" +
      "pointer-events:none;max-width:320px;word-break:break-word;";

    container.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";

      setTimeout(() => {
        el.parentNode?.removeChild(el);
      }, 250);
    }, 2600);
  },

  avatarHtml(profile = {}, className = "avatar") {
    const avatar = profile.avatar || "";

    if (
      /^data:image\//.test(avatar) ||
      /^https?:\/\//.test(avatar)
    ) {
      return `<div class="${className}"><img src="${this.esc(
        avatar
      )}" alt="profile"></div>`;
    }

    return `<div class="${className}">${this.esc(
      avatar ||
      this.initials(
        profile.name ||
        profile.display_name ||
        profile.email ||
        "M"
      )
    )}</div>`;
  }
};

window.MilanApp.utils = MilanUtils;

/* Compatibility globals for the existing runtime. */
window.esc = MilanUtils.esc.bind(MilanUtils);
window.initials = MilanUtils.initials.bind(MilanUtils);
window.toast = MilanUtils.toast.bind(MilanUtils);
window.avatarHtml = MilanUtils.avatarHtml.bind(MilanUtils);
