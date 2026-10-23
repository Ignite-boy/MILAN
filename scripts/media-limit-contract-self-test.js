'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'backend/services/mediaLimits.js');

function run(overrides = {}) {
  const env = { ...process.env };
  delete env.MILAN_MAX_VOROA_MEDIA_BYTES;
  delete env.MAX_MEDIA_BYTES;
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [
    '-e',
    `const m=require(${JSON.stringify(modulePath)}); process.stdout.write(JSON.stringify({bytes:m.MAX_MEDIA_BYTES,mb:m.MAX_MEDIA_MB}));`
  ], { encoding: 'utf8', env });
}

let result = run();
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(JSON.parse(result.stdout), {
  bytes: 768 * 1024 * 1024, mb: 768
});
console.log('PASS: default media limit is 768 MiB.');

result = run({
  MILAN_MAX_VOROA_MEDIA_BYTES: '123456789',
  MAX_MEDIA_BYTES: '987654321'
});
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).bytes, 123456789);
console.log('PASS: canonical variable takes precedence.');

result = run({ MAX_MEDIA_BYTES: '234567890' });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).bytes, 234567890);
console.log('PASS: legacy fallback remains supported.');

for (const value of ['0', '-1', '1.5', 'invalid', '9007199254740992']) {
  assert.notEqual(
    run({ MILAN_MAX_VOROA_MEDIA_BYTES: value }).status, 0,
    `Invalid limit accepted: ${value}`
  );
}
console.log('PASS: invalid limits fail closed.');

const records = fs.readFileSync(path.join(root, 'backend/routes/records.js'), 'utf8');
const dwn = fs.readFileSync(path.join(root, 'backend/services/dwnService.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'backend/services/cloudDwnRegistry.js'), 'utf8');

assert.match(records, /require\('\.\.\/services\/mediaLimits'\)/);
assert.equal((records.match(/const limit = MAX_MEDIA_BYTES;/g) || []).length, 2);
assert.equal((dwn.match(/const \{ MAX_MEDIA_BYTES \} = require\('\.\/mediaLimits'\);/g) || []).length, 1);
assert.match(dwn, /const MAX_MEDIA_MB = Math\.round\(MAX_MEDIA_BYTES/);
assert.match(cloud, /require\('\.\/mediaLimits'\)/);
assert.match(cloud, /const maxBytes = MAX_MEDIA_BYTES;/);

console.log('PASS: upload, DWN and PostgreSQL paths share the limit.');
console.log('ALL MEDIA LIMIT CONTRACT SELF-TESTS PASSED.');
