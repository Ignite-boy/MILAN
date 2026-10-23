'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const storePath = require.resolve('../backend/utils/store');
const originalLoad = Module._load;
const snapshots = new Map();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milan-snapshot-test-'));

Module._load = function (request, parent, isMain) {
  if (request === '../services/cloudDwnRegistry' &&
      parent && parent.filename === storePath) {
    return {
      pullDatabaseSnapshot: async name =>
        snapshots.has(name)
          ? snapshots.get(name)
          : { ok: false, error: 'snapshot-not-found' }
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
    snapshots.set('requests.json', { ok: false, error: 'database-unavailable' });

    const result = await hydrateFilesFromVoroa([
      activity, recordIndex, connections, missingSnapshot
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
    console.log('PASS: empty remote snapshot does not overwrite non-empty local cache.');

    assert.equal(fs.existsSync(missingSnapshot), false);
    assert.equal(
      result.results.find(r => r.name === 'requests.json').hydrated,
      false
    );
    console.log('PASS: failed snapshot pull does not create replacement data.');

    assert.equal(global.__milanHydratingFromDwn, false);
    console.log('PASS: hydration flag is reset after completion.');
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
