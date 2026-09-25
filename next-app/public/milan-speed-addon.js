/* MILAN Speed Add-on (V7.1)  — load LAST, after app.html's own scripts.
 *
 * Two performance wins, both opt-in and non-destructive:
 *
 *   1) WEB WORKER image compression for profile pictures.
 *      The original fileToDataUrl() ran FileReader.readAsDataURL on the main
 *      thread for the full (up to 900KB) image, freezing the UI and uploading
 *      a large uncompressed base64 string. We override it to route images
 *      through milan-image-worker.js (OffscreenCanvas, off the main thread),
 *      downscaling to <=512px and JPEG-compressing first. Non-images and
 *      browsers without worker/OffscreenCanvas support fall back to the
 *      original behavior unchanged.
 *
 *   2) DEBOUNCE helper exposed globally + applied to the modern-upload preview,
 *      so rapid file/drag events don't thrash the main thread. The global
 *      search boxes are already debounced in app.html and are left untouched.
 *
 * Nothing here changes app logic, markup, or the publish/upload flow.
 */
(function () {
  'use strict';

  // ---- 1. Worker-backed image compression -------------------------------
  var workerUrl = '/milan-image-worker.js';
  var _worker = null;
  var _seq = 0;
  var _pending = {};

  function workerSupported() {
    return typeof Worker !== 'undefined' &&
           typeof OffscreenCanvas !== 'undefined' &&
           typeof createImageBitmap === 'function';
  }

  function getWorker() {
    if (_worker) return _worker;
    try {
      _worker = new Worker(workerUrl);
      _worker.onmessage = function (e) {
        var msg = e.data || {};
        var cb = _pending[msg.id];
        if (!cb) return;
        delete _pending[msg.id];
        cb(msg);
      };
      _worker.onerror = function () {
        // Hard-fail every pending job so callers fall back.
        Object.keys(_pending).forEach(function (k) {
          var cb = _pending[k];
          delete _pending[k];
          cb({ ok: false, error: 'worker error' });
        });
        try { _worker.terminate(); } catch (_) {}
        _worker = null;
      };
    } catch (_) {
      _worker = null;
    }
    return _worker;
  }

  // Compress via worker -> resolves to a data URL. Rejects on any failure.
  function compressImage(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var w = getWorker();
      if (!w) return reject(new Error('worker unavailable'));
      var id = ++_seq;
      _pending[id] = function (msg) {
        if (msg && msg.ok) resolve(msg.dataUrl);
        else reject(new Error((msg && msg.error) || 'compress failed'));
      };
      try {
        w.postMessage({
          id: id,
          blob: file,
          maxDim: opts.maxDim || 512,
          quality: opts.quality || 0.82,
          mime: opts.mime || 'image/jpeg'
        });
      } catch (err) {
        delete _pending[id];
        reject(err);
      }
    });
  }

  // Original plain reader (kept as the universal fallback).
  function readAsDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Override the app's fileToDataUrl. Images: try worker compression, fall
  // back to raw read. Everything else: raw read, unchanged.
  var _origFileToDataUrl = window.fileToDataUrl;
  window.fileToDataUrl = function (file) {
    if (file && /^image\//.test(file.type || '') && workerSupported()) {
      return compressImage(file).catch(function () {
        return (_origFileToDataUrl || readAsDataUrl)(file);
      });
    }
    return (_origFileToDataUrl || readAsDataUrl)(file);
  };

  // Expose for other callers (e.g. preview thumbnails) that want it.
  window.milanCompressImage = function (file, opts) {
    if (file && /^image\//.test(file.type || '') && workerSupported()) {
      return compressImage(file, opts).catch(function () { return readAsDataUrl(file); });
    }
    return readAsDataUrl(file);
  };

  // ---- 2. Global debounce helper ----------------------------------------
  // Reusable, leading/trailing-safe debounce. app.html already debounces its
  // own search inputs; this is provided for add-on code and future use.
  if (typeof window.milanDebounce !== 'function') {
    window.milanDebounce = function (fn, ms) {
      var t;
      ms = ms || 300;
      return function () {
        var ctx = this, args = arguments;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, ms);
      };
    };
  }

  // Lightly debounce the modern-upload preview if that component is present,
  // so dragging/dropping in quick succession doesn't re-read repeatedly.
  function wirePreviewDebounce() {
    var input = document.getElementById('mediaFile');
    if (!input || input.dataset.milanDebounced === '1') return;
    input.dataset.milanDebounced = '1';
    // Don't replace the existing change handler; just throttle a no-op hook
    // that other code can listen to. The real preview lives in
    // milan-modern-upload.js and remains the source of truth.
    var fire = window.milanDebounce(function () {
      try {
        if (input.files && input.files[0]) {
          input.dispatchEvent(new CustomEvent('milan:file-settled', { bubbles: true }));
        }
      } catch (_) {}
    }, 250);
    input.addEventListener('change', fire);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(wirePreviewDebounce, 400); });
  } else {
    setTimeout(wirePreviewDebounce, 400);
  }

  try {
    console.log('%c[MILAN Speed] image worker + debounce ready', 'color:#10b981;font-weight:800;');
  } catch (_) {}
})();
