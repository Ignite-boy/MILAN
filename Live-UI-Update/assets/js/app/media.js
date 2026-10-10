/* ============================================================
   MILAN APP — Media Runtime
   Media URLs, previews, retry/repair, file cards,
   and viewport-aware loading.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MediaState = window.MilanApp.state;
const MediaApi = window.MilanApp.api;
const MediaUtils = window.MilanApp.utils;

function mediaSrc(url) {
  if (!url) return "";

  if (
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)
  ) {
    return "";
  }

  if (/^data:|^blob:/.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  return MediaState.token
    ? url +
        separator +
        "token=" +
        encodeURIComponent(MediaState.token) +
        "&mv=59"
    : url + separator + "mv=49";
}

function mediaDownloadSrc(url) {
  const base = mediaSrc(url);

  return base
    ? base +
        (base.includes("?") ? "&" : "?") +
        "download=1"
    : "";
}

function videoMediaSrc(raw) {
  let url = String(raw || "");

  if (
    /^\/api\/records\/[^/]+\/media$/.test(url)
  ) {
    url += "/play.mp4";
  }

  return mediaSrc(url);
}

function mediaNode(element) {
  return element &&
    element.tagName === "SOURCE"
    ? element.parentElement
    : element;
}

function setMediaError(
  element,
  message,
  repairing = false
) {
  try {
    const node = mediaNode(element);
    const box = node?.closest(".media");
    const error = box?.querySelector(".mediaLoadError");

    box?.classList.toggle(
      "repairing",
      Boolean(repairing)
    );

    if (error) {
      error.textContent = message;
      error.classList.remove("hidden");
    }
  } catch {}
}

function clearMediaError(element) {
  try {
    const node = mediaNode(element);
    const box = node?.closest(".media");

    box?.querySelector(
      ".mediaLoadError"
    )?.classList.add("hidden");

    box?.classList.remove("repairing");
    box?.classList.remove("previewFailed");
  } catch {}
}

function milanSetVideoSource(video, nextUrl) {
  try {
    if (!video) return;

    const source =
      video.querySelector?.("source");

    if (source) {
      source.setAttribute("src", nextUrl);
    } else {
      video.setAttribute("src", nextUrl);
    }

    video.load?.();
  } catch {}
}

function milanRetryMedia(element) {
  try {
    const node = mediaNode(element);

    if (!node || node.dataset.retrying === "1") {
      return;
    }

    node.dataset.retrying = "1";

    const source =
      node.querySelector?.("source");

    const sourceUrl =
      source?.getAttribute("src") ||
      node.getAttribute("src") ||
      element?.getAttribute?.("src") ||
      "";

    if (!sourceUrl) {
      node.dataset.retrying = "0";
      return;
    }

    setTimeout(() => {
      const separator = sourceUrl.includes("?")
        ? "&"
        : "?";

      const nextUrl =
        sourceUrl +
        separator +
        "retry=" +
        Date.now();

      if (node.tagName === "VIDEO") {
        milanSetVideoSource(
          node,
          nextUrl
        );
      } else {
        node.setAttribute(
          "src",
          nextUrl
        );
      }

      node.dataset.retrying = "0";
    }, 80);
  } catch {}
}

async function milanRepairVideo(id, element) {
  const video = mediaNode(element);

  if (
    !video ||
    video.dataset.repairing === "1"
  ) {
    return;
  }

  video.dataset.repairing = "1";

  try {
    setMediaError(
      video,
      "Loading video...",
      true
    );

    const result = await MediaApi.api(
      "/records/" +
        encodeURIComponent(id) +
        "/media/repair?async=1",
      {
        method: "POST",
        body: JSON.stringify({
          async: true
        })
      }
    );

    const record =
      result?.record || null;

    let next = videoMediaSrc(
      record &&
        (
          record.mediaUrl ||
          record.data?.media?.mediaUrl
        )
    );

    if (!next) {
      next = videoMediaSrc(
        "/api/records/" +
          encodeURIComponent(id) +
          "/media"
      );
    }

    next +=
      (next.includes("?") ? "&" : "?") +
      "fixed=" +
      Date.now();

    milanSetVideoSource(
      video,
      next
    );

    try {
      video.load();
      video.play?.().catch(() => {});
    } catch {}

    setTimeout(
      () => clearMediaError(video),
      400
    );

    MediaUtils.toast(
      result?.repaired
        ? "Video ready"
        : "Video checked"
    );
  } catch {
    const box =
      video.closest(".media");

    const card =
      box?.querySelector(".fileCard");

    card?.classList.remove("hidden");

    setMediaError(
      video,
      "Video is uploaded safely. Preview is still preparing; refresh once or tap Open/Download.",
      true
    );
  } finally {
    setTimeout(() => {
      try {
        video.dataset.repairing = "0";
      } catch {}
    }, 1200);
  }
}

async function milanMediaError(id, element) {
  try {
    if (!element) return;

    const node = mediaNode(element);
    const box = node?.closest(".media");

    if (node?.tagName === "VIDEO") {
      if (
        node.dataset.repairStarted !== "1"
      ) {
        node.dataset.repairStarted = "1";

        await milanRepairVideo(
          id,
          node
        );

        return;
      }

      if (
        node.dataset.retryDone !== "1"
      ) {
        node.dataset.retryDone = "1";

        setMediaError(
          node,
          "Retrying video stream...",
          true
        );

        milanRetryMedia(node);
        return;
      }

      const card =
        box?.querySelector(
          ".fileCard"
        );

      card?.classList.remove("hidden");

      setMediaError(
        node,
        "Tap Open or Download to watch this video."
      );

      return;
    }

    if (
      node &&
      node.dataset.retryDone !== "1"
    ) {
      node.dataset.retryDone = "1";
      milanRetryMedia(node);
      return;
    }

    box?.classList.add(
      "previewFailed"
    );

    const card =
      box?.querySelector(
        ".fileCard"
      );

    card?.classList.remove("hidden");

    setMediaError(
      node,
      "Preview could not start. File is uploaded safely and download is available."
    );
  } catch {}
}

function formatBytes(bytes) {
  if (!(bytes = Number(bytes || 0))) {
    return "";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  let index = 0;

  while (
    bytes >= 1024 &&
    index < units.length - 1
  ) {
    bytes /= 1024;
    index++;
  }

  return (
    bytes.toFixed(
      index ? 1 : 0
    ) +
    " " +
    units[index]
  );
}

function fileIcon(category, mime) {
  if (category === "image") return "🖼️";
  if (category === "video") return "🎬";
  if (category === "audio") return "🎧";
  if (category === "pdf") return "📄";
  if (
    (mime || "").includes("zip")
  ) {
    return "🗜️";
  }

  return "📎";
}

function fileCardHtml(
  media,
  rawUrl,
  extra = ""
) {
  const name = MediaUtils.esc(
    media.fileName || "MILAN file"
  );

  const mime = MediaUtils.esc(
    media.mimeType || "file"
  );

  const size =
    formatBytes(media.sizeBytes);

  const open = MediaUtils.esc(
    mediaSrc(rawUrl)
  );

  const download = MediaUtils.esc(
    mediaDownloadSrc(rawUrl)
  );

  return `
    <div class="fileCard ${extra}">
      <div class="fileIcon">
        ${fileIcon(
          media.previewCategory || "",
          media.mimeType
        )}
      </div>

      <div class="fileMeta">
        <b>${name}</b>

        <div class="mini">
          ${mime}${size ? " • " + MediaUtils.esc(size) : ""}
        </div>

        ${
          media.compatibilityWarning
            ? `<div class="mini">${MediaUtils.esc(
                media.compatibilityWarning
              )}</div>`
            : ""
        }
      </div>

      <div class="fileActions">
        <a
          href="${open}"
          target="_blank"
          rel="noopener"
        >Open</a>

        <a
          href="${download}"
          download
        >Download</a>
      </div>
    </div>
  `;
}

function mediaHtml(record) {
  const data =
    record.data || {};

  const media =
    data.media || {};

  const raw =
    record.mediaUrl ||
    media.mediaUrl ||
    data.mediaUrl ||
    "";

  const url = mediaSrc(raw);

  if (!url) return "";

  const mimeType =
    (
      media.mimeType ||
      record.dataFormat ||
      "application/octet-stream"
    ).toLowerCase();

  const category = (
    media.previewCategory ||
    record.mediaCompatibility?.previewCategory ||
    (
      mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("video/")
          ? "video"
          : mimeType.startsWith("audio/")
            ? "audio"
            : mimeType === "application/pdf"
              ? "pdf"
              : mimeType.startsWith("text/")
                ? "text"
                : "file"
    )
  ).toLowerCase();

  const id = MediaUtils.esc(
    record.id || ""
  );

  const errorHtml =
    '<div class="mini mediaLoadError hidden">Preview is loading...</div>';

  const onError =
    `milanMediaError('${id}',this)`;

  const onLoaded =
    "clearMediaError(this)";

  if (category === "image") {
    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <img
          loading="lazy"
          decoding="async"
          data-milan-observe="1"
          src="${MediaUtils.esc(url)}"
          alt="${MediaUtils.esc(
            record.title || "media"
          )}"
          onload="${onLoaded}"
          onerror="${onError}"
        >
        ${errorHtml}
        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "video") {
    const videoUrl =
      videoMediaSrc(raw);

    const videoMime =
      media.browserPlayable === false
        ? "video/mp4"
        : mimeType || "video/mp4";

    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <video
          controls
          preload="none"
          data-milan-observe="1"
          playsinline
          webkit-playsinline
          x5-playsinline
          data-milan-inline-only="1"
          controlsList="nofullscreen nodownload noremoteplayback"
          onloadedmetadata="${onLoaded}"
          oncanplay="${onLoaded}"
          onplaying="${onLoaded}"
          onerror="${onError}"
        >
          <source
            src="${MediaUtils.esc(videoUrl)}"
            type="${MediaUtils.esc(
              videoMime === "video/quicktime"
                ? "video/mp4"
                : videoMime
            )}"
          >
        </video>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "audio") {
    return `
      <div
        class="media audioBox"
        data-record-id="${id}"
      >
        <audio
          controls
          preload="metadata"
          src="${MediaUtils.esc(url)}"
          type="${MediaUtils.esc(
            mimeType || "audio/mpeg"
          )}"
          onloadedmetadata="${onLoaded}"
          oncanplay="${onLoaded}"
          onplaying="${onLoaded}"
          onerror="${onError}"
        ></audio>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "pdf") {
    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <iframe
          loading="lazy"
          data-milan-observe="1"
          data-milan-src="${MediaUtils.esc(url)}"
          title="${MediaUtils.esc(
            media.fileName ||
            record.title ||
            "PDF"
          )}"
          onload="${onLoaded}"
        ></iframe>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw
        )}
      </div>
    `;
  }

  return `
    <div
      class="media"
      data-record-id="${id}"
    >
      ${fileCardHtml(
        media,
        raw
      )}
    </div>
  `;
}

function initMilanMediaObserver() {
  if (
    window.MilanApp.state
      .mediaObserverReady
  ) {
    return;
  }

  const feed =
    document.getElementById("feed");

  if (
    !feed ||
    !("IntersectionObserver" in window)
  ) {
    return;
  }

  window.MilanApp.state
    .mediaObserverReady = true;

  const observer =
    new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }

          const element =
            entry.target;

          if (
            element.tagName === "VIDEO"
          ) {
            try {
              element.load();
            } catch {}
          }

          if (
            element.tagName === "IFRAME"
          ) {
            const src =
              element.getAttribute(
                "data-milan-src"
              );

            if (
              src &&
              !element.getAttribute("src")
            ) {
              element.setAttribute(
                "src",
                src
              );
            }

            element.removeAttribute(
              "data-milan-src"
            );
          }

          element.removeAttribute(
            "data-milan-observe"
          );

          observer.unobserve(
            element
          );
        });
      },
      {
        root: null,
        rootMargin: "700px 0px",
        threshold: 0.01
      }
    );

  window.MilanApp.state
    .mediaObserver = observer;

  feed
    .querySelectorAll(
      "img[data-milan-observe]," +
      "video[data-milan-observe]," +
      "iframe[data-milan-observe]"
    )
    .forEach(element => {
      observer.observe(element);
    });
}

window.MilanApp.media = {
  mediaSrc,
  mediaDownloadSrc,
  videoMediaSrc,
  mediaNode,
  setMediaError,
  clearMediaError,
  milanSetVideoSource,
  milanRetryMedia,
  milanRepairVideo,
  milanMediaError,
  formatBytes,
  fileIcon,
  fileCardHtml,
  mediaHtml,
  initMilanMediaObserver
};

/* Compatibility exports. */
window.mediaSrc = mediaSrc;
window.mediaDownloadSrc = mediaDownloadSrc;
window.videoMediaSrc = videoMediaSrc;
window.mediaNode = mediaNode;
window.setMediaError = setMediaError;
window.clearMediaError = clearMediaError;
window.milanSetVideoSource =
  milanSetVideoSource;
window.milanRetryMedia =
  milanRetryMedia;
window.milanRepairVideo =
  milanRepairVideo;
window.milanMediaError =
  milanMediaError;
window.formatBytes = formatBytes;
window.fileIcon = fileIcon;
window.fileCardHtml =
  fileCardHtml;
window.mediaHtml = mediaHtml;
window.initMilanMediaObserver =
  initMilanMediaObserver;
