(function () {
  "use strict";
  if (window.__milanPredictiveLayerV2) return;
  window.__milanPredictiveLayerV2 = true;

  const seen = new Set();
  const order = [];
  const ratios = new Map();
  const maxSeen = 1200;
  let active = "";
  let observer;
  let mutationObserver;
  let timer = null;
  let lastFetch = 0;
  let earlyPrepares = 0;

  function token() {
    try { return localStorage.getItem("milan_token") || ""; }
    catch (_) { return ""; }
  }

  function networkAllowsPrefetch() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return !(connection && (connection.saveData ||
      /^(slow-2g|2g)$/i.test(String(connection.effectiveType || ""))));
  }

  async function api(path, options) {
    const currentToken = token();
    if (!currentToken) return null;
    const opts = Object.assign({ cache: "no-store", credentials: "same-origin" }, options || {});
    opts.headers = Object.assign({
      Accept: "application/json",
      Authorization: "Bearer " + currentToken
    }, opts.headers || {});
    if (opts.body) opts.headers["Content-Type"] = "application/json";
    const response = await fetch("/api" + path, opts);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Predictive API HTTP " + response.status);
    return data;
  }

  function recordId(card) {
    const raw = String(card.id || "").startsWith("post-")
      ? card.id.slice(5) : card.getAttribute("data-record-id") || "";
    const id = String(raw).trim();
    return id && id.length <= 256 && !/[\u0000-\u001f]/.test(id) ? id : "";
  }

  function schedulePredictions() {
    if (timer !== null) return;
    const delay = Math.max(300, 4500 - (Date.now() - lastFetch));
    timer = setTimeout(function () {
      timer = null;
      fetchPredictions();
    }, delay);
  }

  async function recordView(id) {
    if (!token() || seen.has(id)) return;
    seen.add(id);
    order.push(id);
    while (order.length > maxSeen) seen.delete(order.shift());
    try {
      const result = await api("/stream/view", {
        method: "POST", body: JSON.stringify({ contentCid: id })
      });
      if (result && result.ok) schedulePredictions();
    } catch (_) {
      // Prediction must never block ordinary feed use.
    }
  }

  function prepareCandidate(id) {
    if (earlyPrepares >= 1) return false;
    const card = document.getElementById("post-" + id);
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.top <= height + 900) return false;

    const video = card.querySelector(".milanUniversalPlayer video, video[data-milan-inline-only='1']");
    if (!video || video.dataset.milanPredictivePrepared === "1" ||
        video.dataset.milanDirectReady === "1" || video.dataset.milanDirectLoading === "1" ||
        video.dataset.milanDirectFallback === "1" ||
        typeof window.milanEnsureDirectVideo !== "function") return false;

    video.dataset.milanPredictivePrepared = "1";
    earlyPrepares++;
    try {
      const result = window.milanEnsureDirectVideo(video, id);
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (_) {}
    return true;
  }

  async function fetchPredictions() {
    if (!token() || !networkAllowsPrefetch()) return;
    lastFetch = Date.now();
    try {
      const feed = document.getElementById("feed");
      const candidateIds = feed
        ? Array.from(feed.querySelectorAll("article.post")).map(recordId).filter(Boolean).slice(0, 12)
        : [];
      if (!candidateIds.length) return;
      const params = new URLSearchParams();
      candidateIds.forEach(id => params.append("candidateId", id));
      const data = await api("/stream/prefetch?" + params.toString());
      const predictions = data && Array.isArray(data.prefetch) ? data.prefetch : [];
      for (const item of predictions) {
        const id = String(item && item.recordId || "").trim();
        if (id && id.length <= 256 && prepareCandidate(id)) break;
      }
    } catch (_) {
      // Ordinary playback remains the fallback.
    }
  }

  function onIntersect(entries) {
    for (const entry of entries) ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    let best = null;
    let bestRatio = 0;
    for (const [card, ratio] of ratios) {
      if (!card.isConnected) { ratios.delete(card); continue; }
      if (ratio > bestRatio) { best = card; bestRatio = ratio; }
    }
    if (best && bestRatio >= 0.60) {
      const id = recordId(best);
      if (id && id !== active) { active = id; recordView(id); }
    }
  }

  function attach() {
    const feed = document.getElementById("feed");
    if (!feed) return;
    if ("IntersectionObserver" in window) {
      if (!observer) observer = new IntersectionObserver(onIntersect, { threshold: [0, 0.4, 0.6, 0.8, 1] });
      feed.querySelectorAll("article.post").forEach(card => {
        if (card.dataset.milanPredictiveObserved) return;
        card.dataset.milanPredictiveObserved = "1";
        observer.observe(card);
      });
    }
    if (!mutationObserver && "MutationObserver" in window) {
      mutationObserver = new MutationObserver(attach);
      mutationObserver.observe(feed, { childList: true, subtree: true });
    }
  }

  function start() {
    attach();
    if (!document.getElementById("feed") && document.body && "MutationObserver" in window) {
      const mutation = new MutationObserver(function () {
        if (document.getElementById("feed")) { mutation.disconnect(); attach(); }
      });
      mutation.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.MilanPredictiveLayer = {
    version: 2,
    get status() {
      return { trackedRecords: seen.size, observedCards: ratios.size, earlyVideoPrepares: earlyPrepares };
    }
  };
})();
