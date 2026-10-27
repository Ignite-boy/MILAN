'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { MarkovPredictor, predictor, recordView, getPrefetch } =
  require('../backend/services/markovStream');

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function main() {
  const model = new MarkovPredictor();

  model.record('alice', 'shared-item');
  model.record('alice', 'alice-next');
  model.record('alice', 'alice-end');
  model.record('alice', 'shared-item');

  model.record('bob', 'shared-item');
  model.record('bob', 'bob-private-item');
  model.record('bob', 'shared-item');

  assert.deepEqual(model.predict('alice'), ['alice-next']);
  assert.deepEqual(model.predict('bob'), ['bob-private-item']);
  assert.deepEqual(model.predict('unknown-user'), []);
  console.log('PASS: transition history is isolated per user.');

  const uniqueUser = `markov-test-owner-${process.pid}`;
  const spoofedUser = `markov-test-spoof-${process.pid}`;

  for (const contentCid of ['test-a', 'test-b', 'test-a']) {
    const res = response();
    await recordView({
      body: { userId: spoofedUser, contentCid }
    }, res);
    // No authenticated identity: the request is rejected.
    assert.equal(res.statusCode, 400);
  }

  for (const contentCid of ['test-a', 'test-b', 'test-a']) {
    const res = response();
    await recordView({
      userId: spoofedUser,
      body: { userId: spoofedUser, contentCid },
      // Simulate identity populated by the auth middleware.
      get userId() { return uniqueUser; }
    }, res);
    assert.equal(res.statusCode, 200);
  }

  assert.ok(predictor.userSequence[uniqueUser]);
  assert.equal(predictor.userSequence[spoofedUser], undefined);

  const prefetchRes = response();
  await getPrefetch({
    userId: uniqueUser,
    query: { userId: spoofedUser }
  }, prefetchRes);
  assert.equal(prefetchRes.statusCode, 200);
  assert.equal(prefetchRes.payload.prefetch[0].cid, 'test-b');
  console.log('PASS: prediction identity comes from authenticated request, not client userId.');

  const server = fs.readFileSync('backend/server.js', 'utf8');
  assert.match(server, /app\.post\('\/api\/stream\/view',\s*streamAuth,\s*recordView\)/);
  assert.match(server, /app\.get\('\/api\/stream\/prefetch',\s*streamAuth,\s*getPrefetch\)/);
  console.log('PASS: both stream routes are mounted behind authentication.');
  console.log('ALL MARKOV STREAM SELF-TESTS PASSED.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
