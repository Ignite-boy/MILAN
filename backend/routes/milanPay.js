'use strict';

const express = require('express');
const crypto = require('node:crypto');
const auth = require('../middleware/auth');
const db = require('../services/milanDb');
const cashfree = require('../services/cashfreePayments');
const createDistributedApiRateLimiter = require('../middleware/distributedApiRateLimiter');

const router = express.Router();

const createOrderRateLimiter = createDistributedApiRateLimiter({
  limit: 8, windowMs: 60_000, scope: 'milan-pay-order-create'
});
const orderStatusRateLimiter = createDistributedApiRateLimiter({
  limit: 60, windowMs: 60_000, scope: 'milan-pay-order-status'
});

const PLANS = Object.freeze({
  '500mb': Object.freeze({ name: '500 MB Storage', amountInr: 250, quotaBytes: 524288000 }),
  '1gb': Object.freeze({ name: '1 GB Storage', amountInr: 500, quotaBytes: 1073741824 })
});

function makeOrderId(userId) {
  const user = String(userId || 'USER').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'USER';
  return `MLNPAY_${user}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function routeError(message, code, httpStatus = 409) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function amountMatches(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

function validOrderId(value) {
  return typeof value === 'string' &&
    value.length <= 45 &&
    /^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(value);
}

function paymentConfigResponse() {
  return cashfree.publicConfiguration();
}

async function attachProviderOrder(orderId, userId, providerOrder) {
  const cfOrderId = String(providerOrder && providerOrder.cf_order_id || '').trim();
  const paymentSessionId = String(providerOrder && providerOrder.payment_session_id || '').trim();
  if (!cfOrderId || cfOrderId.length > 100 || !paymentSessionId || paymentSessionId.length > 2048) {
    throw routeError('Cashfree did not return a valid hosted-checkout session.', 'CASHFREE_SESSION_INVALID', 502);
  }
  if (String(providerOrder.order_id || '') !== orderId) {
    throw routeError('Cashfree order reference did not match the MILAN order.', 'CASHFREE_ORDER_MISMATCH', 502);
  }

  const result = await db.query(
    'SELECT public.attach_cashfree_order($1, $2, $3, $4) AS data',
    [orderId, String(userId), cfOrderId, paymentSessionId]
  );
  const data = parseJsonObject(result.rows[0] && result.rows[0].data);
  if (!data || data.ok !== true) {
    throw routeError(
      data && data.error || 'Cashfree order could not be linked to MILAN.',
      'CASHFREE_ORDER_LINK_FAILED',
      Number(data && data.httpStatus) || 409
    );
  }
  return { cfOrderId, paymentSessionId };
}

async function finalizePayment({
  orderId,
  cfOrderId,
  payment,
  verifiedOrderAmount,
  verifiedOrderCurrency,
  eventType,
  payloadHash
}) {
  const paymentId = String(payment && payment.cf_payment_id || '').trim();
  if (!paymentId || paymentId.length > 100) {
    throw routeError('Cashfree payment reference is invalid.', 'CASHFREE_PAYMENT_ID_INVALID', 409);
  }

  const result = await db.query(
    `SELECT public.finalize_cashfree_payment(
       $1::text, $2::text, $3::text, $4::numeric, $5::numeric,
       $6::text, $7::text, $8::text, $9::text, $10::text,
       $11::text, $12::text
     ) AS data`,
    [
      orderId,
      cfOrderId,
      paymentId,
      payment.order_amount ?? verifiedOrderAmount,
      payment.payment_amount,
      payment.order_currency || verifiedOrderCurrency,
      payment.payment_currency,
      payment.payment_status,
      String(eventType || 'CASHFREE_PAYMENT_EVENT').slice(0, 100),
      payment.payment_group ? String(payment.payment_group).slice(0, 100) : null,
      payloadHash,
      null
    ]
  );
  return parseJsonObject(result.rows[0] && result.rows[0].data);
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(paymentConfigResponse());
});

// Cashfree calls this public endpoint. Signature verification must use req.rawBody,
// captured by the application JSON parser before this router is mounted.
router.post('/webhook', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const rawBody = req.rawBody;
  const signature = req.get('x-webhook-signature');
  const timestamp = req.get('x-webhook-timestamp');
  if (!cashfree.verifyWebhookSignature(signature, timestamp, rawBody)) {
    return res.status(401).json({ ok: false, error: 'Invalid Cashfree webhook signature.' });
  }

  const event = req.body && typeof req.body === 'object' ? req.body : {};
  const eventType = String(event.type || '').trim();
  const order = event.data && event.data.order;
  const payment = event.data && event.data.payment;

  // Only SUCCESS is a terminal payment status. Other events are acknowledged
  // without changing any MILAN entitlement or payment order.
  if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' || !payment || payment.payment_status !== 'SUCCESS') {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const orderId = String(order && order.order_id || '').trim();
  if (!validOrderId(orderId) || !payment.cf_payment_id) {
    return res.status(400).json({ ok: false, error: 'Cashfree webhook order or payment reference is invalid.' });
  }

  try {
    const localResult = await db.query(
      `SELECT order_id, amount_inr, plan, status, cf_order_id
         FROM public.payment_orders
        WHERE order_id = $1 AND gateway = 'cashfree'
        LIMIT 1`,
      [orderId]
    );
    const localOrder = localResult.rows[0];
    if (!localOrder) {
      return res.status(404).json({ ok: false, error: 'MILAN Cashfree order was not found.' });
    }
    if (!localOrder.cf_order_id) {
      return res.status(409).json({ ok: false, error: 'MILAN order is not linked to Cashfree yet.' });
    }

    // The signed webhook supplies the payment attempt. Independently retrieve
    // Cashfree's order and payment list before granting storage.
    const [providerOrder, providerPayments] = await Promise.all([
      cashfree.getOrder(orderId),
      cashfree.getPaymentsForOrder(orderId)
    ]);
    if (
      String(providerOrder.order_id || '') !== orderId ||
      String(providerOrder.cf_order_id || '') !== String(localOrder.cf_order_id) ||
      providerOrder.order_currency !== 'INR' ||
      !amountMatches(providerOrder.order_amount, localOrder.amount_inr)
    ) {
      return res.status(409).json({ ok: false, error: 'Cashfree order verification did not match MILAN records.' });
    }

    if (!Array.isArray(providerPayments)) {
      throw routeError('Cashfree payment history response is invalid.', 'CASHFREE_PAYMENT_HISTORY_INVALID', 502);
    }

    const verifiedPayment = providerPayments.find(item =>
      String(item && item.cf_payment_id || '') === String(payment.cf_payment_id) &&
      String(item && item.order_id || '') === orderId &&
      item.payment_status === 'SUCCESS'
    );
    if (!verifiedPayment) {
      // A just-fired webhook can arrive before the payment list is consistent.
      // Ask Cashfree to retry instead of marking the local order paid prematurely.
      return res.status(503).json({ ok: false, error: 'Cashfree payment is not yet visible in payment history.' });
    }

    const finalized = await finalizePayment({
      orderId,
      cfOrderId: String(localOrder.cf_order_id),
      payment: verifiedPayment,
      verifiedOrderAmount: providerOrder.order_amount,
      verifiedOrderCurrency: providerOrder.order_currency,
      eventType,
      payloadHash: cashfree.sha256(rawBody)
    });

    if (finalized && finalized.ok === true) {
      return res.status(200).json({ ok: true, processed: true, alreadyProcessed: finalized.alreadyProcessed === true });
    }
    if (finalized && finalized.code === 'MULTIPLE_SUCCESSFUL_PAYMENTS') {
      // This attempt was durably recorded for review. A 200 prevents endless
      // retries; a duplicate payment must be reconciled/refunded separately.
      return res.status(200).json({ ok: true, processed: true, reviewRequired: true });
    }

    console.error('[MILAN Cashfree] Webhook finalization rejected:', finalized && finalized.error || 'unknown result');
    return res.status(Number(finalized && finalized.httpStatus) || 409).json({
      ok: false,
      error: 'Cashfree payment requires reconciliation before storage can be activated.'
    });
  } catch (error) {
    console.error('[MILAN Cashfree] Webhook processing failed:', error.code || error.message);
    const status = Number(error.httpStatus) || 503;
    return res.status(status >= 400 && status <= 599 ? status : 503).json({
      ok: false,
      error: 'Cashfree webhook processing is temporarily unavailable.'
    });
  }
});

router.post('/orders', createOrderRateLimiter, auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const config = cashfree.requireConfiguration();
    const userId = String(req.account && req.account.id || '').trim();
    const planKey = String(req.body && req.body.plan || '').trim();
    const plan = PLANS[planKey];
    if (!userId) throw routeError('Authenticated MILAN account is unavailable.', 'ACCOUNT_UNAVAILABLE', 503);
    if (!plan) throw routeError('Invalid storage plan.', 'INVALID_PLAN', 400);

    const currentQuotaBytes = Number(
      req.account.dwnQuotaBytes ?? req.account.dwn_quota_bytes ?? 1073741824
    );
    if (!Number.isSafeInteger(currentQuotaBytes) || currentQuotaBytes < 1) {
      throw routeError('Your current storage quota could not be verified. No payment order was created.', 'STORAGE_QUOTA_UNAVAILABLE', 503);
    }
    if (currentQuotaBytes >= plan.quotaBytes) {
      throw routeError('Your account already has an equal or higher storage quota. No payment order was created.', 'STORAGE_PLAN_NOT_AN_UPGRADE', 409);
    }

    const phone = cashfree.normalizePhone(req.body && req.body.phone);

    const activeRequest = await db.query(
      `SELECT id
         FROM public.storage_upgrade_requests
        WHERE user_id = $1 AND status = 'pending'
        LIMIT 1`,
      [userId]
    );
    if (activeRequest.rows.length) {
      throw routeError('Your older storage request is awaiting bank verification. Please resolve it before creating a Cashfree order.', 'STORAGE_REQUEST_PENDING', 409);
    }

    const legacyPending = await db.query(
      `SELECT order_id
         FROM public.payment_orders
        WHERE user_id = $1 AND gateway = 'milanpay' AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 2`,
      [userId]
    );
    if (legacyPending.rows.length) {
      throw routeError('An older direct-UPI order is still pending. It must be reconciled before starting a Cashfree payment.', 'LEGACY_PAYMENT_RECONCILIATION_REQUIRED', 409);
    }

    const pendingResult = await db.query(
      `SELECT order_id, plan, amount_inr, status, cf_order_id,
              provider_payment_session_id,
              provider_idempotency_key::text AS provider_idempotency_key,
              provider_request_payload, customer_phone
         FROM public.payment_orders
        WHERE user_id = $1 AND gateway = 'cashfree' AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 2`,
      [userId]
    );
    if (pendingResult.rows.length > 1) {
      throw routeError('Multiple pending Cashfree orders need support reconciliation.', 'CASHFREE_PENDING_ORDER_RECONCILIATION_REQUIRED', 409);
    }

    let localOrder = pendingResult.rows[0] || null;
    let orderId;
    let idempotencyKey;
    let payload;
    let reusedOrder = false;

    if (localOrder) {
      if (localOrder.plan !== planKey || Number(localOrder.amount_inr) !== plan.amountInr) {
        throw routeError('You already have a pending Cashfree order for a different storage plan.', 'CASHFREE_PENDING_ORDER_EXISTS', 409);
      }
      if (String(localOrder.customer_phone || '') !== phone) {
        throw routeError('This pending order was created with a different mobile number. Continue with that same number or contact support.', 'CASHFREE_CUSTOMER_PHONE_MISMATCH', 409);
      }
      orderId = localOrder.order_id;
      reusedOrder = true;

      if (localOrder.cf_order_id && localOrder.provider_payment_session_id) {
        return res.status(200).json({
          ok: true,
          brand: 'MILAN Pay',
          provider: 'cashfree',
          orderId,
          plan: planKey,
          amountInr: plan.amountInr,
          currency: 'INR',
          status: 'pending',
          reusedOrder: true,
          paymentSessionId: localOrder.provider_payment_session_id,
          mode: config.environment
        });
      }
      if (localOrder.cf_order_id || !localOrder.provider_idempotency_key) {
        throw routeError('The existing Cashfree order is incomplete and needs support reconciliation.', 'CASHFREE_ORDER_INCOMPLETE', 409);
      }

      idempotencyKey = String(localOrder.provider_idempotency_key);
      payload = parseJsonObject(localOrder.provider_request_payload);
      if (!payload || !payload.customer_details || !payload.order_id || payload.order_id !== orderId) {
        throw routeError('The saved Cashfree request cannot be safely resumed. Contact support.', 'CASHFREE_SAVED_REQUEST_INVALID', 409);
      }
    } else {
      orderId = makeOrderId(userId);
      idempotencyKey = crypto.randomUUID();
      payload = cashfree.makeOrderPayload({
        orderId,
        userId,
        name: req.account.name,
        email: req.account.email,
        phone,
        amountInr: plan.amountInr
      });

      try {
        await db.query(
          `INSERT INTO public.payment_orders
             (user_id, order_id, plan, amount_inr, gateway, gateway_reference,
              customer_phone, provider_idempotency_key, provider_request_payload)
           VALUES ($1, $2, $3, $4, 'cashfree', NULL, $5, $6, $7::jsonb)`,
          [userId, orderId, planKey, plan.amountInr, phone, idempotencyKey, JSON.stringify(payload)]
        );
      } catch (error) {
        if (error && error.code === '23505') {
          throw routeError('A payment order was started at the same time. Retry once to resume the existing order.', 'CASHFREE_PENDING_ORDER_EXISTS', 409);
        }
        throw error;
      }
    }

    // The saved request and UUID are reused after timeouts, making retries safe.
    const providerOrder = await cashfree.createOrder(payload, idempotencyKey);
    const linked = await attachProviderOrder(orderId, userId, providerOrder);

    return res.status(reusedOrder ? 200 : 201).json({
      ok: true,
      brand: 'MILAN Pay',
      provider: 'cashfree',
      orderId,
      plan: planKey,
      amountInr: plan.amountInr,
      currency: 'INR',
      status: 'pending',
      reusedOrder,
      paymentSessionId: linked.paymentSessionId,
      mode: config.environment
    });
  } catch (error) {
    console.error('[MILAN Cashfree] Order creation failed:', error.code || error.message);
    const status = Number(error.httpStatus) || 500;
    return res.status(status >= 400 && status <= 599 ? status : 500).json({
      ok: false,
      code: error.code || 'CASHFREE_ORDER_CREATE_FAILED',
      error: error.message || 'Could not create the Cashfree payment order.'
    });
  }
});

router.get('/orders/:orderId/status', orderStatusRateLimiter, auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orderId = String(req.params.orderId || '').trim();
  if (!validOrderId(orderId)) {
    return res.status(400).json({ ok: false, error: 'Invalid payment order ID.' });
  }

  try {
    const result = await db.query(
      `SELECT order_id, status, amount_inr, plan, gateway,
              cf_order_id, provider_payment_session_id, paid_at
         FROM public.payment_orders
        WHERE order_id = $1 AND user_id = $2 AND gateway = 'cashfree'
        LIMIT 1`,
      [orderId, req.account.id]
    );
    const localOrder = result.rows[0];
    if (!localOrder) return res.status(404).json({ ok: false, error: 'Cashfree order not found.' });

    const plan = PLANS[localOrder.plan];
    if (!plan || Number(localOrder.amount_inr) !== plan.amountInr) {
      return res.status(409).json({ ok: false, error: 'Stored Cashfree order plan or amount is invalid.' });
    }

    if (localOrder.status === 'paid') {
      return res.json({
        ok: true, orderId, plan: localOrder.plan,
        amountInr: plan.amountInr, currency: 'INR', status: 'paid',
        paidAt: localOrder.paid_at || null, paymentActionRequired: false
      });
    }
    if (localOrder.status !== 'pending') {
      return res.json({
        ok: true, orderId, plan: localOrder.plan,
        amountInr: plan.amountInr, currency: 'INR', status: localOrder.status,
        paidAt: localOrder.paid_at || null, paymentActionRequired: false
      });
    }
    if (!localOrder.cf_order_id || !localOrder.provider_payment_session_id) {
      return res.status(202).json({
        ok: true, orderId, plan: localOrder.plan,
        amountInr: plan.amountInr, currency: 'INR', status: 'pending',
        paymentActionRequired: false,
        message: 'Your secure payment session is still being prepared. Refresh shortly.'
      });
    }

    const [providerOrder, providerPayments] = await Promise.all([
      cashfree.getOrder(orderId),
      cashfree.getPaymentsForOrder(orderId)
    ]);
    if (
      String(providerOrder.order_id || '') !== orderId ||
      String(providerOrder.cf_order_id || '') !== String(localOrder.cf_order_id) ||
      providerOrder.order_currency !== 'INR' ||
      !amountMatches(providerOrder.order_amount, plan.amountInr)
    ) {
      return res.status(409).json({ ok: false, error: 'Cashfree order details do not match MILAN records.' });
    }
    if (!Array.isArray(providerPayments)) {
      throw routeError('Cashfree payment history response is invalid.', 'CASHFREE_PAYMENT_HISTORY_INVALID', 502);
    }

    const successfulPayments = providerPayments
      .filter(item =>
        String(item && item.order_id || '') === orderId &&
        item.payment_status === 'SUCCESS' &&
        item.cf_payment_id
      )
      .sort((a, b) => Date.parse(a.payment_time || 0) - Date.parse(b.payment_time || 0));

    let reviewRequired = false;
    for (const payment of successfulPayments) {
      if (payment.order_amount != null &&
          !amountMatches(payment.order_amount, providerOrder.order_amount)) {
        throw routeError('Cashfree payment attempt does not match the verified order amount.', 'CASHFREE_PAYMENT_AMOUNT_MISMATCH', 409);
      }
      const finalized = await finalizePayment({
        orderId,
        cfOrderId: String(localOrder.cf_order_id),
        payment,
        verifiedOrderAmount: providerOrder.order_amount,
        verifiedOrderCurrency: providerOrder.order_currency,
        eventType: 'PAYMENT_STATUS_POLL',
        payloadHash: cashfree.sha256(JSON.stringify(payment))
      });
      if (finalized && finalized.ok === true) continue;
      if (finalized && finalized.code === 'MULTIPLE_SUCCESSFUL_PAYMENTS') {
        reviewRequired = true;
        continue;
      }
      throw routeError(
        finalized && finalized.error || 'Successful Cashfree payment requires reconciliation.',
        finalized && finalized.code || 'CASHFREE_PAYMENT_RECONCILIATION_REQUIRED',
        Number(finalized && finalized.httpStatus) || 409
      );
    }

    const currentResult = await db.query(
      `SELECT status, paid_at FROM public.payment_orders
        WHERE order_id = $1 AND user_id = $2 AND gateway = 'cashfree'
        LIMIT 1`,
      [orderId, req.account.id]
    );
    const current = currentResult.rows[0];
    if (current && current.status === 'paid') {
      return res.json({
        ok: true, orderId, plan: localOrder.plan,
        amountInr: plan.amountInr, currency: 'INR', status: 'paid',
        paidAt: current.paid_at || null, paymentActionRequired: false,
        paymentReviewRequired: reviewRequired
      });
    }

    const latestPayment = providerPayments[0] || null;
    return res.json({
      ok: true,
      orderId,
      plan: localOrder.plan,
      amountInr: plan.amountInr,
      currency: 'INR',
      status: 'pending',
      paidAt: null,
      paymentActionRequired: String(providerOrder.order_status || '').toUpperCase() === 'ACTIVE',
      paymentSessionId: localOrder.provider_payment_session_id,
      latestPaymentStatus: latestPayment && latestPayment.payment_status || null,
      message: reviewRequired
        ? 'Payment received. A further successful attempt needs reconciliation; contact MILAN support.'
        : 'No successful payment has been confirmed yet.'
    });
  } catch (error) {
    console.error('[MILAN Cashfree] Status lookup failed:', error.code || error.message);
    const status = Number(error.httpStatus) || 503;
    return res.status(status >= 400 && status <= 599 ? status : 503).json({
      ok: false,
      code: error.code || 'CASHFREE_STATUS_UNAVAILABLE',
      error: 'Could not verify Cashfree payment status. Please retry shortly.'
    });
  }
});

module.exports = router;
