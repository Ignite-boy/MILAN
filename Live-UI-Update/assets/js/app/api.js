/* ============================================================
   MILAN APP — API + Upload Infrastructure
   Modular network layer extracted from inline-05.js.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MilanState = window.MilanApp.state;
const MilanConfig = window.MilanApp.config;

function getToken() {
  return MilanState.token || "";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  let response;

  try {
    response = await fetchWithTimeout(
      MilanConfig.API + path,
      {
        ...options,
        headers
      },
      Number(options.timeoutMs || 22000)
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        "Network timeout. Please refresh once."
      );
      timeoutError.status = 0;
      throw timeoutError;
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error || "Request failed " + response.status
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function b64Header(value) {
  try {
    return btoa(
      unescape(
        encodeURIComponent(String(value || ""))
      )
    );
  } catch {
    return btoa(String(value || ""));
  }
}

function apiUploadRaw(path, file, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let completed = false;

    const fail = message => {
      if (completed) return;

      completed = true;
      reject(
        new Error(message || "Upload failed")
      );
    };

    xhr.open(
      "POST",
      MilanConfig.API + path,
      true
    );

    xhr.timeout = Number(
      window.MILAN_UPLOAD_TIMEOUT_MS || 1800000
    );

    const token = getToken();

    if (token) {
      xhr.setRequestHeader(
        "Authorization",
        "Bearer " + token
      );
    }

    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );

    xhr.setRequestHeader(
      "X-File-Name",
      b64Header(file.name)
    );

    xhr.setRequestHeader(
      "X-Record-Title",
      b64Header(meta.title || file.name)
    );

    xhr.setRequestHeader(
      "X-Record-Caption",
      b64Header(meta.caption || "")
    );

    xhr.setRequestHeader(
      "X-Access-Mode",
      meta.accessMode || "private"
    );

    xhr.setRequestHeader(
      "X-Record-Tags",
      b64Header(
        JSON.stringify(meta.tags || [])
      )
    );

    xhr.setRequestHeader(
      "X-Shared-With-Dids",
      b64Header(
        JSON.stringify(meta.sharedWithDids || [])
      )
    );

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !onProgress) return;

      onProgress(
        Math.max(
          1,
          Math.min(
            98,
            (event.loaded / event.total) * 100
          )
        )
      );
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = JSON.parse(
          xhr.responseText || "{}"
        );
      } catch {}

      if (xhr.status >= 200 && xhr.status < 300) {
        completed = true;
        onProgress?.(100);
        resolve(data);
        return;
      }

      fail(
        data.error ||
        "Upload failed " + xhr.status
      );
    };

    xhr.onerror = () =>
      fail(
        "Network error during upload. Keep the browser open and try again."
      );

    xhr.ontimeout = () =>
      fail(
        "Upload is taking too long. Try a smaller video or better network."
      );

    xhr.onabort = () =>
      fail("Upload cancelled.");

    xhr.send(file);
  });
}

function xhrUploadBlob(
  url,
  blob,
  headers,
  onProgress
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let completed = false;

    const fail = message => {
      if (completed) return;

      completed = true;
      reject(
        new Error(
          message || "Upload chunk failed"
        )
      );
    };

    xhr.open("POST", url, true);

    xhr.timeout = Number(
      window.MILAN_CHUNK_UPLOAD_TIMEOUT_MS || 240000
    );

    const token = getToken();

    if (token) {
      xhr.setRequestHeader(
        "Authorization",
        "Bearer " + token
      );
    }

    xhr.setRequestHeader(
      "Content-Type",
      "application/octet-stream"
    );

    Object.entries(headers || {}).forEach(
      ([key, value]) => {
        xhr.setRequestHeader(
          key,
          String(value)
        );
      }
    );

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !onProgress) return;

      onProgress(
        event.loaded,
        event.total
      );
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = JSON.parse(
          xhr.responseText || "{}"
        );
      } catch {}

      if (xhr.status >= 200 && xhr.status < 300) {
        completed = true;
        resolve(data);
        return;
      }

      fail(
        data.error ||
        "Chunk upload failed " + xhr.status
      );
    };

    xhr.onerror = () =>
      fail(
        "Network issue while uploading chunk. Retrying..."
      );

    xhr.ontimeout = () =>
      fail(
        "Chunk upload timed out. Retrying..."
      );

    xhr.onabort = () =>
      fail("Chunk upload cancelled.");

    xhr.send(blob);
  });
}

async function withRetry(fn, retries = 3) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      await new Promise(resolve =>
        setTimeout(
          resolve,
          700 + 900 * attempt
        )
      );
    }
  }

  throw lastError;
}

async function apiUploadChunked(
  path,
  file,
  meta,
  onProgress
) {
  const requestedChunk = Number(
    window.MILAN_UPLOAD_CHUNK_BYTES ||
    6291456
  );

  const init = await api(
    "/records/media/chunk/init",
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType:
          file.type ||
          "application/octet-stream",
        sizeBytes: file.size,
        chunkBytes: requestedChunk,
        title: meta.title || file.name,
        caption: meta.caption || "",
        accessMode:
          meta.accessMode || "private",
        sharedWithDids:
          meta.sharedWithDids || [],
        tags: meta.tags || []
      })
    }
  );

  const uploadId = init.uploadId;

  const chunkBytes = Number(
    init.chunkBytes ||
    requestedChunk
  );

  const totalChunks = Number(
    init.totalChunks ||
    Math.ceil(file.size / chunkBytes)
  );

  let uploadedBytes = 0;

  try {
    for (
      let index = 0;
      index < totalChunks;
      index++
    ) {
      const start =
        index * chunkBytes;

      const end = Math.min(
        file.size,
        start + chunkBytes
      );

      const blob = file.slice(
        start,
        end
      );

      await withRetry(
        () =>
          xhrUploadBlob(
            MilanConfig.API +
              "/records/media/chunk/" +
              encodeURIComponent(uploadId),
            blob,
            {
              "X-Chunk-Index": index,
              "X-Total-Chunks": totalChunks,
              "X-Chunk-Bytes": blob.size
            },
            (loaded) => {
              if (!onProgress) return;

              const percentage =
                ((uploadedBytes + loaded) /
                  file.size) *
                96;

              onProgress(
                Math.max(
                  1,
                  Math.min(
                    96,
                    percentage
                  )
                )
              );
            }
          ),
        4
      );

      uploadedBytes = end;

      onProgress?.(
        Math.max(
          1,
          Math.min(
            96,
            (uploadedBytes /
              file.size) *
              96
          )
        )
      );
    }

    onProgress?.(98);

    const result = await api(
      "/records/media/chunk/" +
        encodeURIComponent(uploadId) +
        "/complete",
      {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: Number(
          window.MILAN_UPLOAD_COMPLETE_TIMEOUT_MS ||
          900000
        )
      }
    );

    onProgress?.(100);

    return result;
  } catch (error) {
    try {
      await api(
        "/records/media/chunk/" +
          encodeURIComponent(uploadId),
        {
          method: "DELETE"
        }
      );
    } catch {}

    throw error;
  }
}

async function apiUpload(
  path,
  file,
  meta,
  onProgress
) {
  const chunkThreshold = Number(
    window.MILAN_CHUNK_UPLOAD_THRESHOLD_BYTES ||
    8388608
  );

  const needsChunkedUpload =
    file &&
    (
      (file.type || "").startsWith("video/") ||
      file.size > chunkThreshold
    );

  return needsChunkedUpload
    ? apiUploadChunked(
        path,
        file,
        meta,
        onProgress
      )
    : apiUploadRaw(
        path,
        file,
        meta,
        onProgress
      );
}

window.MilanApp.api = {
  getToken,
  fetchWithTimeout,
  api,
  b64Header,
  apiUploadRaw,
  xhrUploadBlob,
  withRetry,
  apiUploadChunked,
  apiUpload
};

/* Temporary compatibility exports. */
window.getToken = getToken;
window.fetchWithTimeout = fetchWithTimeout;
window.api = api;
window.b64Header = b64Header;
window.apiUploadRaw = apiUploadRaw;
window.xhrUploadBlob = xhrUploadBlob;
window.withRetry = withRetry;
window.apiUploadChunked = apiUploadChunked;
window.apiUpload = apiUpload;
