'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'milan-local-media-test-'));

  try {
    const dwnRoot = path.join(tempRoot, 'dwn');
    const databaseRoot = path.join(tempRoot, 'database');
    const mediaPath = path.join(dwnRoot, 'isolated-users', 'test-space', 'media', 'clip.mp4');
    const recordId = 'local-cache-self-test-record';
    const ownerDid = 'did:example:milan-local-cache-owner';
    const spaceId = 'test-space';
    const original = Buffer.from('MILAN verified local media cache range test payload');

    process.env.MILAN_CLOUD_DWN_ROOT = dwnRoot;
    process.env.MILAN_LOCAL_DWN_ROOT = dwnRoot;
    process.env.MILAN_DATABASE_DIR = databaseRoot;

    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.mkdirSync(databaseRoot, { recursive: true });
    fs.writeFileSync(mediaPath, original);

    const cid = 'sha256:' + crypto.createHash('sha256').update(original).digest('hex');
    const record = {
      id: recordId,
      owner: ownerDid,
      accessMode: 'private',
      title: 'clip.mp4',
      dataFormat: 'video/mp4',
      mediaStoragePath: mediaPath,
      mediaCachePath: mediaPath,
      data: {
        kind: 'media',
        media: { mimeType: 'video/mp4', fileName: 'clip.mp4' }
      }
    };

    fs.writeFileSync(
      path.join(databaseRoot, 'APP_RECORD_INDEX.json'),
      JSON.stringify({ 'test-user': [record] })
    );

    const db = require('../backend/services/milanDb');
    const store = require('../backend/services/dwnService');
    let cloudReadQueries = 0;
    let ownerChecks = 0;

    db.query = async (sql, params = []) => {
      sql = String(sql);

      if (/SELECT space_id FROM public\.users WHERE did=\$1 LIMIT 1/i.test(sql)) {
        ownerChecks++;
        return { rows: [{ space_id: spaceId }], rowCount: 1 };
      }

      if (/SELECT r\.did, r\.space_id/i.test(sql)) {
        cloudReadQueries++;
        let selectedBytes;

        if (/substring\(m\.data_bytes from \$2 for \$3\) AS data_bytes/i.test(sql)) {
          assert.equal(params[3], original.length);
          assert.equal(params[4], cid);
          const start = Number(params[1]) - 1;
          selectedBytes = original.subarray(start, start + Number(params[2]));
        } else {
          throw new Error('Unexpected full payload query in range-only test.');
        }

        return {
          rowCount: 1,
          rows: [{
            did: ownerDid,
            space_id: spaceId,
            item_key: recordId,
            recipient: ownerDid,
            published: false,
            record_metadata: {
              title: 'clip.mp4',
              accessMode: 'private',
              sharedWithDids: [],
              media: { mimeType: 'video/mp4', fileName: 'clip.mp4' }
            },
            data_format: 'video/mp4',
            media_metadata: {
              mimeType: 'video/mp4',
              fileName: 'clip.mp4',
              browserPlayable: true,
              processingStatus: 'ready'
            },
            media_format: 'video/mp4',
            data_bytes: selectedBytes,
            data_size: original.length,
            data_cid: cid
          }]
        };
      }

      throw new Error('Unexpected SQL in isolated media-cache test: ' + sql);
    };

    const start = 4;
    const end = 17;
    const requestOptions = {
      byteRange: {
        start,
        end,
        expectedSizeBytes: original.length,
        expectedCid: cid
      },
      verifiedMetadata: {
        authoritativeCloud: true,
        sizeBytes: original.length,
        dataCid: cid,
        mimeType: 'video/mp4',
        fileName: 'clip.mp4'
      },
      verifiedRecordId: recordId,
      verifiedReaderDid: ownerDid
    };

    const cached = await store.getMediaStream(recordId, ownerDid, requestOptions);
    assert.equal(cached.backend, 'postgresql-local-verified-cache');
    assert.deepEqual(cached.buffer, original.subarray(start, end + 1));
    assert.equal(cloudReadQueries, 0, 'valid local CID should avoid the PostgreSQL payload query');
    console.log('PASS: matching SHA-256 uses the local file and returns the exact range.');

    await assert.rejects(
      store.getMediaStream(recordId, 'did:example:unauthorized-reader', requestOptions),
      error => error.status === 403
    );
    assert.equal(cloudReadQueries, 0, 'unauthorized access must not fall through to cloud reads');
    console.log('PASS: unauthorized reader is rejected before local-cache access.');

    fs.writeFileSync(mediaPath, Buffer.alloc(original.length, 0x58));
    const fallback = await store.getMediaStream(recordId, ownerDid, requestOptions);
    assert.equal(fallback.backend, 'postgresql');
    assert.deepEqual(fallback.buffer, original.subarray(start, end + 1));
    assert.ok(cloudReadQueries >= 1, 'CID mismatch must fall back to the authoritative PostgreSQL range');
    assert.ok(ownerChecks >= 1, 'fallback must retain PostgreSQL owner verification');
    console.log('PASS: changed local bytes fail CID verification and use PostgreSQL fallback.');

    console.log('ALL LOCAL VERIFIED MEDIA CACHE SELF-TESTS PASSED.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
