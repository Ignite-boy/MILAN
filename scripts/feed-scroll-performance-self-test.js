'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('frontend/app.html', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const feedContainment = /#feed\s*>\s*article\.post,\s*#feed\s*>\s*\.feed-card,\s*#feed\s*>\s*\[class\*="post-card"\],\s*#feed\s*>\s*\[class\*="feed-card"\]\s*\{\s*contain:\s*content;\s*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto 560px;\s*\}/s;

assert.match(app, feedContainment,
  'off-screen containment must target feed post cards and use an intrinsic-size fallback');
console.log('PASS: off-screen rendering containment is scoped to feed cards');

assert.match(app, /#feed\s*\{\s*min-height:\s*320px;\s*contain:\s*content;\s*\}/s,
  'feed-level containment contract must remain');
console.log('PASS: feed-level containment remains enabled');

assert.match(app, /#feed\s*>\s*\*\s*\{\s*overflow-anchor:\s*auto;\s*\}/s,
  'feed scroll anchoring must remain enabled');
console.log('PASS: browser scroll anchoring remains enabled');

assert.doesNotMatch(app,
  /\.post,\s*\.card,\s*\.feed-card,\s*\[class\*="post-card"\],\s*\[class\*="feed-card"\]\s*\{\s*contain:content;\s*content-visibility:auto;\s*contain-intrinsic-size:280px;\s*\}/s,
  'generic application cards must not inherit the old broad feed rule');
console.log('PASS: old broad containment rule is removed');

assert.equal(packageJson.scripts['test:feed-smoothness'],
  'node scripts/feed-scroll-performance-self-test.js');
console.log('PASS: feed smoothness regression test is registered');
console.log('ALL FEED SMOOTHNESS CONTRACT TESTS PASSED.');
