#!/usr/bin/env node
'use strict';

// Repository/configuration integrity gate. This is not a frontend bundler and
// deliberately does not claim to exercise live integrations or user flows.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

const requiredFiles = [
  'frontend/index.html',
  'frontend/app.html',
  'frontend/chat/index.html',
  'frontend/milan-core.css',
  'frontend/milan-login-pro.css',
  'backend/server.js',
  'backend/middleware/auth.js',
  'backend/services/cloudDwnRegistry.js',
  'Milan-Sentinel/scripts/run-matrix.js',
  'Milan-Sentinel/scripts/execute-case.js',
  'docs/MILAN_ONE_ARCHITECTURE.md',
  'docs/ENVIRONMENT_CONTRACT.md'
];
for (const file of requiredFiles) check(exists(file), `Required file missing: ${file}`);

let pkg, serverSource, matrix;
try { pkg = JSON.parse(read('package.json')); } catch (error) { failures.push(`package.json invalid JSON: ${error.message}`); }
try { serverSource = read('backend/server.js'); } catch (error) { failures.push(`backend/server.js unavailable: ${error.message}`); }
try { matrix = JSON.parse(read('Milan-Sentinel/scenarios/test-matrix.json')); } catch (error) { failures.push(`Sentinel matrix invalid JSON: ${error.message}`); }

check(pkg && pkg.engines && pkg.engines.node && Number.parseInt(pkg.engines.node.replace(/[^0-9]/g, ''), 10) >= 22,
  'Root package must declare Node.js 22+.');
check(pkg && pkg.scripts && pkg.scripts.build === 'node scripts/verify-build.js',
  'Root build script must run the real repository integrity verifier.');
check(pkg && pkg.scripts && pkg.scripts.start === 'node -r ./backend/services/avatar-hydration-guard.js backend/server.js',
  'Production start script must launch the Express Node service.');
  check(pkg && pkg.dependencies && typeof pkg.dependencies === 'object',
    'Root package must declare a runtime dependency map.');
  check(exists('backend/server.js'),
    'Express backend entry point must exist.');
check(exists('frontend/ai-info.json'), 'Machine-readable /ai-info.json document is missing.');
const requiredAliases = [
  { source: '/sitemap_index.xml', route: "app.get(['/sitemap-index.xml', '/sitemap_index.xml']", target: 'sitemap-index.xml' },
  { source: '/ai-info', route: "app.get(['/ai-info', '/ai-info.json']", target: 'ai-info.json' },
  { source: '/keywords', route: "app.get(['/keywords', '/keywords.html', '/topics']", target: 'keywords.html' },
  { source: '/topics', route: "app.get(['/keywords', '/keywords.html', '/topics']", target: 'keywords.html' }
];
for (const alias of requiredAliases) {
  check(serverSource && serverSource.includes(alias.route),
    `Express route for ${alias.source} must remain configured.`);
  check(exists(path.join('frontend', alias.target)),
    `Static alias target is missing: ${alias.target}`);
}

if (matrix && matrix.dimensions) {
  const dimensions = Object.entries(matrix.dimensions);
  let count = 1;
  for (const [name, values] of dimensions) {
    check(Array.isArray(values) && values.length > 0, `Sentinel dimension "${name}" must be a non-empty array.`);
    count *= Array.isArray(values) ? values.length : 0;
  }
  check(count === matrix.caseCount, `Sentinel theoretical matrix mismatch: dimensions produce ${count}, caseCount is ${matrix.caseCount}.`);
  check(count === 10000000, `Expected the documented 10,000,000 theoretical combinations; got ${count}.`);
}

const syntaxCheckFiles = [
  'backend/server.js',
  'backend/middleware/auth.js',
  'backend/services/cloudDwnRegistry.js',
  'backend/services/dwnService.js',
  'backend/routes/records.js',
  'backend/routes/auth.js',
  'backend/routes/did.js',
  'backend/services/resumableMediaCommit.js',
  'backend/services/persistenceFailure.js',
  'backend/services/aiBestTime.js',
  'backend/services/sessionTokens.js',
  'backend/services/authSessionStore.js',
  'backend/services/livePush.js',
  'scripts/upload-chunk-self-test.js',
  'backend/routes/isolatedDwn.js',
  'backend/services/readiness.js',
  'backend/routes/launch.js',
  'frontend/assets/js/inline-05.js',
  'frontend/assets/js/inline-07.js',
  'frontend/assets/js/milan-ui-actions.js',
  'frontend/milan-live.js',
  'Milan-Sentinel/scripts/run-matrix.js',
  'Milan-Sentinel/scripts/execute-case.js',
];
for (const file of syntaxCheckFiles) {
  if (!exists(file)) { failures.push(`Cannot syntax-check missing file: ${file}`); continue; }
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  check(result.status === 0, `JavaScript syntax error in ${file}: ${result.stderr || result.error || 'unknown error'}`);
}

if (exists('backend/server.js')) {
  const server = read('backend/server.js');
  check(server.includes("const APP_VERSION = require('../package.json').version;"),
    'API version must be sourced from root package.json.');
  check(server.includes("healthSemantics:") && server.includes("level: 'liveness'"),
    'API health must label liveness separately from provider/protocol readiness.');
  check(server.includes("app.get('/api/ready'") && server.includes("checkDatabaseReadiness"),
    'Dedicated database-readiness endpoint must perform a live database probe.');
  check(server.includes("app.get('/api/dwn/readiness'"),
    'Real-DWN protocol readiness must have a separate endpoint.');
  check(!server.includes("origin: process.env.CORS_ORIGIN || true"),
    'Unsafe permissive CORS fallback remains.');
}
if (exists('backend/middleware/auth.js')) {
  const auth = read('backend/middleware/auth.js');
  check(auth.includes("requestPath === '/api/events'") && auth.includes("req.method === 'GET'"),
    'Query-token support must be scoped to GET /api/events.');
}
if (exists('backend/services/cloudDwnRegistry.js')) {
  const dwn = read('backend/services/cloudDwnRegistry.js');
  check(dwn.includes('realDwnProtocol: false'), 'Current main API must not claim unintegrated DWN protocol readiness.');
  check(dwn.includes('protocolReady: false'), 'DWN status must distinguish logical storage from protocol readiness.');
}
for (const workflow of ['.github/workflows/milan-live-auto.yml', '.github/workflows/milan-ui-plan.yml']) {
  if (exists(workflow)) check(!read(workflow).includes('while true; do'), `Unbounded self-trigger/retry loop found in ${workflow}.`);
}

const performanceAppShell = read('frontend/app.html');
const performanceFeedSource = read('frontend/assets/js/inline-05.js');
const performanceVideoSource = read('frontend/assets/js/inline-07.js');
const performanceUploadSource = read('frontend/assets/js/milan-ui-actions.js');
const performanceLiveSource = read('frontend/milan-live.js');
check(performanceAppShell.includes('/assets/js/inline-05.js?v=milan-post-menu-parallel-upload-20261031-2'),
  'Feed optimizations must be referenced through the refreshed script URL.');
check(performanceAppShell.includes('/assets/js/inline-07.js?v=milan-streaming-first-20261026-1'),
  'Streaming-first video changes must have a fresh cache-busting URL.');
check(performanceAppShell.includes('/milan-live.js?v=milan-live-chat-filter-20261026-1'),
  'Live refresh optimizations must be referenced through the refreshed script URL.');
check(performanceAppShell.includes('/assets/js/milan-ui-actions.js?v=avatar-persist-20261027-1'),
  'Upload improvements must be referenced through the refreshed script URL.');
check(performanceFeedSource.includes('rootMargin:"300px 0px"'),
  'Feed media should be prepared near the viewport.');
check(performanceFeedSource.includes('800px 0px'),
  'Feed pagination should request the next page before reaching the bottom.');
check(performanceVideoSource.includes('MILAN_ENABLE_TEMP_PLAYBACK_DOWNLOAD!==true'),
  'Full-file video downloads must remain opt-in; native streaming is the default.');
check(performanceVideoSource.includes('milanTempDownloadInProgress'),
  'Video download fallback must avoid duplicate in-flight downloads.');
check(performanceVideoSource.includes('visibilityObserver'),
  'Off-screen video visibility/pause lifecycle must remain installed.');
check(performanceUploadSource.includes('window.MILAN_UPLOAD_CHUNK_BYTES || 8388608'),
  'Resumable video upload default chunk size must be 8 MiB.');
check(performanceUploadSource.includes('requestAnimationFrame'),
  'Upload progress DOM updates must be coalesced to animation frames.');
check(performanceUploadSource.includes('error?.retryable === false') &&
  performanceUploadSource.includes('[408, 425, 429].includes(status)'),
  'Upload retries must stop on cancellation/permanent failures and retry transient failures only.');
check(performanceLiveSource.includes('notifType === "chat_typing"') &&
  performanceLiveSource.includes('window.__milanLivePollingActive = true;') &&
  performanceLiveSource.includes('window.__milanLivePushActive = viaSharedWorker() || direct();'),
  'Live refresh transport/event ownership guards must remain in place.');

const videoScrollTest = 'scripts/video-scroll-playback-self-test.js';
if (exists(videoScrollTest)) {
  const result = spawnSync(process.execPath, [path.join(root, videoScrollTest)], {
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    failures.push(
      `Video scroll playback self-test failed: ${result.error ? result.error.message : `exit status ${result.status}`}`
    );
  }
}

if (failures.length) {
  console.error('MILAN repository integrity check FAILED:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('MILAN repository integrity check PASSED.');
console.log(` - Node engine: ${pkg.engines.node}`);
console.log(' - Frontend source: frontend/ (served by Express)');
console.log(` - Sentinel matrix: ${matrix.caseCount.toLocaleString('en-US')} theoretical combinations (not a claim of full execution)`);
console.log(' - Auth, CORS, DWN-readiness and bounded-workflow invariants checked.');
