/* MILAN service worker - v95
   Goal: stay FRESH on Android/WebView (no stale app shell) while still giving a
   real offline experience. We do NOT cache the HTML/JS app shell (prevents old
   login patches from returning). We DO precache a small offline fallback + icons
   so failed navigations show a proper page instead of a browser error. */

var CACHE_NAME = 'milan-v101-offline-shell';
var OFFLINE_URL = '/offline.html';
var PRECACHE = [OFFLINE_URL, '/favicon.svg', '/assets/icon-192.png', '/manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE_NAME ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.indexOf('/api/') === 0 || req.headers.has('range') ||
      /\.(mp4|webm|mov|m4v|3gp|m3u8)$/i.test(url.pathname)) return;

  // Versioned JS/CSS (?v=...) are immutable: cache-first. The URL changes when
  // the file changes, so this can never serve a stale build — it just makes
  // repeat app opens instant and tolerant of flaky mobile networks.
  if (/\.(js|css)$/i.test(url.pathname) && /[?&]v=/.test(url.search)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Navigations: always try network fresh; if offline, show cached offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(function () { return fetch(req); })
        .catch(function () { return caches.match(OFFLINE_URL); })
    );
    return;
  }

  // Static precached assets: network-first, fall back to cache.
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .catch(function () { return caches.match(req); })
      .then(function (res) {
        return res || caches.match(req).then(function (c) {
          return c || caches.match(OFFLINE_URL);
        });
      })
  );
});
