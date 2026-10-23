'use strict';

// Exercises the real Express route handlers against an isolated, in-memory
// database double. No database connection or external service is used.
// This complements static SQL/lock checks; it is not a PostgreSQL concurrency test.

const assert = require('node:assert/strict');
const express = require('express');

process.env.ADMIN_TOKEN = 'a08-runtime-test-token-only';
process.env.MILAN_PAY_UPI_ID = 'milan.test@upi';
process.env.MILAN_PAY_GOOGLE_PAY_IOS_ENABLED = 'false';

const users = new Map([
  ['user-1', { quota: 104857600 }],
  ['user-2', { quota: 104857600 }]
]);

const orders = [
  {
    order_id: 'MLNPAY_USER1_mabc123_abcdef123456',
    user_id: 'user-1',
    plan: '500mb',
    amount_inr: 250,
    gateway: 'milanpay',
    status: 'pending',
    gateway_reference: 'milan.test@upi'
  },
  {
    order_id: 'MLNPAY_USER2_mabc124_abcdef123457',
    user_id: 'user-2',
    plan: '500mb',
    amount_inr: 250,
    gateway: 'milanpay',
    status: 'pending',
    gateway_reference: 'milan.test@upi'
  }
];

const requests = [];
let nextRequestId = 0;
let failNextInsertWithUniqueViolation = false;
let approvalRpcCalls = 0;

function result(rows) {
  return { rows };
}

function databaseQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

  // Model the RPC's externally visible state transition. Static CI checks
  // separately verify the real SQL locks, predicates and role grants.
  if (q.includes('select public.admin_approve_milan_pay_storage_request')) {
    approvalRpcCalls++;
    const request = requests.find(r => r.id === String(params[0]));

    if (!request) {
      return result([{
        data: { ok: false, httpStatus: 404, error: 'Request not found.' }
      }]);
    }
    if (request.status !== 'pending') {
      return result([{
        data: { ok: false, httpStatus: 409, error: 'Request is no longer pending.' }
      }]);
    }

    const order = orders.find(o =>
      o.order_id === request.order_id && o.user_id === request.user_id
    );
    if (!order || order.gateway !== 'milanpay' || order.status !== 'pending') {
      return result([{
        data: { ok: false, httpStatus: 409, error: 'Order is not pending.' }
      }]);
    }

    const targets = { '500mb': 524288000, '1gb': 1073741824 };
    const targetQuota = targets[request.plan];
    const account = users.get(request.user_id);

    if (!account || !targetQuota || account.quota >= targetQuota) {
      return result([{
        data: { ok: false, httpStatus: 409, error: 'Quota cannot be upgraded.' }
      }]);
    }

    // Synchronous state change models exactly one successful transition
    // inside this test double; it does not simulate database row locks.
    account.quota = Math.max(account.quota, targetQuota);
    order.status = 'paid';
    order.gateway_reference = request.utr;
    order.paid_at = new Date().toISOString();
    request.status = 'approved';

    return result([{
      data: {
        ok: true,
        orderId: order.order_id,
        paymentStatus: order.status,
        requestId: request.id,
        requestStatus: request.status,
        quotaBytes: account.quota
      }
    }]);
  }

  if (q.startsWith('select order_id, user_id, plan, amount_inr, status, gateway from public.payment_orders')) {
    const row = orders.find(o =>
      o.order_id === params[0] && o.user_id === params[1]
    );
    return result(row ? [{ ...row }] : []);
  }

  if (q.startsWith('select id, status from public.storage_upgrade_requests') &&
      q.includes('lower(btrim(utr))')) {
    const key = String(params[0]).trim().toLowerCase();
    const row = requests.find(r => r.utr.trim().toLowerCase() === key);
    return result(row ? [{ id: row.id, status: row.status }] : []);
  }

  if (q.startsWith('select id, status from public.storage_upgrade_requests') &&
      q.includes('where order_id = $1')) {
    const row = requests.find(r => r.order_id === params[0]);
    return result(row ? [{ id: row.id, status: row.status }] : []);
  }

  if (q.startsWith('select id from public.storage_upgrade_requests') &&
      q.includes('where user_id = $1') && q.includes("status = 'pending'")) {
    const row = requests.find(r =>
      r.user_id === params[0] && r.status === 'pending'
    );
    return result(row ? [{ id: row.id }] : []);
  }

  if (q.startsWith('insert into public.storage_upgrade_requests')) {
    if (failNextInsertWithUniqueViolation) {
      failNextInsertWithUniqueViolation = false;
      const error = new Error('Simulated unique constraint violation');
      error.code = '23505';
      throw error;
    }

    const [userId, orderId, plan, quotaBytes, amountInr, utr] = params;
    const row = {
      id: `request-${++nextRequestId}`,
      user_id: userId,
      order_id: orderId,
      plan,
      quota_bytes: quotaBytes,
      amount_inr: amountInr,
      utr,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    requests.push(row);
    return result([{ ...row }]);
  }

  throw new Error(`Unexpected database query in isolated test: ${q}`);
}

function mockModule(relativePath, exports) {
  const filename = require.resolve(relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports
  };
}

mockModule('../backend/services/milanDb', { query: databaseQuery });

mockModule('../backend/middleware/auth', (req, _res, next) => {
  const userId = String(req.get('x-test-user-id') || 'user-1');
  const account = users.get(userId);
  req.account = {
    id: userId,
    dwn_quota_bytes: account ? account.quota : 104857600,
    dwnQuotaBytes: account ? account.quota : 104857600
  };
  next();
});

mockModule('../backend/middleware/distributedApiRateLimiter',
  () => (_req, _res, next) => next());

const storageRouter = require('../backend/routes/storage');
const paymentRouter = require('../backend/routes/milanPay');

const app = express();
app.use(express.json());
app.use('/api/storage', storageRouter);
app.use('/api/milan-pay', paymentRouter);

let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS: ${name}`);
}

async function main() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  async function get(path) {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json() };
  }

  async function post(path, body, { userId, adminToken } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (userId) headers['x-test-user-id'] = userId;
    if (adminToken) headers['x-admin-token'] = adminToken;

    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  const order1 = orders[0].order_id;
  const order2 = orders[1].order_id;
  const quotaBefore = users.get('user-1').quota;
  let requestId;

  try {
    await test('UPI configuration truthfully reports manual verification', async () => {
      const response = await get('/api/milan-pay/config');
      assert.equal(response.status, 200);
      assert.equal(response.body.verificationMode, 'manual-bank-verification');
      assert.equal(response.body.automaticPaymentConfirmationAvailable, false);
      assert.equal(response.body.cardPaymentsAvailable, false);
    });

    await test('another account cannot submit a UTR for an order it does not own', async () => {
      const response = await post('/api/storage/upgrade-request', {
        plan: '500mb', orderId: order1, utr: 'OwnerREF12345'
      }, { userId: 'user-2' });

      assert.equal(response.status, 404);
      assert.equal(requests.length, 0);
      assert.equal(users.get('user-1').quota, quotaBefore);
    });

    await test('valid UTR submission creates a pending request without granting quota', async () => {
      const response = await post('/api/storage/upgrade-request', {
        plan: '500mb', orderId: order1, utr: 'BankREF12345'
      }, { userId: 'user-1' });

      assert.equal(response.status, 201);
      requestId = response.body.request.id;
      assert.equal(response.body.request.status, 'pending');
      assert.equal(orders[0].status, 'pending');
      assert.equal(users.get('user-1').quota, quotaBefore);
      assert.match(response.body.message, /independently verifies the bank transaction/i);
    });

    await test('repeat submission for the same order is rejected', async () => {
      const response = await post('/api/storage/upgrade-request', {
        plan: '500mb', orderId: order1, utr: 'AnotherREF123'
      }, { userId: 'user-1' });

      assert.equal(response.status, 409);
      assert.equal(requests.length, 1);
      assert.equal(users.get('user-1').quota, quotaBefore);
    });

    await test('UTR uniqueness is case-insensitive across different orders', async () => {
      const response = await post('/api/storage/upgrade-request', {
        plan: '500mb', orderId: order2, utr: '  bankref12345  '
      }, { userId: 'user-2' });

      assert.equal(response.status, 409);
      assert.equal(requests.length, 1);
      assert.equal(users.get('user-2').quota, 104857600);
    });

    await test('database unique-conflict race fails closed without a second request', async () => {
      failNextInsertWithUniqueViolation = true;
      const response = await post('/api/storage/upgrade-request', {
        plan: '500mb', orderId: order2, utr: 'RaceREF12345'
      }, { userId: 'user-2' });

      assert.equal(response.status, 409);
      assert.equal(requests.length, 1);
      assert.equal(users.get('user-2').quota, 104857600);
    });

    await test('admin approval rejects a missing admin token', async () => {
      const response = await post(
        `/api/storage/admin/requests/${requestId}/approve`,
        { bankVerified: true }
      );

      assert.equal(response.status, 401);
      assert.equal(approvalRpcCalls, 0);
      assert.equal(users.get('user-1').quota, quotaBefore);
    });

    await test('admin approval requires explicit independent bank verification', async () => {
      const response = await post(
        `/api/storage/admin/requests/${requestId}/approve`,
        {},
        { adminToken: process.env.ADMIN_TOKEN }
      );

      assert.equal(response.status, 400);
      assert.equal(approvalRpcCalls, 0);
      assert.equal(orders[0].status, 'pending');
      assert.equal(requests[0].status, 'pending');
      assert.equal(users.get('user-1').quota, quotaBefore);
    });

    await test('duplicate approval attempts produce one successful transition in the test double', async () => {
      const path = `/api/storage/admin/requests/${requestId}/approve`;
      const options = {
        adminToken: process.env.ADMIN_TOKEN
      };
      const body = { bankVerified: true, note: 'Isolated runtime test only' };

      const responses = await Promise.all([
        post(path, body, options),
        post(path, body, options)
      ]);

      assert.deepEqual(
        responses.map(r => r.status).sort((a, b) => a - b),
        [200, 409]
      );
      assert.equal(orders[0].status, 'paid');
      assert.equal(requests[0].status, 'approved');
      assert.equal(users.get('user-1').quota, 524288000);
    });

    await test('subsequent approval retry cannot increase quota again', async () => {
      const response = await post(
        `/api/storage/admin/requests/${requestId}/approve`,
        { bankVerified: true },
        { adminToken: process.env.ADMIN_TOKEN }
      );

      assert.equal(response.status, 409);
      assert.equal(users.get('user-1').quota, 524288000);
      assert.equal(orders[0].status, 'paid');
      assert.equal(requests[0].status, 'approved');
    });

    console.log(`A08 PAYMENT RUNTIME SELF-TEST: ${passed} passed, 0 failed.`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
}

main().catch(error => {
  console.error('A08 PAYMENT RUNTIME SELF-TEST FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
