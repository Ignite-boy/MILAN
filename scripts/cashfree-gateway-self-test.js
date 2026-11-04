'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cashfree = require('../backend/services/cashfreeGateway');

const envKeys = [
  'CASHFREE_ENABLED',
  'CASHFREE_ENV',
  'CASHFREE_APP_ID',
  'CASHFREE_SECRET_KEY',
  'CASHFREE_API_VERSION'
];

const originalEnv = Object.fromEntries(
  envKeys.map(key => [key, process.env[key]])
);

const originalFetch = global.fetch;
const calls = [];
const responses = [];

function configure(environment = 'sandbox') {
  process.env.CASHFREE_ENABLED = 'true';
  process.env.CASHFREE_ENV = environment;
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
  process.env.CASHFREE_API_VERSION = '2026-01-01';
}

function queueJson(payload, status = 200) {
  responses.push({
    status,
    body: JSON.stringify(payload)
  });
}

function queueRaw(body, status = 200) {
  responses.push({ status, body });
}

global.fetch = async (url, options) => {
  calls.push({ url: String(url), ...options });
  const next = responses.shift();

  if (!next) {
    throw new Error('Unexpected provider fetch in isolated test.');
  }

  if (next instanceof Error) throw next;

  return new Response(next.body, {
    status: next.status,
    headers: { 'content-type': 'application/json' }
  });
};

let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS: ${name}`);
}

async function main() {
  try {
    delete process.env.CASHFREE_ENABLED;
    delete process.env.CASHFREE_ENV;
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
    delete process.env.CASHFREE_API_VERSION;

    await test('Cashfree is disabled by default and exposes no credentials', async () => {
      assert.deepEqual(cashfree.publicConfig(), {
        enabled: false,
        environment: null
      });

      await assert.rejects(
        cashfree.getOrder('order-1'),
        error => error.code === 'CASHFREE_DISABLED' && error.status === 503
      );
    });

    await test('Incomplete or invalid configuration fails closed', async () => {
      configure('production');
      delete process.env.CASHFREE_APP_ID;

      assert.equal(cashfree.settings().configured, false);
      assert.deepEqual(cashfree.publicConfig(), {
        enabled: false,
        environment: null
      });

      configure('invalid-environment');
      assert.equal(cashfree.settings().configured, false);
    });

    configure('sandbox');

    await test('Sandbox order creation sends authenticated JSON and saved idempotency key', async () => {
      const body = {
        order_id: 'MLNCF_test_0123456789abcdef',
        order_amount: 250,
        order_currency: 'INR',
        customer_details: {
          customer_id: 'milan_test',
          customer_phone: '9876543210'
        }
      };

      const idempotencyKey = '11111111-1111-4111-8111-111111111111';

      queueJson({
        cf_order_id: 'cf-order-123',
        order_id: body.order_id,
        order_amount: 250,
        order_currency: 'INR',
        payment_session_id: 'session-test-value'
      });

      const result = await cashfree.createOrder(body, idempotencyKey);
      const call = calls.at(-1);

      assert.equal(result.cf_order_id, 'cf-order-123');
      assert.equal(call.url, 'https://sandbox.cashfree.com/pg/orders');
      assert.equal(call.method, 'POST');
      assert.equal(call.headers['x-client-id'], 'test-app-id');
      assert.equal(call.headers['x-client-secret'], 'test-secret-key');
      assert.equal(call.headers['x-api-version'], '2026-01-01');
      assert.equal(call.headers['x-idempotency-key'], idempotencyKey);
      assert.match(call.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
      assert.deepEqual(JSON.parse(call.body), body);
      assert.equal(call.redirect, 'error');
      assert.ok(call.signal);
    });

    await test('Order lookup safely URL-encodes the merchant order ID', async () => {
      queueJson({ order_id: 'order/with slash' });

      await cashfree.getOrder('order/with slash');

      assert.equal(
        calls.at(-1).url,
        'https://sandbox.cashfree.com/pg/orders/order%2Fwith%20slash'
      );
      assert.equal(calls.at(-1).method, 'GET');
      assert.equal(calls.at(-1).body, undefined);
    });

    await test('Payment and refund lookups use the expected resource paths', async () => {
      queueJson({ cf_payment_id: 'pay-1' });
      await cashfree.getPayment('order-1', 'pay/1');

      assert.equal(
        calls.at(-1).url,
        'https://sandbox.cashfree.com/pg/orders/order-1/payments/pay%2F1'
      );

      queueJson([]);
      await cashfree.getPayments('order-1');
      assert.equal(
        calls.at(-1).url,
        'https://sandbox.cashfree.com/pg/orders/order-1/payments'
      );

      queueJson({ cf_refund_id: 'refund-1' });
      await cashfree.createRefund(
        'order-1',
        { refund_amount: 25 },
        '22222222-2222-4222-8222-222222222222'
      );

      assert.equal(
        calls.at(-1).url,
        'https://sandbox.cashfree.com/pg/orders/order-1/refunds'
      );
      assert.equal(
        calls.at(-1).headers['x-idempotency-key'],
        '22222222-2222-4222-8222-222222222222'
      );

      queueJson([]);
      await cashfree.getRefunds('order-1');
      assert.equal(
        calls.at(-1).url,
        'https://sandbox.cashfree.com/pg/orders/order-1/refunds'
      );
    });

    await test('Production environment selects the production API host', async () => {
      configure('production');
      queueJson({ order_id: 'prod-order' });

      await cashfree.getOrder('prod-order');

      assert.equal(
        calls.at(-1).url,
        'https://api.cashfree.com/pg/orders/prod-order'
      );
      assert.deepEqual(cashfree.publicConfig(), {
        enabled: true,
        environment: 'production'
      });

      configure('sandbox');
    });

    await test('HTTP 429 becomes a retryable service-unavailable error', async () => {
      queueJson({ message: 'test provider throttle' }, 429);

      await assert.rejects(
        cashfree.getOrder('throttled-order'),
        error =>
          error.code === 'CASHFREE_PROVIDER_REJECTED' &&
          error.status === 503 &&
          error.providerStatus === 429 &&
          error.retryable === true
      );
    });

    await test('Provider 5xx is retryable without exposing provider response details', async () => {
      queueJson({ message: 'private test detail' }, 500);

      await assert.rejects(
        cashfree.getOrder('server-error-order'),
        error =>
          error.status === 503 &&
          error.retryable === true &&
          !error.message.includes('private test detail')
      );
    });

    await test('Provider 4xx is non-retryable and sanitized', async () => {
      queueJson({ message: 'private validation detail' }, 400);

      await assert.rejects(
        cashfree.getOrder('invalid-order'),
        error =>
          error.status === 502 &&
          error.retryable === false &&
          !error.message.includes('private validation detail')
      );
    });

    await test('Network failures become retryable provider-unavailable errors', async () => {
      responses.push(new Error('private network detail'));

      await assert.rejects(
        cashfree.getOrder('network-error-order'),
        error =>
          error.code === 'CASHFREE_PROVIDER_UNAVAILABLE' &&
          error.status === 503 &&
          error.retryable === true &&
          !error.message.includes('private network detail')
      );
    });

    await test('Malformed successful provider JSON is rejected', async () => {
      queueRaw('{not-json', 200);

      await assert.rejects(
        cashfree.getOrder('malformed-order'),
        error => error.code === 'CASHFREE_INVALID_RESPONSE'
      );
    });

    await test('Webhook HMAC validates exact raw body and rejects tampering', async () => {
      const timestamp = '1700000000000';
      const rawBody = Buffer.from(
        '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"MLNCF_test_0123456789abcdef"}}}',
        'utf8'
      );

      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(timestamp, 'utf8')
        .update(rawBody)
        .digest('base64');

      assert.equal(
        cashfree.verifyWebhookSignature(rawBody, timestamp, signature),
        true
      );

      assert.equal(
        cashfree.verifyWebhookSignature(
          Buffer.from(rawBody.toString() + ' ', 'utf8'),
          timestamp,
          signature
        ),
        false
      );

      assert.equal(
        cashfree.verifyWebhookSignature(rawBody, timestamp, 'invalid-signature'),
        false
      );
    });

    await test('Webhook rejects invalid timestamp, non-buffer and oversized payloads', async () => {
      const timestamp = '1700000000000';
      const rawBody = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK"}');
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(timestamp, 'utf8')
        .update(rawBody)
        .digest('base64');

      assert.equal(
        cashfree.verifyWebhookSignature(rawBody, 'invalid', signature),
        false
      );

      assert.equal(
        cashfree.verifyWebhookSignature(rawBody.toString(), timestamp, signature),
        false
      );

      assert.equal(
        cashfree.verifyWebhookSignature(
          Buffer.alloc(1024 * 1024 + 1),
          timestamp,
          signature
        ),
        false
      );
    });

    await test('Webhook and payload hashes are stable SHA-256 digests', async () => {
      const timestamp = '1700000000000';
      const rawBody = Buffer.from('cashfree-test-payload');

      const expectedEventHash = crypto
        .createHash('sha256')
        .update(timestamp, 'utf8')
        .update('.', 'utf8')
        .update(rawBody)
        .digest('hex');

      const expectedPayloadHash = crypto
        .createHash('sha256')
        .update(rawBody)
        .digest('hex');

      assert.equal(
        cashfree.hashWebhookEvent(timestamp, rawBody),
        expectedEventHash
      );
      assert.equal(cashfree.hashPayload(rawBody), expectedPayloadHash);
      assert.match(expectedEventHash, /^[a-f0-9]{64}$/);
      assert.match(expectedPayloadHash, /^[a-f0-9]{64}$/);
    });

    assert.equal(responses.length, 0, 'No mocked provider responses should remain.');
    console.log(`PASS: All ${passed} Cashfree provider client tests passed.`);
  } finally {
    global.fetch = originalFetch;

    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

main().catch(error => {
  console.error('FAIL: Cashfree provider self-test:', error.message);
  process.exitCode = 1;
});
