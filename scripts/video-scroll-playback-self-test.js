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
  ['previously playing videos resume on re-entry', /delete video\.dataset\.milanPausedOffscreen;[\s\S]*?video\.play\(\)/],
  ['detached videos are unobserved', /visibilityObserver&&visibilityObserver\.unobserve\(video\)/],
  ['ready Voroa media uses the authenticated stream fallback', /readyStatus==="ready"&&source&&proxy[\s\S]*?source\.setAttribute\("src",proxy\)/],
  ['Data Saver bypasses eager full-file download', /connection\.saveData/],
  ['slow mobile connections bypass eager full-file download', /slow-2g\|2g\|3g/],
  ['full-file Blob playback is explicitly opt-in', /window\\.MILAN_ENABLE_TEMP_PLAYBACK_DOWNLOAD!==true/],
  ['actual streamed bytes are bounded before Blob allocation', /async function readBoundedVideoBlob[\s\S]*?total>maxBytes[\s\S]*?reader\.cancel/],
  ['temporary video buffers are capped at 24 MiB on low-memory devices', /24\*1024\*1024/],
  ['temporary video buffers are capped at 48 MiB on regular devices', /48\*1024\*1024/],
  ['downloads do not auto-resume while off-screen', /video\.dataset\.milanOffscreen==="1"[\s\S]*?video\.dataset\.milanPausedOffscreen="1"/]
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

function makeVideo(id) {
  const attributes = new Map([
    ['data-base-src', '/api/records/' + id + '/media/play.mp4?universal=1']
  ]);
  const sourceAttributes = new Map([
    ['src', 'https://cdn.example.test/video.mp4?token=test-token']
  ]);
  const source = {
    getAttribute(name) { return sourceAttributes.get(name) || null; },
    setAttribute(name, value) { sourceAttributes.set(name, String(value)); }
  };
  const boxAttributes = new Map([['data-record-id', id]]);
  const boxClasses = new Set();
  const box = {
    classList: {
      toggle(name, enabled) {
        if (enabled) boxClasses.add(name);
        else boxClasses.delete(name);
      },
      contains(name) { return boxClasses.has(name); }
    },
    getAttribute(name) { return boxAttributes.get(name) || null; },
    setAttribute(name, value) { boxAttributes.set(name, String(value)); },
    removeAttribute(name) { boxAttributes.delete(name); },
    querySelector() { return null; }
  };
  const listeners = new Map();
  const video = {
    dataset: {},
    paused: false,
    ended: false,
    isConnected: true,
    duration: 120,
    currentTime: 0,
    readyState: 4,
    error: null,
    networkState: 1,
    pauseCount: 0,
    playCount: 0,
    loadCount: 0,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener();
    },
    closest() { return box; },
    querySelector() { return source; },
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    pause() { this.paused = true; this.pauseCount += 1; },
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); },
    load() { this.loadCount += 1; },
    source,
    box
  };
  return video;
}

function makeHarness(options = {}) {
  const videos = options.videos || [];
  const observers = [];
  const mutationObservers = [];
  const timers = [];
  const objectUrls = { created: [], revoked: [] };

  class FakeIntersectionObserver {
    constructor(callback, observerOptions) {
      this.callback = callback;
      this.options = observerOptions || {};
      this.observed = new Set();
      this.unobserved = [];
      observers.push(this);
    }
    observe(video) { this.observed.add(video); }
    unobserve(video) { this.observed.delete(video); this.unobserved.push(video); }
    disconnect() { this.observed.clear(); }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      mutationObservers.push(this);
    }
    observe() {}
    disconnect() {}
  }

  class FakeBlob {
    constructor(chunks, blobOptions = {}) {
      this.size = chunks.reduce((sum, chunk) => {
        return sum + Number(chunk && (chunk.byteLength ?? chunk.length) || 0);
      }, 0);
      this.type = blobOptions.type || '';
    }
  }

  const document = {
    head: { appendChild() {} },
    documentElement: {},
    createElement() { return {}; },
    querySelectorAll() { return videos; },
    getElementById() { return null; }
  };
  const window = {
    __milanUniversalVideoV66: false,
    addEventListener() {},
    mediaHtml() { return 'legacy-media-renderer'; },
    renderFeed() {}
  };
  if (options.enableTemporaryDownload === true) {
    window.MILAN_ENABLE_TEMP_PLAYBACK_DOWNLOAD = true;
  }
  const response = options.response;
  let fetchCount = 0;
  const fetchStub = async (...args) => {
    fetchCount += 1;
    if (typeof options.fetch === 'function') return options.fetch(...args);
    if (!response) throw new Error('Unexpected fetch in playback test');
    return response;
  };
  const URLApi = {
    createObjectURL(blob) {
      const value = 'blob:video-scroll-test-' + (objectUrls.created.length + 1);
      objectUrls.created.push({ url: value, blob });
      return value;
    },
    revokeObjectURL(value) { objectUrls.revoked.push(value); }
  };
  const context = {
    window,
    document,
    navigator: {
      deviceMemory: options.deviceMemory ?? 8,
      connection: options.connection
    },
    IntersectionObserver: FakeIntersectionObserver,
    MutationObserver: FakeMutationObserver,
    URL: URLApi,
    Blob: FakeBlob,
    fetch: fetchStub,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {} }
  };

  new vm.Script(player, { filename: playerPath }).runInNewContext(context);
  return {
    window,
    document,
    observers,
    mutationObservers,
    timers,
    objectUrls,
    get fetchCount() { return fetchCount; },
    attachFeedVideos() {
      window.renderFeed();
      const renderTimer = timers.find(timer => timer.delay === 120);
      assert.ok(renderTimer, 'feed renderer should schedule media attachment');
      renderTimer.callback();
    }
  };
}

function visibilityObserver(harness) {
  const observer = harness.observers.find(item => Array.isArray(item.options.threshold));
  assert.ok(observer, 'visibility observer should be installed');
  return observer;
}

async function flushAsyncWork() {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
}

async function testPauseAndResumeAcrossScrolling() {
  const video = makeVideo('scroll-resume');
  const harness = makeHarness({ videos: [video] });
  harness.attachFeedVideos();
  const observer = visibilityObserver(harness);

  observer.callback([{ target: video, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(video.paused, true, 'a playing off-screen video should pause');
  assert.equal(video.dataset.milanPausedOffscreen, '1', 'pause should be remembered');

  observer.callback([{ target: video, isIntersecting: true, intersectionRatio: 0.8 }]);
  assert.equal(video.paused, false, 'video should resume when it returns to view');
  assert.equal(video.playCount, 1, 're-entry should issue one resume request');
  assert.equal(video.dataset.milanPausedOffscreen, undefined, 'resume marker should clear');

  const manuallyPaused = makeVideo('manual-pause');
  manuallyPaused.paused = true;
  observer.callback([{ target: manuallyPaused, isIntersecting: true, intersectionRatio: 0.9 }]);
  assert.equal(manuallyPaused.playCount, 0, 'a user-paused video must not auto-play');
  console.log('PASS: off-screen pause resumes on re-entry without overriding manual pause');
}

async function testDetachedVideoCleanup() {
  const video = makeVideo('detached-cleanup');
  const harness = makeHarness({ videos: [video] });
  harness.attachFeedVideos();
  const direct = harness.observers.find(item => item.options.rootMargin === '700px 0px');
  const visible = visibilityObserver(harness);
  video.isConnected = false;
  harness.mutationObservers[0].callback([{ type: 'childList' }]);
  assert.ok(direct.unobserved.includes(video), 'direct loader should unobserve removed video');
  assert.ok(visible.unobserved.includes(video), 'visibility observer should unobserve removed video');
  console.log('PASS: removed videos are detached from both observers');
}

function makeStreamResponse({ declaredLength, chunks }) {
  const state = { index: 0, cancelled: 0, released: 0, bodyCancelled: 0 };
  const reader = {
    async read() {
      if (state.index >= chunks.length) return { done: true };
      return { done: false, value: chunks[state.index++] };
    },
    async cancel() { state.cancelled += 1; },
    releaseLock() { state.released += 1; }
  };
  return {
    state,
    response: {
      ok: true,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === 'content-length') return String(declaredLength);
          if (String(name).toLowerCase() === 'content-type') return 'video/mp4';
          return null;
        }
      },
      body: {
        getReader() { return reader; },
        async cancel() { state.bodyCancelled += 1; }
      }
    }
  };
}

async function testDefaultUsesNativeStreaming() {
  const response = makeStreamResponse({
    declaredLength: 3,
    chunks: [new Uint8Array([1, 2, 3])]
  });
  const video = makeVideo('default-streaming');
  video.dataset.milanDirectReady = '1';
  const harness = makeHarness({ videos: [video], response: response.response });
  harness.attachFeedVideos();
  video.dispatch('play');
  await flushAsyncWork();

  assert.equal(harness.fetchCount, 0, 'default playback must not fetch the entire video file');
  assert.equal(harness.objectUrls.created.length, 0, 'default playback must not allocate a temporary Blob URL');
  assert.equal(video.source.getAttribute('src'), 'https://cdn.example.test/video.mp4?token=test-token');
  console.log('PASS: default playback stays on native range streaming');
}

async function testActualStreamBytesAreBounded() {
  const largeActualStream = makeStreamResponse({
    declaredLength: 16 * 1024 * 1024,
    chunks: [
      { byteLength: 16 * 1024 * 1024 },
      { byteLength: 16 * 1024 * 1024 }
    ]
  });
  const video = makeVideo('large-stream');
  video.dataset.milanDirectReady = '1';
  const harness = makeHarness({ videos: [video], deviceMemory: 2, response: largeActualStream.response, enableTemporaryDownload: true });
  harness.attachFeedVideos();
  video.dispatch('play');
  await flushAsyncWork();

  assert.equal(largeActualStream.state.cancelled, 1, 'stream must cancel once actual bytes exceed the low-memory cap');
  assert.equal(harness.objectUrls.created.length, 0, 'over-limit media must never be wrapped in a Blob URL');
  assert.ok(video.playCount >= 1, 'player should fall back to normal streaming after bounded download is cancelled');
  assert.equal(video.dataset.milanTempBlobUrl, undefined, 'no temporary Blob URL should be retained');
  console.log('PASS: misleading Content-Length cannot bypass the actual streamed-byte limit');
}

async function testSmallStreamCanUseTemporaryBlob() {
  const smallStream = makeStreamResponse({
    declaredLength: 3,
    chunks: [new Uint8Array([1, 2, 3])]
  });
  const video = makeVideo('small-stream');
  video.dataset.milanDirectReady = '1';
  const harness = makeHarness({ videos: [video], response: smallStream.response, enableTemporaryDownload: true });
  harness.attachFeedVideos();
  video.dispatch('play');
  await flushAsyncWork();

  assert.equal(harness.objectUrls.created.length, 1, 'small media should create one temporary Blob URL');
  assert.match(video.source.getAttribute('src'), /^blob:video-scroll-test-/);
  assert.equal(video.dataset.milanTempDownloadComplete, '1');
  assert.equal(video.dataset.milanTempDownloadInProgress, undefined);
  console.log('PASS: small media uses bounded temporary Blob playback');
}

async function testDataSaverSkipsDownload() {
  const response = makeStreamResponse({ declaredLength: 3, chunks: [new Uint8Array([1, 2, 3])] });
  const video = makeVideo('data-saver');
  video.dataset.milanDirectReady = '1';
  const harness = makeHarness({
    videos: [video],
    response: response.response,
    connection: { saveData: true, effectiveType: '4g' },
    enableTemporaryDownload: true
  });
  harness.attachFeedVideos();
  video.dispatch('play');
  await flushAsyncWork();
  assert.equal(harness.fetchCount, 0, 'Data Saver should not download the full video eagerly');
  assert.equal(harness.objectUrls.created.length, 0);
  console.log('PASS: Data Saver keeps playback on native streaming');
}

async function testReentryWaitsForInFlightDownload() {
  let resolveFetch;
  const fetchPending = new Promise(resolve => { resolveFetch = resolve; });
  const smallStream = makeStreamResponse({
    declaredLength: 3,
    chunks: [new Uint8Array([1, 2, 3])]
  });
  const video = makeVideo('scroll-during-download');
  video.dataset.milanDirectReady = '1';
  const harness = makeHarness({ videos: [video], fetch: () => fetchPending, enableTemporaryDownload: true });
  harness.attachFeedVideos();
  const observer = visibilityObserver(harness);
  video.dispatch('play');
  assert.equal(harness.fetchCount, 1, 'play should start a bounded download');
  await Promise.resolve();

  observer.callback([{ target: video, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(video.dataset.milanPausedOffscreen, '1', 'in-flight download should remember offscreen state');
  observer.callback([{ target: video, isIntersecting: true, intersectionRatio: 0.9 }]);
  assert.equal(video.playCount, 0, 're-entry must not restart the stream before the download settles');

  resolveFetch(smallStream.response);
  await flushAsyncWork();
  assert.equal(video.playCount, 1, 'completed download should resume exactly once after the video is visible');
  assert.match(video.source.getAttribute('src'), /^blob:video-scroll-test-/);
  console.log('PASS: returning during a download waits for completion without resetting playback');
}
async function main() {
  await testPauseAndResumeAcrossScrolling();
  await testDetachedVideoCleanup();
  await testDefaultUsesNativeStreaming();
  await testActualStreamBytesAreBounded();
  await testSmallStreamCanUseTemporaryBlob();
  await testDataSaverSkipsDownload();
  await testReentryWaitsForInFlightDownload();
  console.log('ALL VIDEO SCROLL PLAYBACK SELF-TESTS PASSED (' + (contracts.length + 7) + ' checks).');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
