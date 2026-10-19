'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

  middleware(req, res, () => { nextCount += 1; });
  await new Promise(resolve => setTimeout(resolve, waitMs));
  return { req, res: res.state, nextCount };
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
    await check('invalid configuration is rejected', async () => {
      assert.throws(
        () => createDistributedApiRateLimiter({ scope: '', limit: 5 }),
        /Invalid distributed rate-limiter configuration/
      );
    });

    const migrationPath = path.join(
      __dirname, '..', 'backend', 'migrations',
      '20261019_voroa_distributed_rate_limit.sql'
    );
    const migration = fs.readFileSync(migrationPath, 'utf8');

    await check('counter table enables RLS and revokes public access', async () => {
      assert.match(migration, /ALTER TABLE public\.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;/);
      assert.match(migration, /REVOKE ALL ON TABLE public\.api_rate_limit_buckets FROM PUBLIC;/);
    });

    await check('rate-limit function is SECURITY DEFINER with explicit access controls', async () => {
      assert.match(migration, /SECURITY DEFINER/);
      assert.match(migration, /SET search_path = pg_catalog, pg_temp/);
      assert.match(migration, /REVOKE ALL ON FUNCTION public\.consume_api_rate_limit\(text, integer, integer\)\s+FROM PUBLIC;/);
      assert.match(migration, /ALTER TABLE public\.api_rate_limit_buckets OWNER TO milan_rate_limit_fn_owner;/);
      assert.match(migration, /ALTER FUNCTION public\.consume_api_rate_limit\(text, integer, integer\)\s+OWNER TO milan_rate_limit_fn_owner;/);
      assert.match(migration, /REVOKE ALL ON TABLE public\.api_rate_limit_buckets FROM PUBLIC, milan_app;/);
      assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.consume_api_rate_limit\(text, integer, integer\)\s+TO milan_app;/);
      assert.doesNotMatch(migration, /TO CURRENT_USER;/);
    });

    await check('SQL samples time after acquiring the counter row lock', async () => {
      const selectAt = migration.indexOf('SELECT window_start, request_count');
      const lockAt = migration.indexOf('FOR UPDATE;', selectAt);
      const clockAt = migration.indexOf('v_now := clock_timestamp();', lockAt);
      assert.ok(selectAt >= 0 && lockAt > selectAt && clockAt > lockAt);
    });

    await check('counter creation, lock, and update occur in order', async () => {
      const insertAt = migration.indexOf('ON CONFLICT (key_hash) DO NOTHING;');
      const selectAt = migration.indexOf('SELECT window_start, request_count', insertAt);
      const lockAt = migration.indexOf('FOR UPDATE;', selectAt);
      const updateAt = migration.indexOf('UPDATE public.api_rate_limit_buckets', lockAt);
      assert.ok(insertAt >= 0 && selectAt > insertAt && lockAt > selectAt && updateAt > lockAt);
    });

    await check('stale cleanup is bounded and skips locked rows', async () => {
      assert.match(migration, /LIMIT 200\s+FOR UPDATE SKIP LOCKED/);
    });

    process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED = 'false';

    const local = createDistributedApiRateLimiter({
      scope: 'self-test-local', limit: 1, windowMs: 60_000
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
      async query(sql, params) {
        capturedCall = { sql, params };
        return {
          rows: [{
            rate_limit_result: {
              allowed: true, limit: 2, remaining: 1, retryAfterSeconds: 60
            }
          }]
        };
      }
    };

    const shared = createDistributedApiRateLimiter({
      scope: 'self-test-shared', limit: 2, windowMs: 60_000, db: workingDb
    });

    await check('PostgreSQL-backed limiter accepts a valid result without storing raw IP', async () => {
      const result = await invoke(shared);
      assert.equal(result.nextCount, 1);
      assert.match(capturedCall.sql, /public\.consume_api_rate_limit\(\$1, \$2, \$3\)/);
      assert.equal(capturedCall.params[1], 2);
      assert.equal(capturedCall.params[2], 60);
      assert.match(capturedCall.params[0], /^[a-f0-9]{64}$/);
      assert.ok(!capturedCall.params[0].includes(result.req.ip));
      assert.equal(result.res.headers['X-RateLimit-Remaining'], '1');
    });

    const denied = createDistributedApiRateLimiter({
      scope: 'self-test-denied', limit: 2, windowMs: 60_000,
      db: {
        async query() {
          return {
            rows: [{
              rate_limit_result: {
                allowed: false, limit: 2, remaining: 0, retryAfterSeconds: 19
              }
            }]
          };
        }
      }
    });

    await check('PostgreSQL denial returns 429', async () => {
      const result = await invoke(denied);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 429);
      assert.equal(result.res.headers['Retry-After'], '19');
    });

    const dbError = createDistributedApiRateLimiter({
      scope: 'self-test-db-error', limit: 2, windowMs: 60_000,
      db: { async query() { throw new Error('simulated database error'); } }
    });

    await check('database errors fail closed with 503', async () => {
      const result = await invoke(dbError);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    const badPayload = createDistributedApiRateLimiter({
      scope: 'self-test-invalid-payload', limit: 2, windowMs: 60_000,
      db: { async query() { return { rows: [{ rate_limit_result: { allowed: true } }] }; } }
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
      scope: 'self-test-no-db', limit: 2, windowMs: 60_000, db: {}
    });

    await check('missing PostgreSQL query client fails closed', async () => {
      const result = await invoke(noDb);
      assert.equal(result.nextCount, 0);
      assert.equal(result.res.statusCode, 503);
    });

    const timeoutDb = createDistributedApiRateLimiter({
      scope: 'self-test-timeout', limit: 2, windowMs: 60_000,
      rpcTimeoutMs: 5, db: { query() { return new Promise(() => {}); } }
    });

    await check('PostgreSQL timeout fails closed with 503', async () => {
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
