/* ============================================================
   MILAN APP — Shared Runtime State
   Central state bridge for modular app runtime.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

window.MilanApp.state = window.MilanApp.state || {
  token: "",
  me: null,
  currentFeed: [],
  people: [],
  lastNotifications: [],
  currentScope: "all",

  feedSeq: 0,
  feedTmp: null,
  feedLimit: 10,
  feedNoMe: false,

  bootPromise: null,
  appReady: false,

  lastSummary: null,

  mediaObserver: null,
  mediaObserverReady: false,

  backgroundTick: null,

  native: false
};

window.MilanApp.config = window.MilanApp.config || {
  API: "/api",
  nativeUA: /MilanNativeAudio/i
};

window.MilanApp.getState = function () {
  return window.MilanApp.state;
};
