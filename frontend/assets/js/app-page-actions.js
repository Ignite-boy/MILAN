/* ============================================================
   MILAN APP — Page Actions
   Profile photo upload, avatar restore, live identity sync,
   and final logout.
   ============================================================ */

"use strict";

(() => {
  const $ = id => document.getElementById(id);

  function getToken() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milanToken") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function setAvatar(id, avatar) {
    const el = $(id);
    if (!el || !avatar) return;

    el.style.backgroundImage = "none";
    el.style.backgroundColor = "transparent";
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.backgroundRepeat = "no-repeat";
    el.textContent = "";

    let img = el.querySelector("img");

    if (!img) {
      img = document.createElement("img");
      img.alt = "Profile photo";
      el.appendChild(img);
    }

    img.src = avatar;
    img.alt = "Profile photo";
    img.style.display = "block";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "cover";
    img.style.objectPosition = "center";
    img.style.border = "0";
    img.style.opacity = "1";
    img.style.visibility = "visible";
  }

  async function compressProfileImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode image"));
      image.src = dataUrl;
    });

    const maxSide = 640;
    const scale = Math.min(
      1,
      maxSide / Math.max(img.width, img.height)
    );

    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");

    ctx.drawImage(img, 0, 0, width, height);

    const blobFromCanvas = quality =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          blob =>
            blob
              ? resolve(blob)
              : reject(new Error("Image compression failed")),
          "image/jpeg",
          quality
        );
      });

    let blob = await blobFromCanvas(0.82);

    for (
      let quality = 0.76;
      blob.size > 820000 && quality >= 0.45;
      quality -= 0.08
    ) {
      blob = await blobFromCanvas(quality);
    }

    if (blob.size > 820000) {
      throw new Error("Image is still too large after compression.");
    }

    const optimizedDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not encode image"));
      reader.readAsDataURL(blob);
    });

    return {
      dataUrl: optimizedDataUrl,
      width,
      height,
      bytes: blob.size
    };
  }

  async function handleUpload(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = event.currentTarget;
    const file = input?.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      if (input) input.value = "";
      return;
    }

    const token = getToken();

    if (!token) {
      console.warn("[MILAN] Login required before changing DP.");
      input.value = "";
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    try {
      // Immediate local preview.
      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, previewUrl);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = previewUrl;
        preview.style.display = "block";
      }

      // IMPORTANT:
      // Send the ORIGINAL uploaded file.
      // No canvas conversion. No JPEG re-encoding.
      const form = new FormData();
      form.append("avatar", file, file.name);

      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token
        },
        body: form
      });

      const saved = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          saved.detail ||
          saved.error ||
          `Profile save failed: ${response.status}`
        );
      }

      if (!saved.avatarRecordId) {
        throw new Error("Real DWN profile-picture record was not confirmed.");
      }

      console.log(
        "[MILAN] DP saved to Real DWN:",
        saved.avatarRecordId,
        saved.avatarMime,
        saved.avatarFileName
      );

      // CRITICAL:
      // The blob: preview is temporary. After the Real DWN write succeeds,
      // immediately replace that temporary URL with the persisted DWN avatar.
      await syncLiveProfileIdentity();
    } catch (error) {
      console.error("[MILAN] DP upload failed:", error);
    } finally {
      URL.revokeObjectURL(previewUrl);
      input.value = "";
    }
  }


  // MILAN ONE: avatar restoration is handled only by syncLiveProfileIdentity().
 
  async function syncLiveProfileIdentity() {
    const token = getToken();
    if (!token) return;

    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/json"
    };

    let me = null;
    let profile = null;

    try {
      const response = await fetch("/api/auth/me", {
        headers,
        cache: "no-store"
      });

      if (response.ok) {
        me = await response.json();
      }
    } catch (error) {
      console.warn("[MILAN] auth/me identity sync failed:", error);
    }

    try {
      const response = await fetch("/api/profile", {
        headers,
        cache: "no-store"
      });

      if (response.ok) {
        profile = await response.json();
      }
    } catch (error) {
      console.warn("[MILAN] profile identity sync failed:", error);
    }

    const user =
      me?.user ||
      me?.data?.user ||
      me ||
      {};

    const meProfile =
      me?.profile ||
      me?.data?.profile ||
      {};

    const profileData =
      profile?.profile ||
      profile ||
      {};

    // MILAN ONE: /api/profile -> persistent DWN is the only avatar source.
    const remoteAvatar = String(profileData.avatar || "").trim() || String(localStorage.getItem("milanAvatar") || "").trim();

    if (remoteAvatar) {
      profileData.avatar = remoteAvatar;

      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, remoteAvatar);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = remoteAvatar;
        preview.style.display = "block";
      }

      if (window.me) {
        window.me.profile = {
          ...(window.me.profile || {}),
          avatar: remoteAvatar
        };
      }
    }

    const name = String(
      profileData.display_name ||
      profileData.name ||
      meProfile.display_name ||
      meProfile.name ||
      user.name ||
      user.display_name ||
      ""
    ).trim();

    const email = String(
      profileData.email ||
      meProfile.email ||
      user.email ||
      ""
    ).trim();

    const nameEl = $("myName");
    const emailEl = $("myEmail");

    if (nameEl && name) nameEl.textContent = name;
    if (emailEl && email) emailEl.textContent = email;

    if (window.me) {
      window.me = {
        ...window.me,
        ...user,
        profile: {
          ...(window.me.profile || {}),
          ...meProfile,
          ...profileData,
          ...(profileData.avatar ? { avatar: profileData.avatar } : {})
        }
      };
    }
  }

  function installLogout() {
    const current = $("logoutBtn");
    if (!current || current.dataset.appLogoutBound) return;

    current.dataset.appLogoutBound = "1";

    current.addEventListener("click", () => {
      try {
        localStorage.removeItem("milan_token");
        localStorage.removeItem("milanToken");
        localStorage.removeItem("milanBootCache");
          sessionStorage.clear();
      } finally {
        window.location.replace("/");
      }
    });
  }

  function init() {
    // MILAN ONE: DP is restored only from syncLiveProfileIdentity().
    let photoInput = $("editProfilePhoto");

    if (photoInput) {
      // Replace the input so any older/duplicate listeners are discarded.
      if (!photoInput.dataset.milanCanonicalInput) {
        const cleanInput = photoInput.cloneNode(true);
        cleanInput.dataset.milanCanonicalInput = "1";
        photoInput.replaceWith(cleanInput);
        photoInput = cleanInput;
      }

      if (!photoInput.dataset.appUploadBound) {
        photoInput.dataset.appUploadBound = "1";
        photoInput.addEventListener("change", handleUpload, { capture: true });
      }
    }

    syncLiveProfileIdentity().finally(() => {
      installLogout();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* ------------------------------------------------------------
   App navigation — no inline onclick handlers.
   ------------------------------------------------------------ */
(() => {
  const go = path => {
    window.location.assign(path);
  };

  const bind = (selector, handler) => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.dataset.navBound) return;
      el.dataset.navBound = "1";
      el.addEventListener("click", handler);
    });
  };

  const initNavigation = () => {
    const brand = document.querySelector(".brand-logo");
    if (brand && !brand.dataset.navBound) {
      brand.dataset.navBound = "1";
      brand.addEventListener("click", () => go("/app"));

      brand.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go("/app");
        }
      });
    }

    bind('.icon-btn[title="Chat"]', () => go("/chat"));
    bind('.icon-btn[title="Music"]', () => go("/music"));

    document.querySelectorAll(".nav button").forEach(button => {
      const text = button.textContent.trim();

      if (button.dataset.navBound) return;

      if (text.includes("Messages")) {
        button.dataset.navBound = "1";
        button.addEventListener("click", () => go("/chat"));
      }

      if (text.includes("Music")) {
        button.dataset.navBound = "1";
        button.addEventListener("click", () => go("/music"));
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNavigation, {
      once: true
    });
  } else {
    initNavigation();
  }
})();
