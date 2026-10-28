'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(
  path.join(__dirname, '..', file),
  'utf8'
);

const service = read('backend/services/dwnService.js');
const routes = read('backend/routes/records.js');

assert.ok(
  service.includes("substring(m.data_bytes from $2 for $3) AS data_bytes"),
  'PostgreSQL range query should select the requested byte slice'
);
assert.ok(
  service.includes('m.data_size=$4 AND m.data_cid=$5'),
  'Range query must guard against changed media size or CID'
);
assert.ok(
  service.includes('byteRange.start + 1'),
  'Convert the zero-based HTTP offset to PostgreSQL bytea indexing'
);
assert.ok(
  service.includes('byteRange.end - byteRange.start + 1'),
  'Range query must request the exact inclusive byte count'
);
assert.ok(
  service.includes('buffer.length !== expectedRangeLength'),
  'Validate the number of bytes returned by PostgreSQL'
);
assert.ok(
  service.includes("includeBytes && !byteRange && expectedCid.startsWith('sha256:')"),
  'Full-file reads must retain their SHA-256 verification'
);
assert.ok(
  service.includes("getAuthoritativeCloudMedia(recordId, readerDid, { includeBytes: false })"),
  'Playback URL lookup must not request the video payload'
);
assert.ok(
  routes.includes("metadataOnly: req.method === 'HEAD' || !!req.headers.range"),
  'HEAD and Range requests should first fetch metadata only'
);
assert.ok(
  routes.includes('byteRange: {'),
  'The parsed HTTP range must be passed to the storage read'
);
assert.ok(
  routes.includes('media.byteRange.start !== parsed.start') &&
  routes.includes('media.byteRange.end !== parsed.end'),
  'Response must verify that returned range matches the requested range'
);
assert.ok(
  routes.includes("res.setHeader('Content-Range', `bytes */${total}`)"),
  'Unsatisfiable ranges must include the required Content-Range header'
);

console.log('PASS: PostgreSQL range query selects bounded bytes.');
console.log('PASS: size and CID guard range reads.');
console.log('PASS: HTTP and PostgreSQL byte offsets/counts are checked.');
console.log('PASS: full-file SHA-256 verification remains in place.');
console.log('PASS: playback URL, HEAD and range paths avoid unnecessary payload reads.');
console.log('ALL POSTGRES MEDIA RANGE CONTRACT TESTS PASSED.');

const crypto = require('node:crypto');

(async () => {
  const db = require('../backend/services/milanDb');
  const store = require('../backend/services/dwnService');
  const full = Buffer.from('0123456789abcdefgh');
  const cid = 'sha256:' + crypto.createHash('sha256').update(full).digest('hex');
  const did = 'did:example:milan-range-self-test';
  const spaceId = 'milan-range-self-test-space';
  const recordId = '__milan_range_test_' + Date.now() + '_' + crypto.randomUUID();
  const queries = [];

  db.query = async (sql, params = []) => {
    sql = String(sql);
    queries.push({ sql, params });

    if (/SELECT space_id FROM public\.users WHERE did=\$1 LIMIT 1/i.test(sql)) {
      return { rows: [{ space_id: spaceId }], rowCount: 1 };
    }

    if (/SELECT r\.did, r\.space_id/i.test(sql)) {
      let bytes;
      if (/substring\(m\.data_bytes from \$2 for \$3\) AS data_bytes/i.test(sql)) {
        assert.equal(params[3], full.length, 'range query pins expected full size');
        assert.equal(params[4], cid, 'range query pins expected CID');
        const start = Number(params[1]) - 1;
        bytes = full.subarray(start, start + Number(params[2]));
      } else if (sql.includes('m.data_bytes')) {
        bytes = full;
      }

      return {
        rowCount: 1,
        rows: [{
          did,
          space_id: spaceId,
          item_key: recordId,
          recipient: did,
          published: false,
          record_metadata: {
            title: 'test-video.mp4',
            accessMode: 'private',
            media: {
              mimeType: 'video/mp4',
              fileName: 'test-video.mp4',
              browserPlayable: true,
              processing: false,
              processingStatus: 'ready'
            }
          },
          data_format: 'video/mp4',
          media_metadata: {
            mimeType: 'video/mp4',
            fileName: 'test-video.mp4',
            browserPlayable: true,
            processingStatus: 'ready'
          },
          media_format: 'video/mp4',
          ...(bytes ? { data_bytes: bytes } : {}),
          data_size: full.length,
          data_cid: cid
        }]
      };
    }

    throw new Error('Unexpected SQL in mocked media test: ' + sql);
  };

  const metadata = await store.getMediaStream(recordId, did, { metadataOnly: true });
  assert.equal(metadata.sizeBytes, full.length);
  assert.equal('buffer' in metadata, false);
  const metadataQuery = queries.find(q => /SELECT r\.did, r\.space_id/i.test(q.sql));
  assert.ok(metadataQuery);
  assert.equal(metadataQuery.sql.includes('m.data_bytes'), false);
  console.log('PASS: mocked metadata-only read does not select media bytes.');

  const start = 4;
  const end = 8;
  const ranged = await store.getMediaStream(recordId, did, {
    byteRange: {
      start,
      end,
      expectedSizeBytes: full.length,
      expectedCid: cid
    }
  });
  assert.deepEqual(ranged.buffer, full.subarray(start, end + 1));
  assert.deepEqual(ranged.byteRange, { start, end });
  const rangeQuery = queries.findLast(q => /SELECT r\.did, r\.space_id/i.test(q.sql));
  assert.ok(rangeQuery.sql.includes('substring(m.data_bytes from $2 for $3) AS data_bytes'));
  assert.deepEqual(rangeQuery.params, [recordId, start + 1, end - start + 1, full.length, cid]);
  console.log('PASS: mocked PostgreSQL range read returns exactly the requested bytes.');

  const complete = await store.getMediaStream(recordId, did);
  assert.deepEqual(complete.buffer, full);
  console.log('PASS: full-file read returns the complete payload and passes SHA-256 verification.');
  console.log('ALL POSTGRES MEDIA RANGE RUNTIME SELF-TESTS PASSED.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
