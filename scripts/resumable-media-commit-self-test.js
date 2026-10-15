'use strict';

const assert = require('node:assert/strict');
const { commitResumableMedia } =
  require('../backend/services/resumableMediaCommit');

function makeRecord() {
  return {
    id: 'same-record-id-for-all-retries',
    cloudDwn: { sync: { status: 'pending' } }
  };
}

function assertSync(record) {
  const sync = record?.cloudDwn?.sync;
  if (sync?.pushed === true) return;
  const error = new Error(sync?.error || 'record sync not confirmed');
  error.status = 502;
  throw error;
}

function deps(record, events, overrides = {}) {
  return {
    record,
    ownerDid: 'did:example:test',
    ownerUser: { did: 'did:example:test' },
    mediaFile: '/tmp/test-media.mp4',
    pushMediaToCloudDwn: async target => {
      events.push(`media:${target.id}`);
      return {
        pushed: true,
        objectPath: `space/${target.id}/media.mp4`
      };
    },
    markCloudSync: async target => {
      events.push(`record:${target.id}`);
      target.cloudDwn = { sync: { pushed: true, status: 'synced' } };
    },
    assertCloudSyncSucceeded: assertSync,
    persistCommitState: () => events.push('persist'),
    ...overrides
  };
}

(async () => {
  {
    const record = makeRecord();
    const events = [];

    await assert.rejects(
      commitResumableMedia(deps(record, events, {
        pushMediaToCloudDwn: async target => {
          events.push(`media:${target.id}`);
          return { pushed: false, error: 'simulated storage outage' };
        },
        markCloudSync: async () => events.push('record:must-not-run')
      })),
      error => error.status === 502 && /storage outage/.test(error.message)
    );

    assert.deepEqual(events, [`media:${record.id}`, 'persist']);
    assert.equal(record.cloudDwn.mediaSync.pushed, false);
    console.log('PASS: media failure is persisted and record sync is skipped.');
  }

  {
    const record = makeRecord();
    const events = [];
    let attempts = 0;

    const options = deps(record, events, {
      markCloudSync: async target => {
        events.push(`record:${target.id}`);
        attempts += 1;
        target.cloudDwn = attempts === 1
          ? { sync: { pushed: false, error: 'simulated record DB outage' } }
          : { sync: { pushed: true, status: 'synced' } };
      }
    });

    await assert.rejects(
      commitResumableMedia(options),
      error => error.status === 502 && /record DB outage/.test(error.message)
    );
    assert.equal(record.cloudDwn.mediaSync.pushed, true);

    const result = await commitResumableMedia(options);
    assert.equal(result.pushed, true);
    assert.deepEqual(events, [
      `media:${record.id}`, `record:${record.id}`, 'persist',
      `media:${record.id}`, `record:${record.id}`, 'persist'
    ]);
    assert.equal(record.id, 'same-record-id-for-all-retries');
    console.log('PASS: retry reuses the stable record ID and same media object path.');
  }

  {
    const record = makeRecord();
    const events = [];
    const result = await commitResumableMedia(deps(record, events));

    assert.equal(result.pushed, true);
    assert.equal(record.cloudDwn.mediaSync.mode, 'synchronous-resumable');
    assert.deepEqual(events, [
      `media:${record.id}`, `record:${record.id}`, 'persist'
    ]);
    console.log('PASS: commit returns only after media and record sync succeed.');
  }

  console.log('\nALL RESUMABLE MEDIA COMMIT SELF-TESTS PASSED.');
})().catch(error => {
  console.error('RESUMABLE MEDIA COMMIT SELF-TEST FAILED:', error.stack || error);
  process.exitCode = 1;
});
