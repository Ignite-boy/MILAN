'use strict';

const assert = require('node:assert/strict');
const createDistributedApiRateLimiter = require('../backend/middleware/distributedApiRateLimiter');

function makeResponse() {
  const state = { headers: {}, statusCode: 200, body: undefined };
  return {
    state,
    setHeader(name, value) {
      state.headers[name] = String(value);
      return this;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(body) {
      state.body = body;
      return this;
    }
  };
}

async function invoke(middleware, ip = '203.0.113.42', waitMs = 15) {
  const req = { ip };
  const res = makeResponse();
  let nextCount = 0;
  let nextError = null;

  middleware(req, res, error => {
    nextCount += 1;
    nextError = error || null;
  });

  await new Promise(resolve => setTimeout(resolve, waitMs));
  return { req, res: res.state, nextCount, nextError };
}

async function main() {
  const originalEnabled = process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED;
  const originalSecret = process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET;
  let passed = 0;

  async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  }

  try {
    assert.throws(
      () => createDistributedApiRateLimiter({ scope: '', limit: 5 }),
      /Invalid distributed rate-limiter configuration/
    );
    console.log('PASS invalid configuration is rejected');
    passed += 1;

    process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED = 'false';

    const local = createDistributedApiRateLimiter({
      scope: 'self-test-local',
      limit: 1,
      windowMs: 60_000
    });

    await check('local fallback allows the first request', async () => {
      const result = await invoke(local, '198.51.100.10');
      assert.equal(result.nextCount, 1);
      assert.equal(result.res.headers['Cache-Control'], 'no-store');
    });

    await check('local fallback limits excess requests', async () => {
      const result = await invoke(local, '198.51.100.10');
      assert.equal(result.res.statusCode, 429);
      assert.ok(result.res.headers['Retry-After']);
    });

    process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED = 'true';
    process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET = 'test-secret-'.repeat(4);

    let capturedCall;
    const workingDb = {
      async rpc(name, args) {
        capturedCall = { name, args };
        return {
          data: {
            allowed: true,
            limit: 2,
            remaining: 1,
            retryAfterSeconds: 60
          },
          error: null
        };
      }
    };

    const shared = createDistributedApiRateLimiter({
      scope: 'self-test-shared',
      limit: 2,
      windowMs: 60_000,
      supabase: workingDb
    });

    await check('shared limiter allows a valid database result', async () => {
      const result = await invoke(shared);
      assert.equal(result.nextCount, 1);
      assert.equal(capturedCall.name, 'consume_api_rate_limit');
      assert.equal(capturedCall.args.p_limit, 2);
      assert.equal(capturedCall.args.p_window_seconds, 60);
      assert.match(capturedCall.args.p_key_hash, /^[a-f0-9]{64}$/);
      assert.ok(!capturedCall.args.p_key_hash.includes(result.req.ip));
      assert.equal(result.res.headers['X-RateLimit-Remaining'], '1');
    });

    const denied = createDistributedApiRateLimiter({
      scope: 'self-test-denied',
      limit: 2,
      windowMs: 60_000,
      supabase: {
        async rpc() {
          return {
            data: {
              allowed: false,
              limit: 2,
              remaining: 0,
              retryAfterSeconds: 19
            },
            error: null
          };
        }
      }
    });

    await check('shared limiter returns 429 when database denies', async () => {
      const result = await invoke(denied);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 429);
      assert.equal(result.res.headers['Retry-After'], '19');
    });

    const dbError = createDistributedApiRateLimiter({
      scope: 'self-test-db-error',
      limit: 2,
      windowMs: 60_000,
      supabase: {
        async rpc() {
          return { data: null, error: { message: 'simulated database error' } };
        }
      }
    });

    await check('database error fails closed with 503', async () => {
      const result = await invoke(dbError);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    const badPayload = createDistributedApiRateLimiter({
      scope: 'self-test-invalid-payload',
      limit: 2,
      windowMs: 60_000,
      supabase: { async rpc() { return { data: { allowed: true }, error: null }; } }
    });

    await check('malformed database response fails closed', async () => {
      const result = await invoke(badPayload);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    await check('missing HMAC secret fails closed', async () => {
      process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET = '';
      const result = await invoke(shared);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET = 'test-secret-'.repeat(4);

    const noDb = createDistributedApiRateLimiter({
      scope: 'self-test-no-db',
      limit: 2,
      windowMs: 60_000
    });

    await check('missing database client fails closed in shared mode', async () => {
      const result = await invoke(noDb);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    const timeoutDb = createDistributedApiRateLimiter({
      scope: 'self-test-timeout',
      limit: 2,
      windowMs: 60_000,
      rpcTimeoutMs: 5,
      supabase: { rpc() { return new Promise(() => {}); } }
    });

    await check('database timeout fails closed with 503', async () => {
      const result = await invoke(timeoutDb, '203.0.113.43', 25);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    console.log(`\n${passed} distributed rate-limiter checks passed.`);
  } finally {
    if (originalEnabled === undefined) delete process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED;
    else process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED = originalEnabled;

    if (originalSecret === undefined) delete process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET;
    else process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET = originalSecret;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
