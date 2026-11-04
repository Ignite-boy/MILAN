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
        localStorage.getItem("milan_token") ||
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

    return {
      blob,
      width,
      height,
      bytes: blob.size
    };
  }


  // One upload path for the sidebar camera and Edit Profile modal.
  // Success is reported only after an uncached GET confirms the same DWN record.
  async function uploadProfileAvatar(file, extraFields = {}) {
    const token = getToken();
    if (!token) throw new Error("Please sign in before changing your profile picture.");
    if (!file || !/^image\//i.test(file.type || "")) {
      throw new Error("Please choose a valid image file.");
    }

    const uploadVersion = (Number(window.__milanAvatarUploadVersion) || 0) + 1;
    window.__milanAvatarUploadVersion = uploadVersion;
    window.__milanAvatarUploadActive = true;

    try {
      const optimized = await compressProfileImage(file);
      const form = new FormData();
      form.append("avatar", optimized.blob, "profile-picture.jpg");

      Object.entries(extraFields || {}).forEach(([key, value]) => {
        if (value != null) form.append(key, String(value));
      });

      const putResponse = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json"
        },
        body: form,
        cache: "no-store"
      });

      const saved = await putResponse.json().catch(() => ({}));
      if (!putResponse.ok) {
        throw new Error(
          saved.detail ||
          saved.error ||
          `Profile save failed: ${putResponse.status}`
        );
      }

      const savedRecordId = String(saved.avatarRecordId || "").trim();
      if (!savedRecordId) {
        throw new Error("The server response did not confirm a persistent profile-picture record.");
      }

      let verified = null;
      let lastReadbackMessage = "No readback response was received.";

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          const readResponse = await fetch("/api/profile", {
            method: "GET",
            headers: {
              Authorization: "Bearer " + token,
              Accept: "application/json",
              "Cache-Control": "no-cache"
            },
            cache: "no-store"
          });

          const readData = await readResponse.json().catch(() => ({}));
          const profileData = readData?.profile || readData || {};
          const readbackRecordId = String(profileData.avatarRecordId || "").trim();
          const readbackAvatar = String(profileData.avatar || "").trim();

          if (
            readResponse.ok &&
            profileData.avatarSync === "synced" &&
            readbackRecordId === savedRecordId &&
            /^data:image\/[a-z0-9.+-]+;base64,/i.test(readbackAvatar)
          ) {
            verified = profileData;
            break;
          }

          lastReadbackMessage = !readResponse.ok
            ? `Readback returned HTTP ${readResponse.status}.`
            : `Readback status=${profileData.avatarSync || "missing"}, recordId match=${readbackRecordId === savedRecordId}, image present=${Boolean(readbackAvatar)}`;
        } catch (readError) {
          lastReadbackMessage = readError?.message || String(readError);
        }

        if (attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }

      if (!verified) {
        throw new Error(
          "The upload endpoint accepted the image, but a fresh persistent DWN readback did not confirm the same record. " +
          lastReadbackMessage
        );
      }

      if (uploadVersion !== (Number(window.__milanAvatarUploadVersion) || 0)) {
        throw new Error("A newer profile-picture upload superseded this one. Please check the latest upload.");
      }

      const verifiedAvatar = String(verified.avatar).trim();

      // Cache and UI are updated only after the authoritative GET succeeds.
      try {
        localStorage.setItem("milanAvatar", verifiedAvatar);
      } catch (_) {}

      window.__milanPersistentAvatar = verifiedAvatar;
      window.__milanAvatarUploadCommittedAt = Date.now();

      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, verifiedAvatar);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = verifiedAvatar;
        preview.style.display = "block";
      }

      if (window.me) {
        window.me.profile = {
          ...(window.me.profile || {}),
          ...verified
        };
      }

      console.log(
        "[MILAN] Profile picture verified by persistent DWN readback:",
        verified.avatarRecordId
      );

      return verified;
    } finally {
      if (uploadVersion === (Number(window.__milanAvatarUploadVersion) || 0)) {
        window.__milanAvatarUploadActive = false;
      }
    }
  }

  window.milanUploadProfileAvatar = uploadProfileAvatar;

  async function handleUpload(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = event.currentTarget;
    const file = input?.files?.[0];

    if (!file || !/^image\//i.test(file.type || "")) {
      if (input) input.value = "";
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    try {
      // Show an immediate temporary preview while the common uploader works.
      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, previewUrl);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = previewUrl;
        preview.style.display = "block";
      }

      await uploadProfileAvatar(file);
      console.log("[MILAN] Sidebar camera upload passed persistent readback.");
    } catch (error) {
      console.error("[MILAN] DP upload/readback failed:", error);

      // Restore the server-confirmed image (or initials) after a failed save.
      try {
        await syncLiveProfileIdentity();
      } catch (_) {}

      try {
        alert("DP upload failed: " + (error?.message || error));
      } catch (_) {}
    } finally {
      URL.revokeObjectURL(previewUrl);
      if (input) input.value = "";
    }
  }

  // MILAN ONE: avatar restoration is handled only by syncLiveProfileIdentity().
 
  async function syncLiveProfileIdentity() {
    const syncVersion = Number(window.__milanAvatarUploadVersion) || 0;
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

    // Ignore reads that began before an avatar upload, or while an upload is in flight.
    if (
      syncVersion !== (Number(window.__milanAvatarUploadVersion) || 0) ||
      window.__milanAvatarUploadActive
    ) return;

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

    // A successful profile GET is authoritative, even when it says no avatar exists.
    // Browser cache is used only when the profile endpoint itself could not be read.
    const profileReadSucceeded = Boolean(profile);
    const remoteAvatar = profileReadSucceeded
      ? String(profileData.avatar || "").trim()
      : String(window.__milanPersistentAvatar || "").trim() ||
        String(localStorage.getItem("milanAvatar") || "").trim();

    if (profileReadSucceeded) {
      if (profileData.avatarSync === "synced" && remoteAvatar) {
        window.__milanPersistentAvatar = remoteAvatar;
        try {
          localStorage.setItem("milanAvatar", remoteAvatar);
        } catch (_) {}
      } else {
        window.__milanPersistentAvatar = "";
        try {
          localStorage.removeItem("milanAvatar");
        } catch (_) {}
      }
    }

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
      user.name ||
      meProfile.name ||
      profileData.display_name ||
      profileData.name ||
      meProfile.display_name ||
      user.display_name ||
      ""
    ).trim();

    const email = String(
      profileData.email ||
      meProfile.email ||
      user.email ||
      ""
    ).trim();

    if (!remoteAvatar) {
      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.removeAttribute("src");
        preview.style.display = "none";
      }

      const initial = String(name || "M").trim().charAt(0).toUpperCase() || "M";
      ["myAvatar", "composerAvatar"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.replaceChildren();
        el.textContent = initial;
        el.style.backgroundImage = "none";
        el.style.backgroundColor = "";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontWeight = "800";
      });
    }

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

    if (typeof renderFeed === "function") {
      renderFeed();
    }
  }

  function installLogout() {
    const current = $("logoutBtn");
    if (!current || current.dataset.appLogoutBound) return;

    current.dataset.appLogoutBound = "1";

    current.addEventListener("click", () => {
      try {
        localStorage.removeItem("milan_token");
        localStorage.removeItem("milan_token");
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

    document.querySelectorAll(".nav button, .m8-nav button").forEach(button => {
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
