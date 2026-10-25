'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const playerPath = path.join(root, 'frontend/assets/js/inline-07.js');
const packagePath = path.join(root, 'package.json');
const player = fs.readFileSync(playerPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

assert.doesNotThrow(
  () => new vm.Script(player, { filename: playerPath }),
  'active video-player script must remain valid JavaScript'
);

const contracts = [
  ['video resources remain viewport-lazy-loaded', /rootMargin:"700px 0px"/],
  ['off-screen playback gets paused', /entry\.intersectionRatio>=\.15[\s\S]*?video\.pause\(\)/],
  ['detached videos are unobserved', /visibilityObserver&&visibilityObserver\.unobserve\(video\)/],
  ['ready Voroa media uses the authenticated stream fallback', /readyStatus==="ready"&&source&&proxy[\s\S]*?source\.setAttribute\("src",proxy\)/],
  ['Data Saver bypasses eager full-file download', /connection\.saveData/],
  ['slow mobile connections bypass eager full-file download', /slow-2g\|2g\|3g/],
  ['temporary video buffers are capped at 24 MiB on low-memory devices', /24\*1024\*1024/],
  ['temporary video buffers are capped at 48 MiB on regular devices', /48\*1024\*1024/]
];

for (const [name, pattern] of contracts) {
  assert.match(player, pattern, name);
  console.log('PASS:', name);
}

assert.equal(
  packageJson.scripts['test:video-scroll'],
  'node scripts/video-scroll-playback-self-test.js',
  'package.json must expose the video-scroll self-test'
);

console.log('PASS: video-scroll self-test is registered in package.json');
console.log('ALL VIDEO SCROLL PLAYBACK SELF-TESTS PASSED (' + (contracts.length + 2) + ' checks).');
