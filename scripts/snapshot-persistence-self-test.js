'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const storePath = require.resolve('../backend/utils/store');
const originalLoad = Module._load;
const snapshots = new Map();
const syncWrites = [];
let syncResponse = { ok: true, backend: 'voroa' };
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milan-snapshot-test-'));

Module._load = function (request, parent, isMain) {
  if (request === '../services/cloudDwnRegistry' &&
      parent && parent.filename === storePath) {
    return {
      pullDatabaseSnapshot: async name =>
        snapshots.has(name)
          ? snapshots.get(name)
          : { ok: false, error: 'snapshot-not-found' },
      syncDatabaseSnapshot: async (name, data) => {
        syncWrites.push({ name, data });
        return syncResponse;
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  try {
    const { hydrateFilesFromVoroa } = require(storePath);

    const activity = path.join(tempDir, 'activity.json');
    const recordIndex = path.join(tempDir, 'APP_RECORD_INDEX.json');
    const connections = path.join(tempDir, 'connections.json');
    const missingSnapshot = path.join(tempDir, 'requests.json');
    const emptyArraySnapshot = path.join(tempDir, 'records.json');
    const originalRecords = [{ id: 'local-record' }];
    fs.writeFileSync(emptyArraySnapshot, JSON.stringify(originalRecords));

    fs.writeFileSync(recordIndex, JSON.stringify({
      alice: [
        { id: 'same', dateModified: '2026-10-01T00:00:00Z', label: 'old-local' },
        { id: 'local-only', dateCreated: '2026-10-01T00:00:00Z' }
      ]
    }));

    const originalConnections = { alice: ['friend-local'] };
    fs.writeFileSync(connections, JSON.stringify(originalConnections));

    snapshots.set('activity.json', {
      ok: true,
      data: { alice: [{ id: 'event-1' }] }
    });

    snapshots.set('APP_RECORD_INDEX.json', {
      ok: true,
      data: {
        alice: [
          { id: 'same', dateModified: '2026-10-02T00:00:00Z', label: 'new-remote' },
          { id: 'remote-only', dateCreated: '2026-10-02T00:00:00Z' }
        ]
      }
    });

    snapshots.set('connections.json', { ok: true, data: {} });
    snapshots.set('records.json', { ok: true, data: [] });
    snapshots.set('requests.json', { ok: false, error: 'database-unavailable' });

    const result = await hydrateFilesFromVoroa([
      activity, recordIndex, connections, emptyArraySnapshot, missingSnapshot
    ]);

    assert.equal(result.ok, true);

    assert.deepEqual(JSON.parse(fs.readFileSync(activity, 'utf8')), {
      alice: [{ id: 'event-1' }]
    });
    console.log('PASS: non-empty remote snapshot hydrates local JSON.');

    const records = JSON.parse(fs.readFileSync(recordIndex, 'utf8')).alice;
    assert.deepEqual(new Set(records.map(r => r.id)),
      new Set(['same', 'local-only', 'remote-only']));
    assert.equal(records.find(r => r.id === 'same').label, 'new-remote');
    console.log('PASS: record-index hydration merges local-only records and keeps newer data.');

    assert.deepEqual(JSON.parse(fs.readFileSync(connections, 'utf8')), originalConnections);
    assert.equal(
      result.results.find(r => r.name === 'connections.json').reason,
      'remote-empty-kept-local-cache'
    );
    console.log('PASS: empty remote object does not overwrite non-empty local cache.');

    assert.deepEqual(
      JSON.parse(fs.readFileSync(emptyArraySnapshot, 'utf8')),
      originalRecords
    );
    assert.equal(
      result.results.find(r => r.name === 'records.json').reason,
      'remote-empty-kept-local-cache'
    );
    console.log('PASS: empty remote array does not overwrite non-empty local records.');

    assert.equal(fs.existsSync(missingSnapshot), false);
    assert.equal(
      result.results.find(r => r.name === 'requests.json').hydrated,
      false
    );
    console.log('PASS: failed snapshot pull does not create replacement data.');

    assert.equal(global.__milanHydratingFromDwn, false);
    console.log('PASS: hydration flag is reset after completion.');

    const { writeJsonAndSync } = require(storePath);

    const successFile = path.join(tempDir, 'securityReports.json');
    syncResponse = { ok: true, backend: 'voroa' };
    const successWrite = await writeJsonAndSync(
      successFile, [{ probe: 'success' }]
    );
    assert.equal(successWrite.ok, true);
    assert.equal(syncWrites.at(-1).name, 'securityReports.json');
    assert.deepEqual(syncWrites.at(-1).data, [{ probe: 'success' }]);
    console.log('PASS: writeJsonAndSync reports successful remote persistence.');

    const failedFile = path.join(tempDir, 'feedback.json');
    syncResponse = { ok: false, error: 'database-unavailable' };
    const failedWrite = await writeJsonAndSync(
      failedFile, [{ probe: 'failure' }]
    );
    assert.equal(failedWrite.ok, false);
    assert.match(failedWrite.error, /database-unavailable/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(failedFile, 'utf8')),
      [{ probe: 'failure' }]
    );
    console.log('PASS: failed remote sync is surfaced to the caller.');

    console.log('ALL SNAPSHOT PERSISTENCE SELF-TESTS PASSED.');
  } finally {
    Module._load = originalLoad;
    global.__milanHydratingFromDwn = false;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
