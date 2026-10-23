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
check(pkg && !Object.keys(pkg.dependencies || {}).some(name => {
  const value = name.toLowerCase();
  return value.includes('supabase') || value.startsWith('@vercel/');
}), 'Supabase and Vercel runtime dependencies must remain removed.');
check(exists('backend/server.js') && !read('backend/server.js').includes('process.env.VERCEL'),
  'Main Express server must not depend on the Vercel runtime.');
for (const file of ['backend/services/cloudDwnRegistry.js', 'backend/services/dwnService.js', 'backend/routes/records.js', 'backend/routes/auth.js', 'backend/routes/did.js', 'backend/services/resumableMediaCommit.js']) {
  if (!exists(file)) continue;
  const source = read(file);
  const forbidden = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', '@supabase/supabase-js', '@vercel/functions', '@vercel/kv', 'process.env.VERCEL'];
  check(!forbidden.some(value => source.includes(value)), `Legacy provider runtime reference remains in ${file}.`);
}
check(!exists('vercel.json') && !exists('.vercel/repo.json'), 'Legacy Vercel deployment configuration must be removed.');
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
  'backend/services/aiBestTime.js',
  'scripts/upload-chunk-self-test.js',
  'backend/routes/isolatedDwn.js',
  'frontend/assets/js/inline-05.js',
  'frontend/assets/js/inline-07.js',
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
