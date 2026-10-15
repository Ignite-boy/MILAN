'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createApiRateLimiter = require('../backend/middleware/apiRateLimiter');

function send(middleware, ip, now = 0) {
  const headers = {};
  let statusCode = 200;
  let body;
  let nextCalled = false;
  const req = { ip, socket: { remoteAddress: 'fallback' } };
  const res = {
    setHeader(name, value) { headers[name] = String(value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  middleware(req, res, () => { nextCalled = true; });
  return { headers, statusCode, body, nextCalled };
}

test('per-IP request counts enforce the configured limit and report remaining requests', () => {
  let now = 10;
  const limiter = createApiRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  const first = send(limiter, '198.51.100.1', now);
  const second = send(limiter, '198.51.100.1', now);
  const third = send(limiter, '198.51.100.1', now);

  assert.equal(first.nextCalled, true);
  assert.equal(first.headers['X-RateLimit-Remaining'], '1');
  assert.equal(second.nextCalled, true);
  assert.equal(second.headers['X-RateLimit-Remaining'], '0');
  assert.equal(third.nextCalled, false);
  assert.equal(third.statusCode, 429);
  assert.equal(third.headers['Retry-After'], '1');

  now += 1000;
  assert.equal(send(limiter, '198.51.100.1', now).nextCalled, true);
});

test('expired IP buckets are swept to keep memory bounded', () => {
  let now = 0;
  const limiter = createApiRateLimiter({
    limit: 3, windowMs: 100, maxBuckets: 2, sweepEvery: 100, now: () => now
  });
  assert.equal(send(limiter, 'ip-a', now).nextCalled, true);
  assert.equal(send(limiter, 'ip-b', now).nextCalled, true);

  now = 101;
  const replacement = send(limiter, 'ip-c', now);
  assert.equal(replacement.nextCalled, true);
  assert.equal(replacement.statusCode, 200);
});

test('new IPs are rejected instead of growing past the active bucket cap', () => {
  let now = 0;
  const limiter = createApiRateLimiter({
    limit: 3, windowMs: 100, maxBuckets: 1, sweepEvery: 100, now: () => now
  });
  assert.equal(send(limiter, 'ip-a', now).nextCalled, true);
  const blocked = send(limiter, 'ip-b', now);

  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.headers['Retry-After'], '1');

  now = 100;
  assert.equal(send(limiter, 'ip-b', now).nextCalled, true);
});

test('invalid limiter options safely use bounded defaults', () => {
  let now = 0;
  const limiter = createApiRateLimiter({ limit: 0, windowMs: -1, maxBuckets: 0, now: () => now });
  const response = send(limiter, 'ip-a', now);
  assert.equal(response.headers['X-RateLimit-Limit'], '300');
  assert.equal(response.nextCalled, true);
});
