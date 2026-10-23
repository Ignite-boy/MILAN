'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  checkDatabaseReadiness,
  getRealDwnProtocolReadiness
} = require('../backend/services/readiness');

async function main() {
  let queryText = '';
  const db = {
    async query(sql) {
      queryText = sql;
      return { rows: [{ ok: 1 }] };
    }
  };

  const connected = await checkDatabaseReadiness(db);
  assert.equal(queryText, 'SELECT 1 AS ok');
  assert.deepEqual(connected, { ready: true, status: 'ready' });
  console.log('PASS: readiness performs a live PostgreSQL query.');

  const unavailable = await checkDatabaseReadiness({
    async query() { throw new Error('private connection details'); }
  });
  assert.deepEqual(unavailable, { ready: false, status: 'unavailable' });
  assert.equal(JSON.stringify(unavailable).includes('private connection details'), false);
  console.log('PASS: database failures report unavailable without leaking details.');

  const invalidResult = await checkDatabaseReadiness({
    async query() { return { rows: [] }; }
  });
  assert.equal(invalidResult.ready, false);
  console.log('PASS: an empty probe result is not treated as database readiness.');

  assert.deepEqual(getRealDwnProtocolReadiness({
    realDwnProtocol: false,
    realDwnEnginePresent: false,
    sdkReady: false
  }), {
    ready: false,
    status: 'not-integrated',
    reason: 'protocol-not-integrated'
  });

  assert.equal(getRealDwnProtocolReadiness({
    realDwnProtocol: true,
    realDwnEnginePresent: true,
    sdkReady: true
  }).ready, true);
  assert.equal(getRealDwnProtocolReadiness({
    realDwnProtocol: true,
    realDwnEnginePresent: false,
    sdkReady: true
  }).ready, false);
  console.log('PASS: real-DWN readiness requires protocol, engine and SDK readiness.');

  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  const launch = fs.readFileSync(path.join(root, 'backend/routes/launch.js'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/verify-build.js'), 'utf8');

  assert.match(server, /app\.get\('\/api\/health'/);
  assert.match(server, /level: 'liveness'/);
  assert.match(server, /app\.get\('\/api\/ready'/);
  assert.match(server, /app\.get\('\/api\/dwn\/readiness'/);
  assert.match(launch, /databaseReady:\s*database\.ready/);
  assert.match(launch, /realDwnProtocolIntegrated:\s*protocol\.ready/);
  assert.match(build, /Dedicated database-readiness endpoint/);
  console.log('PASS: liveness, database readiness and real-DWN readiness are distinct.');
  console.log('ALL READINESS CONTRACT SELF-TESTS PASSED.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
