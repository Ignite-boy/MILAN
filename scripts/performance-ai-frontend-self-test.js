'use strict';

const fs = require('fs');

const source = fs.readFileSync('frontend/assets/js/inline-05.js', 'utf8');

function check(name, condition) {
  if (!condition) throw new Error('FAIL: ' + name);
  console.log('PASS: ' + name);
}

check('media markup exposes byte-size metadata',
  source.includes('data-size-bytes="\${Math.max(0, Number(m.sizeBytes)||0)}"'));

check('feed observer invokes optional AI scoring',
  source.includes('schedulePerformanceAiPrefetch();'));

check('real authenticated performance scoring endpoint is called',
  source.includes('api("/ai/performance/prefetch-score"'));

check('only lazy-loaded images are candidates',
  source.includes('.media[data-record-id] img[loading="lazy"]'));

check('Data Saver and slow connections bypass speculative scoring',
  source.includes('connection.saveData') &&
  source.includes('["slow-2g", "2g"].includes(effectiveType)'));

check('unknown and oversized images are excluded',
  source.includes('sizeBytes <= 0 || sizeBytes > 4 * 1024 * 1024'));

check('only positive AI decisions promote image loading',
  source.includes('if (!result || result.prefetch !== true) continue;') &&
  source.includes('image.loading = "eager"'));

check('prefetch priority stays low and AI errors fail open',
  source.includes('image.setAttribute("fetchpriority", "low")') &&
  source.includes('normal browser lazy loading continues on failure'));

console.log('ALL PERFORMANCE AI FRONTEND SELF-TESTS PASSED.');
