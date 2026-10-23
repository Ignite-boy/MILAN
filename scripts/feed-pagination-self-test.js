'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const express = require('express');

const root = path.resolve(__dirname, '..');
const viewerDid = 'did:example:viewer';
const dwnServiceSource = fs.readFileSync(
  path.join(root, 'backend/services/dwnService.js'), 'utf8'
);
const listVisibleStart = dwnServiceSource.indexOf('async function listVisibleRecords(');
const listVisibleEnd = dwnServiceSource.indexOf('\nasync function getRecord(', listVisibleStart);
if (listVisibleStart < 0 || listVisibleEnd <= listVisibleStart) {
  throw new Error('DWN listVisibleRecords function must remain identifiable.');
}
assert(
  dwnServiceSource.slice(listVisibleStart, listVisibleEnd)
    .includes('ORDER BY date_modified DESC, item_key DESC'),
  'Feed SQL must use deterministic ordering with an item-key tie-breaker.'
);
const posts = Array.from({ length: 25 }, (_, i) => ({
  id: `post-${String(i).padStart(2, '0')}`,
  owner: viewerDid,
  recipient: viewerDid,
  title: `Post ${i}`,
  schema: 'test-record',
  dataFormat: 'application/json',
  data: { text: `Post body ${i}` },
  accessMode: i % 5 === 0 ? 'public' : 'private',
  sharedWithDids: [],
  dateCreated: new Date(Date.UTC(2026, 0, 1, 0, 0, 25 - i)).toISOString(),
  dateModified: new Date(Date.UTC(2026, 0, 1, 0, 0, 25 - i)).toISOString()
}));

posts.splice(5, 0, {
  id: 'chat-record-must-not-leak',
  owner: viewerDid,
  recipient: viewerDid,
  title: 'MILAN chat message',
  schema: 'milan.chat.message',
  protocol: 'milan.chat',
  protocolPath: 'messages',
  dataFormat: 'application/json',
  data: {
    kind: 'chat_message',
    messageId: 'message-1',
    conversationId: 'conversation-1',
    senderDid: viewerDid,
    recipientDid: 'did:example:other'
  },
  accessMode: 'private',
  sharedWithDids: [],
  dateCreated: new Date(Date.UTC(2026, 0, 1, 0, 0, 20, 500)).toISOString(),
  dateModified: new Date(Date.UTC(2026, 0, 1, 0, 0, 20, 500)).toISOString()
});

// Interleave chat-shaped records throughout the storage result. Some are
// deliberately marked public/shared and some are owned by a different DID.
for (let index = 0; index < 25; index++) {
  const ownerDid = index % 2 === 0 ? 'did:example:other' : viewerDid;
  posts.splice(Math.min(index * 2 + 1, posts.length), 0, {
    id: `chat-record-must-not-leak-${index}`,
    owner: ownerDid,
    recipient: viewerDid,
    title: 'MILAN chat message',
    schema: 'milan.chat.message',
    protocol: 'milan.chat',
    protocolPath: 'messages',
    dataFormat: 'application/json',
    data: {
      kind: 'chat_message',
      messageId: `message-${index}`,
      conversationId: `conversation-${index}`,
      senderDid: ownerDid,
      recipientDid: viewerDid
    },
    accessMode: index % 2 === 0 ? 'public' : 'shared_did',
    sharedWithDids: [viewerDid],
    dateCreated: new Date(Date.UTC(2026, 0, 1, 0, 0, 20) + index).toISOString(),
    dateModified: new Date(Date.UTC(2026, 0, 1, 0, 0, 20) + index).toISOString()
  });
}

function mockModule(relativePath, exports) {
  const id = require.resolve(path.join(root, relativePath));
  const mod = new Module(id);
  mod.filename = id;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[id] = mod;
}

mockModule('backend/middleware/auth.js', (req, res, next) => {
  req.userId = 'pagination-test-user';
  next();
});

mockModule('backend/utils/store.js', {
  readJson: () => ({}),
  writeJson: () => {},
  atomicWriteJson: () => {},
  findUserById: () => ({
    id: 'pagination-test-user',
    email: 'viewer@example.invalid',
    user: { id: 'pagination-test-user', did: viewerDid, email: 'viewer@example.invalid', profile: {} },
    profile: {}
  }),
  findUserByDid: () => null,
  addActivity: () => {}
});

mockModule('backend/services/cloudDwnRegistry.js', {
  pullDatabaseSnapshot: async () => ({ ok: false })
});

mockModule('backend/services/notifyService.js', {});
mockModule('backend/services/milanDb.js', {
  query: async () => ({ rows: [], rowCount: 0 })
});
mockModule('backend/services/dwnService.js', {
  listVisibleRecords: async (did, query) => {
    assert.equal(did, viewerDid);
    if (query.dbPage === '1') {
      const offset = Number(query.offset || 0);
      const limit = Number(query.limit || 0);
      return posts.slice(offset, offset + limit);
    }
    assert.equal(query.limit, '0', 'filtered scopes retain in-memory filtering');
    return posts;
  }
});

(async () => {
  let server;
  try {
    const router = require(path.join(root, 'backend/routes/social.js'));
    const app = express();
    app.use('/api/social', router);

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const base = `http://127.0.0.1:${server.address().port}`;

    async function page(offset, limit = 10, scope = 'all') {
      const response = await fetch(
        `${base}/api/social/feed?scope=${encodeURIComponent(scope)}&limit=${limit}&offset=${offset}`
      );
      assert.equal(response.status, 200, `HTTP status for offset ${offset}`);
      return response.json();
    }

    const first = await page(0);
    const second = await page(first.nextOffset);
    const third = await page(second.nextOffset);
    const beyond = await page(third.nextOffset);
    assert.equal(first.items.length, 10);
    assert.equal(second.items.length, 10);
    assert.equal(third.items.length, 5);
    assert.equal(beyond.items.length, 0);

    assert.equal(first.items[0].id, 'post-00');
    assert.equal(second.items[0].id, 'post-10');
    assert.equal(third.items[0].id, 'post-20');
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, true);
    assert.equal(third.hasMore, false);
    assert.equal(beyond.hasMore, false);

    const allIds = [...first.items, ...second.items, ...third.items].map(post => post.id);
    assert.equal(new Set(allIds).size, 25, 'pages must not overlap');
    assert.equal(allIds.length, 25, 'all non-chat posts must be returned');
    const expectedIds = Array.from(
      { length: 25 }, (_, i) => `post-${String(i).padStart(2, '0')}`
    );
    assert.deepEqual(allIds, expectedIds,
      'pages must preserve order without gaps or overlaps');
    assert(!allIds.some(id => String(id).startsWith('chat-record-must-not-leak')),
      'chat records must never appear in the all-posts feed');

    for (const scope of ['mine', 'friends', 'public']) {
      const response = await fetch(
        `${base}/api/social/feed?scope=${scope}&limit=100&offset=0`
      );
      assert.equal(response.status, 200, `HTTP status for scope ${scope}`);
      const body = await response.json();
      const items = Array.isArray(body) ? body : body.items;
      assert(Array.isArray(items), `scope ${scope} must return an item list`);
      assert(!items.some(item => String(item.id || '').startsWith('chat-record-must-not-leak')),
        `chat records must not leak through ${scope} scope`);
      if (scope === 'public') {
        assert(items.length > 0, 'legitimate public posts must remain visible');
        assert(items.every(item => item.accessMode === 'public'),
          'public scope must exclude private and shared non-chat records');
      }
    }

    console.log('PASS: page size and offset boundaries.');
    console.log('PASS: deterministic ordering and complete paginated results.');
    console.log('PASS: chat records are excluded across all tested feed scopes.');
    console.log('PASS: legitimate public posts remain visible.');
    console.log('PASS: pages do not overlap.');
    console.log('PASS: chat records are excluded.');
    console.log('PASS: requesting beyond the end returns an empty page.');
    console.log('\nALL FEED PAGINATION SELF-TESTS PASSED.');
  } catch (error) {
    console.error('FEED PAGINATION SELF-TEST FAILED:', error.stack || error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
