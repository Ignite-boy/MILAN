/* MILAN perf guard: pause every setInterval while the tab is hidden. */
(function () {
  if (window.__milanPerfGuard) return;
  window.__milanPerfGuard = true;
  var nativeSet = window.setInterval.bind(window);
  var nativeClear = window.clearInterval.bind(window);
  var jobs = new Map();
  var seq = 0;

  window.setInterval = function (fn, ms) {
    if (typeof fn !== "function") return nativeSet.apply(window, arguments);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = ++seq;
    var job = { fn: fn, ms: Math.max(Number(ms) || 0, 0), extra: extra, handle: null };
    function run() {
      if (document.hidden) return;
      try { job.fn.apply(window, job.extra); } catch (e) { console.warn("[perf-guard]", e); }
    }
    job.handle = nativeSet(run, job.ms);
    job.run = run;
    jobs.set(id, job);
    return id;
  };

  window.clearInterval = function (id) {
    var job = jobs.get(id);
    if (job) { nativeClear(job.handle); jobs.delete(id); return; }
    nativeClear(id);
  };

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    jobs.forEach(function (job) { try { job.run(); } catch (_) {} });
  });
})();
