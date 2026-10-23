'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sendSnapshotSyncFailure } = require('../backend/services/persistenceFailure');
function response() {
  return { statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}
let res = response();
assert.equal(sendSnapshotSyncFailure(res, { ok: true }, 'test'), false);
assert.equal(res.body, null);
res = response();
assert.equal(sendSnapshotSyncFailure(res, { ok: false, error: 'private details' }, 'Comment'), true);
assert.equal(res.statusCode, 503);
assert.equal(res.body.code, 'SNAPSHOT_SYNC_FAILED');
assert.equal(res.body.localSaved, true);
assert.equal(res.body.cloudSynced, false);
assert.match(res.body.error, /saved locally.*cloud synchronization failed/i);
assert.doesNotMatch(JSON.stringify(res.body), /private details/);
res = response();
assert.equal(sendSnapshotSyncFailure(res, null, 'Change'), true);
assert.equal(res.statusCode, 503);
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const connections = read('backend/routes/connections.js');
const requests = read('backend/routes/requests.js');
const social = read('backend/routes/social.js');
const build = read('scripts/verify-build.js');
assert.equal((connections.match(/sendSnapshotSyncFailure\(res,/g) || []).length, 4);
assert.equal((requests.match(/sendSnapshotSyncFailure\(res,/g) || []).length, 4);
assert.equal((social.match(/sendSnapshotSyncFailure\(res,/g) || []).length, 3);
assert.match(connections, /return writeJsonAndSync\(file\(\), x\)/);
assert.match(requests, /writeJsonAndSync\(global\.requestsFile, data\)/);
assert.match(social, /return writeJsonAndSync\(reactionFile\(\), data\)/);
assert.match(social, /return writeJsonAndSync\(commentFile\(\), data\)/);
assert.match(social, /return writeJsonAndSync\(saveFile\(\), data\)/);
assert.match(build, /backend\/services\/persistenceFailure\.js/);
console.log('PASS: sync failure responses and all 11 mutation route contracts.');
console.log('ALL PERSISTENCE VISIBILITY SELF-TESTS PASSED.');
