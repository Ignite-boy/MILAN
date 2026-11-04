'use strict';

// Exercises real Express Cashfree routes using isolated module mocks.
// No PostgreSQL or external Cashfree network request is made.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const users = new Map([
  ['user-1', { quota: 104857600 }],
  ['user-2', { quota: 104857600 }],
  ['user-3', { quota: 104857600 }]
]);

const orders = [];
const storageRequests = [];
const providerOrders = new Map();
const providerPayments = new Map();
const paymentAttempts = new Map();
const webhookEvents = new Map();

let cashfreeEnabled = false;
let nextProviderOrderId = 0;
let createOrderCalls = [];
let failNextUniqueInsert = false;

const counters = {
  attach: 0,
  process: 0,
  providerGetOrder: 0,
  providerGetPayments: 0,
  providerGetPayment: 0
};

class MockCashfreeGatewayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.status = options.status || 502;
    this.code = options.code || 'CASHFREE_PROVIDER_ERROR';
    this.retryable = options.retryable === true;
  }
}

const cashfree = {
  CashfreeGatewayError: MockCashfreeGatewayError,

  settings() {
    return {
      enabled: cashfreeEnabled,
      environment: 'sandbox',
      configured: cashfreeEnabled
    };
  },

  publicConfig() {
    return {
      enabled: cashfreeEnabled,
      environment: cashfreeEnabled ? 'sandbox' : null
    };
  },

  async createOrder(body, idempotencyKey) {
    createOrderCalls.push({
      body: structuredClone(body),
      idempotencyKey
    });

    const existing = [...providerOrders.values()].find(
      order => order.order_id === body.order_id
    );

    if (existing) {
      return {
        ...existing,
        payment_session_id: `session-${body.order_id}`
      };
    }

    const result = {
      cf_order_id: `cf-${++nextProviderOrderId}`,
      order_id: body.order_id,
      order_amount: body.order_amount,
      order_currency: body.order_currency,
      order_status: 'ACTIVE',
      payment_session_id: `session-${body.order_id}`
    };

    providerOrders.set(body.order_id, result);
    return { ...result };
  },

  async getOrder(orderId) {
    counters.providerGetOrder++;
    const order = providerOrders.get(orderId);
    if (!order) throw new MockCashfreeGatewayError('Provider order missing.', {
      status: 502,
      code: 'CASHFREE_PROVIDER_REJECTED',
      retryable: true
    });
    return { ...order };
  },

  async getPayments(orderId) {
    counters.providerGetPayments++;
    return structuredClone(providerPayments.get(orderId) || []);
  },

  async getPayment(orderId, paymentId) {
    counters.providerGetPayment++;
    const payment = (providerPayments.get(orderId) || []).find(
      item => String(item.cf_payment_id) === String(paymentId)
    );

    if (!payment) {
      throw new MockCashfreeGatewayError('Provider payment missing.', {
        status: 503,
        retryable: true
      });
    }

    return structuredClone(payment);
  },

  verifyWebhookSignature(_rawBody, _timestamp, signature) {
    return signature === 'valid-test-signature';
  },

  hashWebhookEvent(timestamp, rawBody) {
    return crypto.createHash('sha256')
      .update(timestamp, 'utf8')
      .update('.', 'utf8')
      .update(rawBody)
      .digest('hex');
  },

  hashPayload(rawBody) {
    return crypto.createHash('sha256').update(rawBody).digest('hex');
  }
};

function result(rows) {
  return { rows };
}

function databaseQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

  if (q.includes('select public.attach_cashfree_order(')) {
    counters.attach++;

    const [orderId, userId, cfOrderId, sessionId] = params;
    const order = orders.find(item =>
      item.order_id === orderId &&
      item.user_id === userId &&
      item.gateway === 'cashfree'
    );

    if (!order) {
      return result([{
        data: { ok: false, httpStatus: 404 }
      }]);
    }

    if (order.status !== 'pending') {
      return result([{
        data: { ok: false, httpStatus: 409 }
      }]);
    }

    if (order.cf_order_id && order.cf_order_id !== cfOrderId) {
      return result([{
        data: { ok: false, httpStatus: 409 }
      }]);
    }

    order.cf_order_id = cfOrderId;
    order.provider_payment_session_id = sessionId;

    return result([{
      data: {
        ok: true,
        orderId,
        providerOrderAttached: true
      }
    }]);
  }

  if (q.includes('select public.process_cashfree_payment_event(')) {
    counters.process++;

    const [
      eventHash,
      payloadHash,
      eventType,
      eventTime,
      orderId,
      cfOrderId,
      paymentId,
      paymentStatus,
      orderAmount,
      orderCurrency,
      paymentAmount,
      paymentCurrency,
      paymentGroup,
      bankReference
    ] = params;

    const priorEvent = webhookEvents.get(eventHash);

    if (priorEvent) {
      assert.equal(priorEvent.payloadHash, payloadHash);

      if (priorEvent.processed) {
        return result([{
          data: { ok: true, duplicateEvent: true }
        }]);
      }

      priorEvent.processed = false;
    } else {
      webhookEvents.set(eventHash, {
        payloadHash,
        eventType,
        eventTime,
        orderId,
        processed: false
      });
    }

    const event = webhookEvents.get(eventHash);
    const order = orders.find(item =>
      item.order_id === orderId && item.gateway === 'cashfree'
    );

    const review = code => {
      event.processed = true;
      event.reviewRequired = true;
      return result([{
        data: {
          ok: false,
          httpStatus: 202,
          reviewRequired: true,
          code
        }
      }]);
    };

    if (!order) return review('ORDER_NOT_FOUND');

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(paymentId || ''))) {
      return review('INVALID_PAYMENT_ID');
    }

    const status = String(paymentStatus || '').toUpperCase();
    if (![
      'SUCCESS', 'PENDING', 'FAILED', 'USER_DROPPED',
      'NOT_ATTEMPTED', 'VOID', 'CANCELLED'
    ].includes(status)) {
      return review('UNKNOWN_PAYMENT_STATUS');
    }

    const existingAttempt = paymentAttempts.get(paymentId);

    if (existingAttempt && existingAttempt.orderId !== orderId) {
      return review('PAYMENT_ID_ORDER_MISMATCH');
    }

    const attempt = existingAttempt || {
      orderId,
      status,
      processingStatus: 'received'
    };

    if (attempt.status !== 'SUCCESS' || status === 'SUCCESS') {
      attempt.status = status;
    }

    paymentAttempts.set(paymentId, attempt);

    if (
      order.cf_order_id !== cfOrderId ||
      Number(orderAmount) !== Number(order.amount_inr) ||
      Number(paymentAmount) !== Number(order.amount_inr) ||
      String(orderCurrency || '').toUpperCase() !== 'INR' ||
      String(paymentCurrency || '').toUpperCase() !== 'INR'
    ) {
      attempt.processingStatus = 'review_required';
      return review('ORDER_MAPPING_AMOUNT_OR_CURRENCY_MISMATCH');
    }

    if (
      attempt.status === 'SUCCESS' &&
      order.status === 'paid' &&
      order.provider_payment_id === paymentId
    ) {
      attempt.processingStatus = 'processed';
      event.processed = true;

      return result([{
        data: {
          ok: true,
          alreadyFinalized: true,
          paymentStatus: 'paid'
        }
      }]);
    }

    if (attempt.status !== 'SUCCESS') {
      attempt.processingStatus = 'processed';
      event.processed = true;

      return result([{
        data: {
          ok: true,
          finalized: false,
          paymentStatus: attempt.status,
          orderStatus: order.status
        }
      }]);
    }

    if (order.status !== 'pending') {
      return review('ORDER_ALREADY_PAID_OR_NOT_PENDING');
    }

    const targets = {
      '500mb': { amount: 250, quota: 524288000 },
      '1gb': { amount: 500, quota: 1073741824 }
    };

    const plan = targets[order.plan];
    const account = users.get(order.user_id);

    if (
      !plan ||
      Number(order.amount_inr) !== plan.amount ||
      !account ||
      account.quota >= plan.quota
    ) {
      return review('ACCOUNT_OR_PLAN_REVIEW_REQUIRED');
    }

    // In-memory model of the atomic RPC transition; not a row-lock test.
    account.quota = Math.max(account.quota, plan.quota);
    order.status = 'paid';
    order.provider_payment_id = paymentId;
    order.paid_at = new Date().toISOString();

    attempt.processingStatus = 'processed';
    event.processed = true;

    return result([{
      data: {
        ok: true,
        finalized: true,
        orderId,
        paymentStatus: 'paid',
        quotaBytes: account.quota
      }
    }]);
  }

  if (q.startsWith('select id from public.storage_upgrade_requests')) {
    const userId = params[0];
    const request = storageRequests.find(item =>
      item.user_id === userId && item.status === 'pending'
    );
    return result(request ? [{ id: request.id }] : []);
  }

  if (q.startsWith('select order_id, plan, amount_inr, status, gateway,')) {
    const userId = params[0];
    const pending = orders
      .filter(item =>
        item.user_id === userId &&
        ['milanpay', 'cashfree'].includes(item.gateway) &&
        item.status === 'pending'
      )
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, 2);

    return result(pending.map(item => ({ ...item })));
  }

  if (q.startsWith('insert into public.payment_orders')) {
    if (failNextUniqueInsert) {
      failNextUniqueInsert = false;
      const error = new Error('Simulated partial unique index conflict.');
      error.code = '23505';
      throw error;
    }

    const [userId, orderId, plan, amount, idempotencyKey, phone] = params;

    if (orders.some(item =>
      item.user_id === userId &&
      ['milanpay', 'cashfree'].includes(item.gateway) &&
      item.status === 'pending'
    )) {
      const error = new Error('Simulated pending order conflict.');
      error.code = '23505';
      throw error;
    }

    const order = {
      order_id: orderId,
      user_id: userId,
      plan,
      amount_inr: amount,
      gateway: 'cashfree',
      status: 'pending',
      provider_idempotency_key: idempotencyKey,
      customer_phone: phone,
      cf_order_id: null,
      provider_payment_session_id: null,
      provider_payment_id: null,
      created_at: Date.now()
    };

    orders.push(order);
    return result([{ ...order }]);
  }

  if (
    q.startsWith('select order_id, user_id, plan, amount_inr, status,') &&
    q.includes('gateway =')
  ) {
    const order = orders.find(item =>
      item.order_id === params[0] &&
      item.user_id === params[1] &&
      item.gateway === 'cashfree'
    );

    return result(order ? [{ ...order }] : []);
  }

  if (q.startsWith('select status, paid_at from public.payment_orders')) {
    const order = orders.find(item =>
      item.order_id === params[0] &&
      item.user_id === params[1] &&
      item.gateway === 'cashfree'
    );

    return result(order ? [{
      status: order.status,
      paid_at: order.paid_at || null
    }] : []);
  }

  if (
    q.includes('from public.cashfree_payment_attempts') &&
    q.includes('from public.cashfree_webhook_events') &&
    q.includes("processing_status = 'review_required'")
  ) {
    const orderId = params[0];
    const unresolvedAttempt = [...paymentAttempts.values()].some(item =>
      item.orderId === orderId &&
      item.processingStatus === 'review_required'
    );
    const unresolvedEvent = [...webhookEvents.values()].some(item =>
      item.orderId === orderId &&
      item.reviewRequired === true
    );

    return result([{
      review_required: unresolvedAttempt || unresolvedEvent
    }]);
  }

  throw new Error(`Unexpected isolated database query: ${q}`);
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
    dwnQuotaBytes: account?.quota ?? 104857600,
    dwn_quota_bytes: account?.quota ?? 104857600
  };

  next();
});

mockModule('../backend/middleware/distributedApiRateLimiter',
  () => (_req, _res, next) => next());

mockModule('../backend/services/cashfreeGateway', cashfree);

const cashfreeRouter = require('../backend/routes/cashfree');

const app = express();

// Webhook raw-body parser must be mounted before express.json().
app.post(
  '/api/cashfree/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  cashfreeRouter.webhookHandler
);

app.use(express.json());
app.use('/api/cashfree', cashfreeRouter);

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

  const base = `http://127.0.0.1:${server.address().port}`;

  async function get(path, userId = 'user-1') {
    const response = await fetch(`${base}${path}`, {
      headers: { 'x-test-user-id': userId }
    });
    return {
      status: response.status,
      body: await response.json()
    };
  }

  async function post(path, body, userId = 'user-1') {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': userId
      },
      body: JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.json()
    };
  }

  async function rawWebhook(raw, signature = 'valid-test-signature') {
    const response = await fetch(`${base}/api/cashfree/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': '1700000000000',
        'x-webhook-signature': signature
      },
      body: raw
    });

    return {
      status: response.status,
      body: await response.json()
    };
  }

  function latestOrder(userId) {
    return orders.filter(item =>
      item.user_id === userId && item.gateway === 'cashfree'
    ).at(-1);
  }

  function addPayment(order, options = {}) {
    const planAmount = Number(order.amount_inr);
    const payment = {
      cf_payment_id: options.paymentId || `pay-${order.order_id}`,
      order_id: order.order_id,
      payment_status: options.status || 'SUCCESS',
      payment_amount: options.amount ?? planAmount,
      payment_currency: options.currency || 'INR',
      payment_group: options.group || 'upi',
      bank_reference: options.bankReference || 'bank-test-reference',
      payment_time: '2026-11-04T10:00:00+05:30',
      payment_completion_time: '2026-11-04T10:00:02+05:30'
    };

    providerPayments.set(order.order_id, [payment]);
    return payment;
  }

  try {
    await test('Public Cashfree config is disabled when provider is disabled', async () => {
      const response = await get('/api/cashfree/config');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        ok: true,
        enabled: false,
        environment: null
      });
    });

    await test('Order creation fails closed while Cashfree is disabled', async () => {
      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      });

      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'CASHFREE_DISABLED');
      assert.equal(orders.length, 0);
    });

    cashfreeEnabled = true;

    await test('Invalid plan is rejected before creating an order', async () => {
      const response = await post('/api/cashfree/orders', {
        plan: '999gb',
        phone: '9876543210'
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'CASHFREE_INVALID_PLAN');
      assert.equal(orders.length, 0);
    });

    await test('Invalid Indian mobile number is rejected', async () => {
      for (const phone of ['1234567890', '987654321', '+919876543210']) {
        const response = await post('/api/cashfree/orders', {
          plan: '500mb',
          phone
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'CASHFREE_INVALID_PHONE');
      }

      assert.equal(orders.length, 0);
    });

    await test('An already sufficient quota cannot be charged again', async () => {
      users.get('user-3').quota = 524288000;

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      }, 'user-3');

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'STORAGE_PLAN_NOT_AN_UPGRADE');
      assert.equal(orders.length, 0);

      users.get('user-3').quota = 104857600;
    });

    await test('An active manual verification request blocks Cashfree order creation', async () => {
      storageRequests.push({
        id: 'request-user-2',
        user_id: 'user-2',
        status: 'pending'
      });

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      }, 'user-2');

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'STORAGE_REQUEST_PENDING');
      assert.equal(latestOrder('user-2'), undefined);

      storageRequests.length = 0;
    });

    await test('A pending UPI order blocks a parallel Cashfree order', async () => {
      orders.push({
        order_id: 'MLNPAY_USER2_test_abcdef123456',
        user_id: 'user-2',
        plan: '500mb',
        amount_inr: 250,
        gateway: 'milanpay',
        status: 'pending',
        created_at: Date.now()
      });

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      }, 'user-2');

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'OTHER_PAYMENT_ORDER_PENDING');

      orders.pop();
    });

    let firstOrderId;
    let firstSessionId;
    let firstIdempotencyKey;

    await test('Valid 500 MB order is stored before calling the provider', async () => {
      const before = createOrderCalls.length;

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210',
        amount: 1
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.amountInr, 250);
      assert.equal(response.body.currency, 'INR');
      assert.equal(response.body.provider, 'cashfree');
      assert.equal(response.body.status, 'pending');
      assert.match(response.body.orderId, /^MLNCF_[a-z0-9]+_[a-f0-9]{16}$/);
      assert.equal(response.body.paymentSessionId, `session-${response.body.orderId}`);

      firstOrderId = response.body.orderId;
      firstSessionId = response.body.paymentSessionId;

      const local = latestOrder('user-1');
      assert.equal(local.order_id, firstOrderId);
      assert.equal(local.status, 'pending');
      assert.equal(local.amount_inr, 250);
      assert.equal(local.customer_phone, '9876543210');
      assert.equal(local.cf_order_id, providerOrders.get(firstOrderId).cf_order_id);
      assert.equal(users.get('user-1').quota, 104857600);

      assert.equal(createOrderCalls.length, before + 1);
      assert.equal(createOrderCalls.at(-1).body.order_amount, 250);
      assert.equal(createOrderCalls.at(-1).body.order_currency, 'INR');
      assert.equal(
        createOrderCalls.at(-1).body.customer_details.customer_phone,
        '9876543210'
      );

      firstIdempotencyKey = local.provider_idempotency_key;
      assert.equal(createOrderCalls.at(-1).idempotencyKey, firstIdempotencyKey);
      assert.equal(response.body.customer_phone, undefined);
    });

    await test('Repeated checkout reuses provider session and saved idempotency key', async () => {
      const before = createOrderCalls.length;

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.reusedOrder, true);
      assert.equal(response.body.orderId, firstOrderId);
      assert.equal(response.body.paymentSessionId, firstSessionId);
      assert.equal(createOrderCalls.length, before);
      assert.equal(latestOrder('user-1').provider_idempotency_key, firstIdempotencyKey);
    });

    await test('Persistent review flags block checkout resume even when provider returns no payments', async () => {
      webhookEvents.set('synthetic-persistent-review', {
        orderId: firstOrderId,
        reviewRequired: true,
        processed: true
      });

      const verifyResponse = await post(
        `/api/cashfree/orders/${firstOrderId}/verify`,
        {}
      );

      assert.equal(verifyResponse.status, 200);
      assert.equal(verifyResponse.body.status, 'pending');
      assert.equal(verifyResponse.body.reviewRequired, true);
      assert.equal(verifyResponse.body.verifiedPayments, 0);

      const beforeProviderCreate = createOrderCalls.length;
      const resumeResponse = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543210'
      });

      assert.equal(resumeResponse.status, 409);
      assert.equal(
        resumeResponse.body.code,
        'CASHFREE_PAYMENT_REVIEW_REQUIRED'
      );
      assert.equal(createOrderCalls.length, beforeProviderCreate);

      webhookEvents.delete('synthetic-persistent-review');
    });

    await test('A different phone cannot silently alter an existing pending order', async () => {
      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9876543211'
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'CASHFREE_PENDING_PHONE_MISMATCH');
      assert.equal(latestOrder('user-1').customer_phone, '9876543210');
    });

    await test('Malformed order IDs are rejected before database access', async () => {
      const response = await post('/api/cashfree/orders/not-a-cashfree-order/verify', {});
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'CASHFREE_INVALID_ORDER_ID');
    });

    await test('A different user cannot verify another account order', async () => {
      const response = await post(
        `/api/cashfree/orders/${firstOrderId}/verify`,
        {},
        'user-2'
      );

      assert.equal(response.status, 404);
      assert.equal(response.body.code, 'CASHFREE_ORDER_NOT_FOUND');
    });

    await test('Provider reconciliation leaves an order pending without a payment', async () => {
      providerPayments.set(firstOrderId, []);

      const response = await post(
        `/api/cashfree/orders/${firstOrderId}/verify`,
        {}
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'pending');
      assert.equal(response.body.verifiedPayments, 0);
      assert.equal(latestOrder('user-1').status, 'pending');
      assert.equal(users.get('user-1').quota, 104857600);
    });

    await test('Provider reconciliation finalizes only verified SUCCESS payment', async () => {
      addPayment(latestOrder('user-1'), { status: 'SUCCESS' });

      const response = await post(
        `/api/cashfree/orders/${firstOrderId}/verify`,
        {}
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'paid');
      assert.equal(latestOrder('user-1').status, 'paid');
      assert.equal(latestOrder('user-1').provider_payment_id, `pay-${firstOrderId}`);
      assert.equal(users.get('user-1').quota, 524288000);
      assert.equal(counters.process, 1);
    });

    await test('Already paid orders do not call the provider again', async () => {
      const before = counters.providerGetOrder;

      const response = await post(
        `/api/cashfree/orders/${firstOrderId}/verify`,
        {}
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'paid');
      assert.equal(response.body.finalized, true);
      assert.equal(counters.providerGetOrder, before);
      assert.equal(users.get('user-1').quota, 524288000);
    });

    let webhookOrderId;
    let webhookRaw;

    await test('A second account can create a separate 1 GB Cashfree order', async () => {
      const response = await post('/api/cashfree/orders', {
        plan: '1gb',
        phone: '9123456789'
      }, 'user-2');

      assert.equal(response.status, 201);
      assert.equal(response.body.amountInr, 500);
      assert.equal(response.body.plan, '1gb');

      webhookOrderId = response.body.orderId;
    });

    await test('Webhook signature failure is rejected without processing an event', async () => {
      const before = counters.process;
      const raw = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' });

      const response = await rawWebhook(raw, 'invalid-test-signature');

      assert.equal(response.status, 401);
      assert.equal(response.body.code, 'CASHFREE_WEBHOOK_SIGNATURE_INVALID');
      assert.equal(counters.process, before);
    });

    await test('Non-payment signed webhook is acknowledged without quota change', async () => {
      const raw = JSON.stringify({
        type: 'REFUND_STATUS_WEBHOOK',
        data: {}
      });

      const response = await rawWebhook(raw);

      assert.equal(response.status, 200);
      assert.equal(response.body.ignored, true);
      assert.equal(users.get('user-2').quota, 104857600);
    });

    await test('Signed payment webhook fetches provider payment and finalizes quota', async () => {
      const order = latestOrder('user-2');
      const payment = addPayment(order, {
        paymentId: 'webhook-pay-2',
        status: 'SUCCESS',
        amount: 500
      });

      webhookRaw = JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        event_time: '2026-11-04T10:05:00+05:30',
        data: {
          order: {
            order_id: webhookOrderId,
            cf_order_id: order.cf_order_id
          },
          payment: {
            cf_payment_id: payment.cf_payment_id,
            payment_status: 'SUCCESS',
            payment_amount: 500,
            payment_currency: 'INR'
          }
        }
      });

      const beforeFetch = counters.providerGetPayment;
      const response = await rawWebhook(webhookRaw);

      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.reviewRequired, false);
      assert.equal(counters.providerGetPayment, beforeFetch + 1);
      assert.equal(order.status, 'paid');
      assert.equal(order.provider_payment_id, 'webhook-pay-2');
      assert.equal(users.get('user-2').quota, 1073741824);
    });

    await test('Webhook replay is acknowledged as a duplicate without double quota', async () => {
      const beforeQuota = users.get('user-2').quota;
      const beforeProcesses = counters.process;

      const response = await rawWebhook(webhookRaw);

      assert.equal(response.status, 200);
      assert.equal(response.body.duplicateEvent, true);
      assert.equal(counters.process, beforeProcesses + 1);
      assert.equal(users.get('user-2').quota, beforeQuota);
      assert.equal(beforeQuota, 1073741824);
    });

    await test('Partial unique-index race is translated to a safe HTTP conflict', async () => {
      failNextUniqueInsert = true;

      const response = await post('/api/cashfree/orders', {
        plan: '500mb',
        phone: '9123456789'
      }, 'user-3');

      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'CASHFREE_PENDING_ORDER_EXISTS');
      assert.equal(latestOrder('user-3'), undefined);
    });

    console.log(`PASS: All ${passed} isolated Cashfree route tests passed.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error('FAIL: Cashfree route self-test:', error.stack || error.message);
  process.exitCode = 1;
});
