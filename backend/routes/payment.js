
'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const { sendPaymentSuccessEmail } = require('../services/mailService');
const createDistributedApiRateLimiter = require('../middleware/distributedApiRateLimiter');

const router = express.Router();

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const createOrderRateLimiter = createDistributedApiRateLimiter({
  limit: 8, windowMs: 60_000, scope: 'cashfree-order-create', supabase
});
const verifyRateLimiter = createDistributedApiRateLimiter({
  limit: 20, windowMs: 60_000, scope: 'cashfree-payment-verify', supabase
});
const statusRateLimiter = createDistributedApiRateLimiter({
  limit: 60, windowMs: 60_000, scope: 'cashfree-payment-status', supabase
});

const VERCEL_PREVIEW_BASE_URL = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
  ? 'https://' + String(process.env.VERCEL_URL).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  : '';

const BASE_URL = String(
  VERCEL_PREVIEW_BASE_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_PUBLIC_URL ||
  process.env.SEO_CANONICAL_URL ||
  'https://milanlife.in'
).replace(/\/+$/, '');

const CASHFREE_ENVIRONMENT =
  String(process.env.CASHFREE_ENVIRONMENT || 'sandbox').trim().toLowerCase();

const CASHFREE_API_VERSION =
  String(process.env.CASHFREE_API_VERSION || '2025-01-01').trim();

const CASHFREE_BASE_URL =
  CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';

const PLANS = {
  '500mb': {
    name: '500 MB',
    amountInr: 250,
    quotaBytes: 524288000,
    rank: 1
  },
  '1gb': {
    name: '1 GB',
    amountInr: 500,
    quotaBytes: 1073741824,
    rank: 2
  }
};

function clientId() {
  return String(process.env.CASHFREE_CLIENT_ID || '').trim();
}

function clientSecret() {
  return String(process.env.CASHFREE_CLIENT_SECRET || '').trim();
}

function webhookSecret() {
  return clientSecret();
}

function configured() {
  const supportedEnvironment = CASHFREE_ENVIRONMENT === 'sandbox' || CASHFREE_ENVIRONMENT === 'production';
  const previewIsSandboxOnly = process.env.VERCEL_ENV !== 'preview' || CASHFREE_ENVIRONMENT === 'sandbox';
  return supportedEnvironment && previewIsSandboxOnly && Boolean(clientId() && clientSecret());
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function createOrderId(userId) {
  return 'MLN-' +
    String(userId).slice(0, 8) +
    '-' +
    Date.now().toString(36) +
    '-' +
    crypto.randomBytes(4).toString('hex');
}

async function cashfreeRequest(path, options = {}) {
  const response = await fetch(CASHFREE_BASE_URL + '/pg' + path, {
    ...options,
    // Bound upstream latency so a stalled gateway cannot hang the checkout request indefinitely.
    // If order creation times out, retain the pending row and reconcile it on the next attempt.
    signal: options.signal || AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-client-id': clientId(),
      'x-client-secret': clientSecret(),
      'x-api-version': CASHFREE_API_VERSION,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.code ||
      'Cashfree request failed.';
    const error = new Error(String(message));
    error.status = response.status;
    error.details = data;
    error.requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('x-cf-request-id') ||
      '';
    throw error;
  }

  return data;
}

async function findOrder(orderId, userId) {
  let query = supabase
    .from('payment_orders')
    .select('*')
    .eq('order_id', orderId)
    .limit(1);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getPayments(orderId) {
  return cashfreeRequest(
    '/orders/' + encodeURIComponent(orderId) + '/payments',
    { method: 'GET' }
  );
}

async function activatePaidOrder({ orderId, paymentId, amountInr }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedPaymentId = String(paymentId || '').trim();
  const verifiedAmount = Number(amountInr);

  if (!normalizedOrderId || !normalizedPaymentId ||
      !Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
    return { ok: false, status: 400, error: 'Invalid verified payment details.' };
  }

  const { data, error } = await supabase.rpc(
    'confirm_cashfree_storage_payment',
    {
      p_order_id: normalizedOrderId,
      p_payment_id: normalizedPaymentId,
      p_amount_inr: verifiedAmount
    }
  );

  if (error) {
    console.error('[payment] Atomic Cashfree confirmation failed:', error.message);
    throw new Error('Atomic payment confirmation failed.');
  }

  const result = data && typeof data === 'object' ? data : null;
  if (!result || result.ok !== true) {
    return {
      ok: false,
      status: Number.isInteger(result?.httpStatus) ? result.httpStatus : 500,
      error: String(result?.error || 'Payment could not be confirmed.')
    };
  }

  if (result.alreadyPaid === true) {
    return { ok: true, alreadyPaid: true, orderId: normalizedOrderId };
  }

  const order = await findOrder(normalizedOrderId);
  if (order) {
    const plan = PLANS[order.plan];
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email,name')
      .eq('id', order.user_id)
      .maybeSingle();

    if (userError) {
      console.warn('[MILAN mail] Could not load payment recipient:', userError.message);
    } else if (user?.email && plan) {
      sendPaymentSuccessEmail({
        to: user.email,
        name: user.name || '',
        plan: plan.name,
        amount: order.amount_inr,
        orderId: normalizedOrderId,
        reference: normalizedPaymentId
      }).catch(err => {
        console.warn('[MILAN mail] Payment success email error:', err.message);
      });
    }
  }

  return {
    ok: true,
    orderId: normalizedOrderId,
    paymentStatus: 'paid',
    quotaBytes: Number(result.quotaBytes) || undefined
  };
}

function verifyWebhookSignature(signature, timestamp, rawBody) {
  if (!webhookSecret() || !signature || !timestamp || !rawBody) return false;

  const payload = String(timestamp) + String(rawBody);

  const expected = crypto
    .createHmac('sha256', webhookSecret())
    .update(payload)
    .digest('base64');

  return safeEqual(expected, signature);
}

// Public checkout configuration.
// Secret keys are never returned.
router.get('/config', (_req, res) => {
  res.json({
    ok: true,
    configured: configured(),
    environment: CASHFREE_ENVIRONMENT,
    clientId: configured() ? clientId() : '',
    currency: 'INR',
    plans: {
      '500mb': {
        name: PLANS['500mb'].name,
        amountInr: PLANS['500mb'].amountInr,
        quotaBytes: PLANS['500mb'].quotaBytes
      },
      '1gb': {
        name: PLANS['1gb'].name,
        amountInr: PLANS['1gb'].amountInr,
        quotaBytes: PLANS['1gb'].quotaBytes
      }
    }
  });
});

// Server creates the Cashfree order.
// Browser is never allowed to choose the final amount.
router.post('/create-order', createOrderRateLimiter, auth, async (req, res) => {
  let orderId = '';
  try {
    if (!configured()) {
      return res.status(503).json({ error: 'Cashfree payments are not configured for this environment.' });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ error: 'Invalid plan.' });

    const customerPhone = normalizePhone(req.body?.customerPhone);
    if (!customerPhone) {
      return res.status(400).json({ error: 'A valid customer phone number is required for payment.' });
    }

    const { data: currentStorage, error: storageError } = await supabase
      .from('users')
      .select('dwn_quota_bytes')
      .eq('id', req.account.id)
      .maybeSingle();

    if (storageError) throw storageError;
    if (!currentStorage) {
      return res.status(404).json({ error: 'Account storage record was not found.' });
    }

    const currentQuotaBytes = Number(currentStorage.dwn_quota_bytes) > 0
      ? Number(currentStorage.dwn_quota_bytes)
      : 104857600;

    const { data: pendingOrders, error: pendingError } = await supabase
      .from('payment_orders')
      .select('order_id,plan,amount_inr,status,gateway')
      .eq('user_id', req.account.id)
      .eq('gateway', 'cashfree')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(2);

    if (pendingError) throw pendingError;

    if ((pendingOrders || []).length > 1) {
      return res.status(409).json({
        error: 'Several pending Cashfree orders need reconciliation. No new order was created.',
        code: 'cashfree_pending_orders_reconciliation_required'
      });
    }

    if ((pendingOrders || []).length === 1) {
      const existing = pendingOrders[0];
      const existingPlan = PLANS[existing.plan];
      if (!existingPlan || Number(existing.amount_inr) !== existingPlan.amountInr) {
        return res.status(409).json({
          error: 'The existing pending Cashfree order has invalid plan or amount data and needs reconciliation.',
          code: 'cashfree_pending_order_data_mismatch'
        });
      }

      try {
        const providerOrder = await cashfreeRequest(
          '/orders/' + encodeURIComponent(existing.order_id),
          { method: 'GET' }
        );

        if (String(providerOrder?.order_status || '').toUpperCase() === 'PAID') {
          // Recover the webhook-late case by verifying the provider's actual payment
          // record; never infer that money was collected from order status alone.
          const transactions = await getPayments(existing.order_id);
          const successPayment = (Array.isArray(transactions) ? transactions : []).find(payment =>
            String(payment.payment_status || '').toUpperCase() === 'SUCCESS' &&
            String(payment.cf_payment_id || '').trim() &&
            payment.payment_amount !== undefined &&
            payment.payment_amount !== null &&
            Number.isFinite(Number(payment.payment_amount)) &&
            Number(payment.payment_amount) > 0 &&
            String(payment.payment_currency || '').trim().toUpperCase() === 'INR'
          );

          if (successPayment) {
            const activation = await activatePaidOrder({
              orderId: existing.order_id,
              paymentId: String(successPayment.cf_payment_id).trim(),
              amountInr: Number(successPayment.payment_amount)
            });

            if (!activation.ok) {
              return res.status(activation.status || 409).json({
                error: activation.error || 'Cashfree payment recovery needs reconciliation.',
                code: 'cashfree_paid_order_recovery_failed'
              });
            }

            return res.json({
              ok: true,
              alreadyPaid: true,
              status: 'paid',
              orderId: existing.order_id,
              plan: existing.plan,
              name: existingPlan.name,
              amountInr: existingPlan.amountInr,
              currency: 'INR'
            });
          }
        }

        if (existing.plan !== planKey || Number(existing.amount_inr) !== plan.amountInr) {
          return res.status(409).json({
            error: 'A pending Cashfree order exists for a different plan. Complete or reconcile it before starting another checkout.',
            code: 'cashfree_pending_order_plan_mismatch'
          });
        }

        if (currentQuotaBytes >= plan.quotaBytes) {
          return res.status(409).json({
            error: 'Your account already has this storage capacity or more. An existing pending order needs reconciliation before any further payment.',
            code: 'cashfree_storage_already_available_pending_order'
          });
        }

        if (
          String(providerOrder?.order_status || '').toUpperCase() === 'ACTIVE' &&
          String(providerOrder?.order_currency || '').toUpperCase() === 'INR' &&
          Number(providerOrder?.order_amount) === existingPlan.amountInr &&
          typeof providerOrder?.payment_session_id === 'string' &&
          providerOrder.payment_session_id.trim()
        ) {
          return res.json({
            ok: true,
            resumed: true,
            orderId: existing.order_id,
            paymentSessionId: providerOrder.payment_session_id,
            paymentSessionIdAlias: providerOrder.payment_session_id,
            plan: existing.plan,
            name: existingPlan.name,
            amountInr: existingPlan.amountInr,
            currency: 'INR',
            environment: CASHFREE_ENVIRONMENT,
            clientId: clientId()
          });
        }
      } catch (resumeError) {
        console.warn('[payment] Existing Cashfree order could not be resumed:', {
          status: Number(resumeError.status || 0) || null
        });
      }

      return res.status(409).json({
        error: 'A pending Cashfree order exists but could not be safely resumed. Support must reconcile it; no duplicate order was created.',
        code: 'cashfree_pending_order_reconciliation_required'
      });
    }

    if (currentQuotaBytes >= plan.quotaBytes) {
      return res.status(409).json({
        error: 'Your account already has this storage capacity or more. No new payment order was created.',
        code: 'cashfree_storage_already_available'
      });
    }

    orderId = createOrderId(req.account.id);
    const { data: reservation, error: reservationError } = await supabase.rpc(
      'reserve_cashfree_storage_order',
      {
        p_user_id: String(req.account.id),
        p_order_id: orderId,
        p_plan: planKey,
        p_amount_inr: plan.amountInr
      }
    );

    if (reservationError) {
      console.error('[payment] Atomic Cashfree order reservation failed:', reservationError.message);
      return res.status(503).json({
        error: 'Cashfree order storage is not ready. No checkout was started.',
        code: 'cashfree_order_reservation_unavailable'
      });
    }

    if (!reservation || reservation.ok !== true) {
      return res.status(Number(reservation?.httpStatus) || 409).json({
        error: String(reservation?.error || 'The Cashfree order could not be reserved.'),
        code: String(reservation?.code || 'cashfree_order_reservation_rejected')
      });
    }

    let cashfreeOrder;
    try {
      cashfreeOrder = await cashfreeRequest('/orders', {
        method: 'POST',
        // Cashfree supports this header on order creation. Reuse the MILAN order ID
        // so a retried provider request cannot create a second Cashfree order.
        headers: { 'x-idempotency-key': orderId },
        body: JSON.stringify({
          order_amount: plan.amountInr,
          order_currency: 'INR',
          order_id: orderId,
          customer_details: {
            customer_id: String(req.account.id),
            customer_name: String(req.account.name || 'MILAN User').slice(0, 100),
            customer_email: String(req.account.email || '').slice(0, 100),
            customer_phone: customerPhone
          },
          order_meta: {
            return_url: BASE_URL + '/storage-upgrade-cashfree.html?plan=' + encodeURIComponent(planKey) + '&payment=return&order_id={order_id}',
            notify_url: BASE_URL + '/api/payment/webhook'
          },
          order_note: 'MILAN Storage Upgrade - ' + plan.name
        })
      });
    } catch (providerError) {
      // Definitive 4xx rejection means no usable checkout was issued. Network/5xx
      // errors remain pending because Cashfree may have accepted the request.
      if ([400, 401, 403, 422].includes(Number(providerError.status))) {
        const { error: updateError } = await supabase
          .from('payment_orders')
          .update({ status: 'failed' })
          .eq('order_id', orderId)
          .eq('gateway', 'cashfree')
          .eq('status', 'pending');
        if (updateError) console.error('[payment] Could not close rejected Cashfree order:', updateError.message);
      }
      throw providerError;
    }

    if (typeof cashfreeOrder?.payment_session_id !== 'string' || !cashfreeOrder.payment_session_id.trim()) {
      console.error('[payment] Cashfree create-order response omitted payment_session_id.');
      return res.status(502).json({
        error: 'Cashfree did not return a payment session. The order is retained for safe reconciliation.',
        code: 'cashfree_session_missing'
      });
    }

    return res.json({
      ok: true,
      orderId,
      paymentSessionId: cashfreeOrder.payment_session_id,
      paymentSessionIdAlias: cashfreeOrder.payment_session_id,
      plan: planKey,
      name: plan.name,
      amountInr: plan.amountInr,
      currency: 'INR',
      environment: CASHFREE_ENVIRONMENT,
      clientId: clientId()
    });
  } catch (err) {
    const providerStatus = Number(err.status || 0);
    console.error('[payment] Cashfree create-order failed:', {
      environment: CASHFREE_ENVIRONMENT,
      status: providerStatus || null,
      message: String(err.message || 'Unknown error').slice(0, 180),
      requestId: String(err.requestId || '').slice(0, 100) || null
    });

    return res.status(502).json({
      error: 'Could not safely create or resume the Cashfree checkout. Existing pending orders, if any, were retained for reconciliation.',
      code: 'cashfree_order_creation_failed',
      providerStatus: providerStatus || null
    });
  }
});

// Client callback only asks the server to inspect Cashfree's payment status.
// No client-supplied "paid" value is trusted.
router.post('/verify', verifyRateLimiter, auth, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({ error: 'Cashfree payments are not configured yet.' });
    }

    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });

    const order = await findOrder(orderId, req.account.id);
    if (!order) return res.status(404).json({ error: 'Payment order not found.' });
    if (order.gateway !== 'cashfree') {
      return res.status(409).json({ error: 'This order does not belong to Cashfree.' });
    }

    if (order.status === 'paid') {
      return res.json({ ok: true, status: 'paid', message: 'Payment already verified.' });
    }

    const payments = await getPayments(orderId);
    const transactions = Array.isArray(payments) ? payments : [];
    const successPayment = transactions.find(payment =>
      String(payment.payment_status || '').toUpperCase() === 'SUCCESS' &&
      String(payment.cf_payment_id || '').trim() &&
      payment.payment_amount !== undefined &&
      payment.payment_amount !== null &&
      Number.isFinite(Number(payment.payment_amount)) &&
      Number(payment.payment_amount) > 0 &&
      String(payment.payment_currency || '').trim().toUpperCase() === 'INR'
    );

    if (successPayment) {
      const result = await activatePaidOrder({
        orderId,
        paymentId: String(successPayment.cf_payment_id).trim(),
        amountInr: Number(successPayment.payment_amount)
      });
      if (!result.ok) {
        return res.status(result.status || 500).json({ error: result.error });
      }
      return res.json({
        ok: true,
        status: 'paid',
        message: 'Payment verified and storage upgraded.',
        quotaBytes: result.quotaBytes
      });
    }

    return res.json({
      ok: true,
      status: 'pending',
      message: 'No successful payment is confirmed yet. The order remains pending.'
    });
  } catch (err) {
    console.error('[payment] Cashfree verify failed:', err.message);
    return res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// Authenticated status endpoint for mobile/network recovery.
router.get('/status', statusRateLimiter, auth, async (req, res) => {
  try {
    const orderId = String(req.query?.orderId || '').trim();

    if (!orderId) {
      return res.status(400).json({
        error: 'Order ID required.'
      });
    }

    const order = await findOrder(orderId, req.account.id);

    if (!order) {
      return res.status(404).json({
        error: 'Payment order not found.'
      });
    }

    res.json({
      ok: true,
      status: order.status,
      paidAt: order.paid_at || null,
      gateway: order.gateway || null,
      gatewayReference: order.gateway_reference || null
    });
  } catch (err) {
    res.status(500).json({
      error: 'Payment status lookup failed.'
    });
  }
});

// Cashfree webhook.
// server.js must preserve req.rawBody before JSON parsing.
router.post('/webhook', async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({ error: 'Cashfree webhook is not configured for this environment.' });
    }

    const signature = String(req.headers['x-webhook-signature'] || '').trim();
    const timestamp = String(req.headers['x-webhook-timestamp'] || '').trim();
    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    if (!verifyWebhookSignature(signature, timestamp, rawBody)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid webhook payload.' });
    }

    const payment = event?.data?.payment || {};
    const orderEntity = event?.data?.order || {};
    const paymentStatus = String(payment?.payment_status || '').toUpperCase();
    const orderId = String(payment?.order_id || orderEntity?.order_id || '').trim();
    const paymentId = String(payment?.cf_payment_id || '').trim();

    if (!orderId) return res.json({ ok: true, ignored: true });

    // A signed "payment failed" event can describe one failed attempt while the
    // Cashfree order remains payable. Do not mark the order terminally failed.
    if (paymentStatus !== 'SUCCESS') {
      return res.json({ ok: true, ignored: true });
    }

    const webhookAmount = Number(payment?.payment_amount);
    const currency = String(payment?.payment_currency || '').trim().toUpperCase();
    if (
      !paymentId ||
      payment?.payment_amount === undefined ||
      payment?.payment_amount === null ||
      !Number.isFinite(webhookAmount) ||
      webhookAmount <= 0 ||
      currency !== 'INR'
    ) {
      return res.status(400).json({
        error: 'Webhook is missing a valid payment ID, amount, or currency.'
      });
    }

    const order = await findOrder(orderId);
    if (!order || order.gateway !== 'cashfree') {
      return res.status(409).json({ error: 'Webhook order is not a known Cashfree order.' });
    }

    const result = await activatePaidOrder({
      orderId,
      paymentId,
      amountInr: webhookAmount
    });
    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.json({ ok: true, processed: true });
  } catch (err) {
    console.error('[payment] Cashfree webhook failed:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

module.exports = router;
