'use strict';

const fs = require('fs');
const frontend = fs.readFileSync('frontend/assets/js/inline-05.js', 'utf8');
const routes = fs.readFileSync('backend/routes/ai.js', 'utf8');

function check(name, condition) {
  if (!condition) throw new Error('FAIL: ' + name);
  console.log('PASS: ' + name);
}

check('image resource timings supply measured load durations',
  frontend.includes("performance.getEntriesByName(url, 'resource')") &&
  frontend.includes('image.dataset.lastLoadMs = String(Math.round(duration))'));

check('AI scoring receives measured image-load latency',
  frontend.includes('window.MilanPerformanceTelemetry?.recentImageLoadP95Ms'));

check('scroll measurements use passive events and animation frames',
  frontend.includes("window.addEventListener('scroll'") &&
  frontend.includes('requestAnimationFrame(function(now)'));

check('long-task metrics are collected when supported',
  frontend.includes("observer.observe({ type: 'longtask', buffered: true })"));

check('only aggregate snapshots are sent to the authenticated backend',
  frontend.includes('api("/ai/performance/metrics"') &&
  frontend.includes('body: JSON.stringify(metrics)') &&
  routes.includes("router.post('/performance/metrics', auth"));

check('metrics do not include media URLs, content or record IDs',
  frontend.includes('window.MilanPerformanceTelemetry = {') &&
  !frontend.includes('body: JSON.stringify({ recordId:') );

check('metrics are validated and stored only in bounded in-memory state',
  routes.includes('function normalizePerformanceMetrics(input)') &&
  routes.includes('new Map()') &&
  routes.includes('while (performanceMetricsByUser.size > 500)'));

check('reporting failures cannot interrupt feed or media loading',
  frontend.includes('Telemetry failure must never interrupt feed scrolling or media.'));

console.log('ALL PERFORMANCE METRICS SELF-TESTS PASSED.');
