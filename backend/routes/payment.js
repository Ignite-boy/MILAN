
'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const { sendPaymentSuccessEmail } = require('../services/mailService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BASE_URL = String(
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
    amountInr: Number(process.env.PLAN_500_AMOUNT || 250),
    quotaBytes: 524288000,
    rank: 1
  },
  '1gb': {
    name: '1 GB',
    amountInr: Number(process.env.PLAN_1GB_AMOUNT || 500),
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
  return Boolean(clientId() && clientSecret());
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
  const order = await findOrder(orderId);

  if (!order) {
    return {
      ok: false,
      status: 404,
      error: 'Payment order not found.'
    };
  }

  if (order.status === 'paid') {
    return {
      ok: true,
      alreadyPaid: true,
      order
    };
  }

  if (order.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: 'Payment order is not pending.'
    };
  }

  const plan = PLANS[order.plan];

  if (!plan) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid stored plan.'
    };
  }

  const expectedAmount = Number(order.amount_inr);
  const actualAmount = Number(amountInr);

  if (
    !Number.isFinite(expectedAmount) ||
    !Number.isFinite(actualAmount) ||
    Math.abs(expectedAmount - actualAmount) > 0.001
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Payment amount mismatch.'
    };
  }

  const { data: user, error: userLookupError } = await supabase
    .from('users')
    .select('id,email,name,dwn_quota_bytes,storage_plan')
    .eq('id', order.user_id)
    .maybeSingle();

  if (userLookupError) throw userLookupError;

  if (!user) {
    return {
      ok: false,
      status: 404,
      error: 'Account not found.'
    };
  }

  const currentQuota = Number(user.dwn_quota_bytes || 0);
  const currentPlan = PLANS[user.storage_plan];

  const nextQuota = Math.max(currentQuota, plan.quotaBytes);
  const nextPlan =
    currentPlan && currentPlan.rank > plan.rank
      ? user.storage_plan
      : order.plan;

  const { error: userUpdateError } = await supabase
    .from('users')
    .update({
      dwn_quota_bytes: nextQuota,
      storage_plan: nextPlan
    })
    .eq('id', user.id);

  if (userUpdateError) throw userUpdateError;

  const paidAt = new Date().toISOString();

  const { data: paidOrder, error: orderUpdateError } = await supabase
    .from('payment_orders')
    .update({
      status: 'paid',
      gateway: 'cashfree',
      gateway_reference: paymentId || null,
      paid_at: paidAt
    })
    .eq('order_id', orderId)
    .eq('status', 'pending')
    .select('id,order_id,status,gateway,gateway_reference,paid_at,plan,amount_inr')
    .maybeSingle();

  if (orderUpdateError) throw orderUpdateError;

  if (!paidOrder) {
    const latest = await findOrder(orderId);

    if (latest?.status === 'paid') {
      return {
        ok: true,
        alreadyPaid: true,
        order: latest,
        quotaBytes: nextQuota
      };
    }

    return {
      ok: false,
      status: 409,
      error: 'Payment order could not be finalized.'
    };
  }

  sendPaymentSuccessEmail({
    to: user.email,
    name: user.name || '',
    plan: plan.name,
    amount: order.amount_inr,
    orderId,
    reference: paymentId || 'cashfree'
  }).catch(err => {
    console.warn(
      '[MILAN mail] payment success email error:',
      err.message
    );
  });

  return {
    ok: true,
    order: paidOrder,
    quotaBytes: nextQuota
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
router.post('/create-order', auth, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({
        error: 'Cashfree payments are not configured yet.'
      });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({
        error: 'Invalid plan.'
      });
    }

    const customerPhone = normalizePhone(req.body?.customerPhone);

    if (!customerPhone) {
      return res.status(400).json({
        error: 'A valid customer phone number is required for payment.'
      });
    }

    const orderId = createOrderId(req.account.id);

    const cashfreeOrder = await cashfreeRequest('/orders', {
      method: 'POST',
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
          return_url:
            BASE_URL +
            '/storage-upgrade.html?payment=return&order_id={order_id}',
          notify_url: BASE_URL + '/api/payment/webhook'
        },
        order_note: 'MILAN Storage Upgrade - ' + plan.name
      })
    });

    const { error: insertError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: req.account.id,
        order_id: orderId,
        plan: planKey,
        amount_inr: plan.amountInr,
        status: 'pending',
        gateway: 'cashfree'
      });

    if (insertError) {
      console.error(
        '[payment] Supabase order insert failed:',
        insertError.message
      );
      return res.status(500).json({
        error: 'Could not save the payment order.'
      });
    }

    res.json({
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
    const providerMessage = String(err.message || '').trim().slice(0, 240);
    const requestId = String(err.requestId || '').slice(0, 120);

    // Preserve the actionable gateway reason without ever returning request
    // headers, App IDs, secrets, or the raw provider payload to the browser.
    let publicMessage = 'Cashfree could not create the payment order.';
    if (providerStatus === 401 || providerStatus === 403) {
      publicMessage =
        'Cashfree rejected the configured credentials or environment. ' +
        'Check CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, and CASHFREE_ENVIRONMENT in Vercel.';
    } else if (providerStatus === 400) {
      publicMessage = providerMessage
        ? 'Cashfree rejected the order details: ' + providerMessage
        : 'Cashfree rejected the order details.';
    } else if (providerStatus === 429) {
      publicMessage = 'Cashfree is rate-limiting payment orders. Please retry shortly.';
    } else if (providerStatus >= 500) {
      publicMessage = 'Cashfree is temporarily unavailable. Please retry shortly.';
    } else if (providerMessage && /fetch failed|network|timeout|socket/i.test(providerMessage)) {
      publicMessage = 'MILAN could not reach Cashfree. Check the server network and retry.';
    }

    console.error('[payment] Cashfree create-order failed:', {
      environment: CASHFREE_ENVIRONMENT,
      status: providerStatus || null,
      message: providerMessage || 'Unknown provider error',
      requestId: requestId || null,
      code: err.details?.code || null
    });

    res.status(502).json({
      error: publicMessage,
      code: 'cashfree_order_creation_failed',
      providerStatus: providerStatus || null,
      requestId: requestId || null
    });
  }
});

// Client callback only asks the server to inspect Cashfree's payment status.
// No client-supplied "paid" value is trusted.
router.post('/verify', auth, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({
        error: 'Cashfree payments are not configured yet.'
      });
    }

    const orderId = String(req.body?.orderId || '').trim();

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

    if (order.status === 'paid') {
      return res.json({
        ok: true,
        status: 'paid',
        message: 'Payment already verified.'
      });
    }

    const payments = await getPayments(orderId);
    const transactions = Array.isArray(payments) ? payments : [];

    const successPayment = transactions.find(
      payment =>
        String(payment.payment_status || '').toUpperCase() === 'SUCCESS'
    );

    if (successPayment) {
      const result = await activatePaidOrder({
        orderId,
        paymentId: String(successPayment.cf_payment_id || ''),
        amountInr: Number(
          successPayment.payment_amount ??
          successPayment.payment_amount_paid ??
          order.amount_inr
        )
      });

      if (!result.ok) {
        return res.status(result.status || 500).json({
          error: result.error
        });
      }

      return res.json({
        ok: true,
        status: 'paid',
        message: 'Payment verified and storage upgraded.',
        quotaBytes: result.quotaBytes
      });
    }

    const pendingPayment = transactions.find(
      payment =>
        String(payment.payment_status || '').toUpperCase() === 'PENDING'
    );

    if (pendingPayment) {
      return res.json({
        ok: true,
        status: 'pending',
        message: 'Payment is still being processed.'
      });
    }

    return res.json({
      ok: true,
      status: 'failed',
      message: 'No successful payment was found for this order.'
    });
  } catch (err) {
    console.error('[payment] Cashfree verify failed:', err.message);
    res.status(500).json({
      error: 'Payment verification failed.'
    });
  }
});

// Authenticated status endpoint for mobile/network recovery.
router.get('/status', auth, async (req, res) => {
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
    const signature = String(
      req.headers['x-webhook-signature'] || ''
    ).trim();

    const timestamp = String(
      req.headers['x-webhook-timestamp'] || ''
    ).trim();

    const rawBody =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : '';

    if (!verifyWebhookSignature(signature, timestamp, rawBody)) {
      return res.status(400).json({
        error: 'Invalid webhook signature.'
      });
    }

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({
        error: 'Invalid webhook payload.'
      });
    }

    const payment = event?.data?.payment || {};
    const orderEntity = event?.data?.order || {};

    const eventType = String(event?.type || '').toUpperCase();
    const paymentStatus = String(
      payment?.payment_status || ''
    ).toUpperCase();

    const orderId = String(
      payment?.order_id ||
      orderEntity?.order_id ||
      ''
    ).trim();

    const paymentId = String(
      payment?.cf_payment_id || ''
    ).trim();

    if (!orderId) {
      return res.json({
        ok: true,
        ignored: true
      });
    }

    if (
      eventType.includes('SUCCESS') ||
      paymentStatus === 'SUCCESS'
    ) {
      const result = await activatePaidOrder({
        orderId,
        paymentId,
        amountInr: Number(
          payment?.payment_amount ??
          payment?.payment_amount_paid ??
          orderEntity?.order_amount ??
          0
        )
      });

      if (!result.ok && result.status !== 409) {
        return res.status(result.status || 500).json({
          error: result.error
        });
      }

      return res.json({
        ok: true,
        processed: true
      });
    }

    if (
      eventType.includes('FAILED') ||
      paymentStatus === 'FAILED'
    ) {
      await supabase
        .from('payment_orders')
        .update({
          status: 'failed',
          gateway: 'cashfree',
          gateway_reference: paymentId || null
        })
        .eq('order_id', orderId)
        .eq('status', 'pending');

      return res.json({
        ok: true,
        processed: true
      });
    }

    return res.json({
      ok: true,
      ignored: true
    });
  } catch (err) {
    console.error('[payment] Cashfree webhook failed:', err.message);
    res.status(500).json({
      error: 'Webhook processing failed.'
    });
  }
});

module.exports = router;
