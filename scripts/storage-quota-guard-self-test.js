'use strict';

const assert = require('node:assert/strict');
const { withStorageQuotaTransaction } =
  require('../backend/services/storageQuotaGuard');

function fakePool({ quota = 100, rows = [], ownerExists = true } = {}) {
  const events = [];

  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const q = sql.replace(/\s+/g, ' ').trim();

          if (q === 'BEGIN') {
            events.push('BEGIN');
            return { rowCount: null, rows: [] };
          }
          if (q === 'COMMIT') {
            events.push('COMMIT');
            return { rowCount: null, rows: [] };
          }
          if (q === 'ROLLBACK') {
            events.push('ROLLBACK');
            return { rowCount: null, rows: [] };
          }
          if (/FROM public\.users/.test(q) && /FOR UPDATE/.test(q)) {
            events.push('LOCK_OWNER');
            return ownerExists
              ? {
                  rowCount: 1,
                  rows: [{
                    user_id: 'user-1',
                    space_id: 'space-1',
                    dwn_quota_bytes: String(quota)
                  }]
                }
              : { rowCount: 0, rows: [] };
          }
          if (/SUM\(data_size\)/.test(q)) {
            events.push('READ_USAGE');
            const used = rows
              .filter(r =>
                r.did === params[0] &&
                r.space_id === params[1] &&
                ['record', 'record_data'].includes(r.component_type) &&
                r.deleted !== true
              )
              .reduce((sum, r) => sum + r.data_size, 0);
            return { rowCount: 1, rows: [{ used_bytes: String(used) }] };
          }
          if (/SELECT COALESCE\(data_size, 0\)/.test(q)) {
            events.push('READ_REPLACED_ROW');
            const row = rows.find(r =>
              r.did === params[0] &&
              r.space_id === params[1] &&
              r.component_type === params[2] &&
              r.item_key === params[3] &&
              r.deleted !== true
            );
            return {
              rowCount: row ? 1 : 0,
              rows: row ? [{ data_size: String(row.data_size) }] : []
            };
          }

          throw new Error(`Unexpected mock query: ${q}`);
        },
        release() {
          events.push('RELEASE');
        }
      };
    }
  };

  return { pool, events };
}

const args = {
  did: 'did:example:user-1',
  spaceId: 'space-1',
  componentType: 'record_data',
  itemKey: 'media:new',
  newBytes: 40
};

(async () => {
  {
    const { pool, events } = fakePool({
      quota: 100,
      rows: [{
        did: args.did,
        space_id: args.spaceId,
        component_type: 'record',
        item_key: 'record:old',
        data_size: 30,
        deleted: false
      }]
    });

    let writeCalled = false;
    const result = await withStorageQuotaTransaction(pool, args, async () => {
      writeCalled = true;
      events.push('WRITE');
      return 'written';
    });

    assert.equal(result, 'written');
    assert.equal(writeCalled, true);
    assert.deepEqual(events, [
      'BEGIN', 'LOCK_OWNER', 'READ_USAGE', 'READ_REPLACED_ROW',
      'WRITE', 'COMMIT', 'RELEASE'
    ]);
    console.log('PASS: owner is locked and usage checked before permanent write.');
  }

  {
    const { pool, events } = fakePool({
      quota: 100,
      rows: [{
        did: args.did,
        space_id: args.spaceId,
        component_type: 'record',
        item_key: 'record:large',
        data_size: 70,
        deleted: false
      }]
    });

    let writeCalled = false;
    await assert.rejects(
      withStorageQuotaTransaction(pool, { ...args, newBytes: 31 }, async () => {
        writeCalled = true;
      }),
      error =>
        error.status === 413 &&
        error.code === 'STORAGE_QUOTA_EXCEEDED'
    );

    assert.equal(writeCalled, false);
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
    console.log('PASS: quota-exceeding write is rejected and transaction rolled back.');
  }

  {
    const { pool, events } = fakePool({
      quota: 100,
      rows: [{
        did: args.did,
        space_id: args.spaceId,
        component_type: 'record_data',
        item_key: 'media:replace',
        data_size: 80,
        deleted: false
      }]
    });

    const result = await withStorageQuotaTransaction(
      pool,
      { ...args, itemKey: 'media:replace', newBytes: 95 },
      async () => 'replacement-ok'
    );

    assert.equal(result, 'replacement-ok');
    assert.ok(events.includes('COMMIT'));
    console.log('PASS: replacement usage subtracts the row being overwritten.');
  }

  {
    const { pool, events } = fakePool({
      quota: 100,
      rows: [{
        did: args.did,
        space_id: args.spaceId,
        component_type: 'event',
        item_key: 'upload-chunk:temp',
        data_size: 99,
        deleted: false
      }]
    });

    const result = await withStorageQuotaTransaction(
      pool,
      { ...args, newBytes: 20 },
      async () => 'permanent-record-ok'
    );

    assert.equal(result, 'permanent-record-ok');
    assert.ok(events.includes('COMMIT'));
    console.log('PASS: temporary event/chunk rows are excluded from permanent usage.');
  }

  {
    const { pool, events } = fakePool({ ownerExists: false });

    await assert.rejects(
      withStorageQuotaTransaction(pool, args, async () => 'must-not-write'),
      error =>
        error.status === 503 &&
        error.code === 'STORAGE_QUOTA_UNAVAILABLE'
    );

    assert.ok(!events.includes('COMMIT'));
    assert.ok(events.includes('ROLLBACK'));
    console.log('PASS: missing authoritative owner mapping fails closed.');
  }

  {
    const { pool, events } = fakePool({
      quota: 120,
      rows: [
        { did: args.did, space_id: args.spaceId, component_type: 'record', item_key: 'record:old', data_size: 20, deleted: false },
        { did: args.did, space_id: args.spaceId, component_type: 'record_data', item_key: 'media:old', data_size: 30, deleted: false },
        { did: args.did, space_id: args.spaceId, component_type: 'record', item_key: 'record:other', data_size: 30, deleted: false }
      ]
    });

    const result = await withStorageQuotaTransaction(pool, {
      did: args.did,
      spaceId: args.spaceId,
      writes: [
        { componentType: 'record_data', itemKey: 'media:old', newBytes: 45 },
        { componentType: 'record', itemKey: 'record:old', newBytes: 35 }
      ]
    }, async () => {
      events.push('WRITE_MEDIA_AND_RECORD');
      return 'atomic-pair-written';
    });

    assert.equal(result, 'atomic-pair-written');
    assert.equal(events.filter(event => event === 'READ_REPLACED_ROW').length, 2);
    assert.ok(events.indexOf('WRITE_MEDIA_AND_RECORD') < events.indexOf('COMMIT'));
    console.log('PASS: combined media+record quota calculation subtracts both replaced rows.');
  }

  {
    const { pool, events } = fakePool({
      quota: 100,
      rows: [{
        did: args.did,
        space_id: args.spaceId,
        component_type: 'record',
        item_key: 'record:other',
        data_size: 70,
        deleted: false
      }]
    });

    let writeCalled = false;
    await assert.rejects(
      withStorageQuotaTransaction(pool, {
        did: args.did,
        spaceId: args.spaceId,
        writes: [
          { componentType: 'record_data', itemKey: 'media:new', newBytes: 20 },
          { componentType: 'record', itemKey: 'record:new', newBytes: 11 }
        ]
      }, async () => { writeCalled = true; }),
      error => error.status === 413 && error.code === 'STORAGE_QUOTA_EXCEEDED'
    );

    assert.equal(writeCalled, false);
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
    console.log('PASS: combined media+record bytes over quota are rejected before either write.');
  }

  console.log('\nAll storage quota guard self-tests passed (mocked transaction).');
})().catch(error => {
  console.error('Storage quota guard self-test failed:', error.stack || error);
  process.exitCode = 1;
});
