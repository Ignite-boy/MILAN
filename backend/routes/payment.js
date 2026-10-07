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

const PLANS = {
  '500mb': {
    name: '500 MB',
    amountInr: Number(process.env.PLAN_500_AMOUNT || 250),
    quotaBytes: 524288000
  },
  '1gb': {
    name: '1 GB',
    amountInr: Number(process.env.PLAN_1GB_AMOUNT || 500),
    quotaBytes: 1073741824
  }
};

function keyId() {
  return String(process.env.RAZORPAY_KEY_ID || '').trim();
}

function keySecret() {
  return String(process.env.RAZORPAY_KEY_SECRET || '').trim();
}

function webhookSecret() {
  return String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
}

function configured() {
  return Boolean(keyId() && keySecret());
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function razorpayRequest(path, options = {}) {
  const basic = Buffer.from(keyId() + ':' + keySecret()).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + basic,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.description || 'Razorpay request failed.';
    const err = new Error(message);
    err.status = response.status;
    throw err;
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

async function activatePaidOrder({ orderId, paymentId, amountPaise }) {
  const order = await findOrder(orderId);
  if (!order) {
    return { ok: false, status: 404, error: 'Payment order not found.' };
  }

  if (order.status === 'paid') {
    return { ok: true, alreadyPaid: true, order };
  }

  if (order.status !== 'pending') {
    return { ok: false, status: 409, error: 'Payment order is not pending.' };
  }

  const plan = PLANS[order.plan];
  if (!plan) {
    return { ok: false, status: 400, error: 'Invalid stored plan.' };
  }

  const expectedPaise = Math.round(Number(order.amount_inr) * 100);
  if (!Number.isFinite(expectedPaise) || expectedPaise !== Number(amountPaise)) {
    return { ok: false, status: 400, error: 'Payment amount mismatch.' };
  }

  const { data: user, error: userLookupError } = await supabase
    .from('users')
    .select('id,email,name,dwn_quota_bytes')
    .eq('id', order.user_id)
    .maybeSingle();

  if (userLookupError) throw userLookupError;
  if (!user) {
    return { ok: false, status: 404, error: 'Account not found.' };
  }

  // Never downgrade an account that already has a larger quota.
  const currentQuota = Number(user.dwn_quota_bytes || 0);
  const nextQuota = Math.max(currentQuota, plan.quotaBytes);

  const { error: userUpdateError } = await supabase
    .from('users')
    .update({
      dwn_quota_bytes: nextQuota,
      storage_plan: order.plan
    })
    .eq('id', user.id);

  if (userUpdateError) throw userUpdateError;

  const paidAt = new Date().toISOString();
  const { error: orderUpdateError } = await supabase
    .from('payment_orders')
    .update({
      status: 'paid',
      gateway: 'razorpay',
      gateway_reference: paymentId,
      paid_at: paidAt
    })
    .eq('order_id', orderId)
    .eq('status', 'pending');

  if (orderUpdateError) throw orderUpdateError;

  sendPaymentSuccessEmail({
    to: user.email,
    name: user.name || '',
    plan: plan.name,
    amount: order.amount_inr,
    orderId,
    reference: paymentId
  }).catch(err => console.warn('[MILAN mail] payment success email error:', err.message));

  return {
    ok: true,
    order: { ...order, status: 'paid', gateway: 'razorpay', gateway_reference: paymentId, paid_at: paidAt },
    quotaBytes: nextQuota
  };
}

// Public checkout configuration. Never expose the API secret.
router.get('/config', (_req, res) => {
  res.json({
    ok: true,
    configured: configured(),
    keyId: configured() ? keyId() : '',
    currency: 'INR',
    plans: {
      '500mb': { name: PLANS['500mb'].name, amountInr: PLANS['500mb'].amountInr, quotaBytes: PLANS['500mb'].quotaBytes },
      '1gb': { name: PLANS['1gb'].name, amountInr: PLANS['1gb'].amountInr, quotaBytes: PLANS['1gb'].quotaBytes }
    }
  });
});

// Create the Razorpay order on the server. The browser sends only the plan;
// price is always taken from PLANS above.
router.post('/create-order', auth, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({ error: 'Payments are not configured yet.' });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const amountPaise = Math.round(Number(plan.amountInr) * 100);
    if (!Number.isInteger(amountPaise) || amountPaise < 100) {
      return res.status(500).json({ error: 'Invalid server payment amount.' });
    }

    const receipt = 'milan_' + String(req.account.id).slice(0, 12) + '_' + Date.now();

    const gatewayOrder = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes: {
          userId: req.account.id,
          email: req.account.email,
          plan: planKey
        }
      })
    });

    const { error: insertError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: req.account.id,
        order_id: gatewayOrder.id,
        plan: planKey,
        amount_inr: plan.amountInr,
        status: 'pending',
        gateway: 'razorpay'
      });

    if (insertError) {
      console.error('[payment] Supabase order insert failed:', insertError.message);
      return res.status(500).json({ error: 'Could not save the payment order.' });
    }

    res.json({
      ok: true,
      orderId: gatewayOrder.id,
      id: gatewayOrder.id,
      amount: gatewayOrder.amount,
      amountInr: plan.amountInr,
      currency: gatewayOrder.currency,
      keyId: keyId(),
      plan: planKey,
      name: plan.name,
      quotaBytes: plan.quotaBytes
    });
  } catch (err) {
    console.error('[payment] create-order failed:', err.message);
    res.status(502).json({ error: 'Could not create the payment order.' });
  }
});

// Server-side callback verification + live payment status check.
router.post('/verify', auth, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({ error: 'Payments are not configured yet.' });
    }

    const razorpayOrderId = String(req.body?.razorpay_order_id || '').trim();
    const razorpayPaymentId = String(req.body?.razorpay_payment_id || '').trim();
    const razorpaySignature = String(req.body?.razorpay_signature || '').trim();

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const order = await findOrder(razorpayOrderId, req.account.id);
    if (!order) {
      return res.status(404).json({ error: 'Payment order not found.' });
    }

    if (order.status === 'paid') {
      return res.json({ ok: true, status: 'paid', message: 'Payment already verified.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret())
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    if (!safeEqual(expectedSignature, razorpaySignature)) {
      return res.status(400).json({ error: 'Payment signature mismatch.' });
    }

    const payment = await razorpayRequest('/payments/' + encodeURIComponent(razorpayPaymentId), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (String(payment.order_id || '') !== razorpayOrderId) {
      return res.status(400).json({ error: 'Payment does not belong to this order.' });
    }

    const expectedPaise = Math.round(Number(order.amount_inr) * 100);
    if (Number(payment.amount) !== expectedPaise) {
      return res.status(400).json({ error: 'Payment amount mismatch.' });
    }

    let finalPayment = payment;

    if (payment.status === 'authorized') {
      finalPayment = await razorpayRequest('/payments/' + encodeURIComponent(razorpayPaymentId) + '/capture', {
        method: 'POST',
        body: JSON.stringify({
          amount: expectedPaise,
          currency: 'INR'
        })
      });
    }

    if (String(finalPayment.status || '') !== 'captured') {
      return res.status(409).json({ error: 'Payment has not been captured yet.' });
    }

    const result = await activatePaidOrder({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      amountPaise: Number(finalPayment.amount)
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      ok: true,
      status: 'paid',
      message: 'Payment verified and storage upgraded.',
      quotaBytes: result.quotaBytes
    });
  } catch (err) {
    console.error('[payment] verify failed:', err.message);
    res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// Authenticated order status, useful when a mobile network interrupts the callback.
router.get('/status', auth, async (req, res) => {
  try {
    const orderId = String(req.query?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });

    const order = await findOrder(orderId, req.account.id);
    if (!order) return res.status(404).json({ error: 'Payment order not found.' });

    res.json({
      ok: true,
      status: order.status,
      paidAt: order.paid_at || null,
      gatewayReference: order.gateway_reference || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Payment status lookup failed.' });
  }
});

// Razorpay webhook fallback. Signature is validated against the raw JSON body.
router.post('/webhook', async (req, res) => {
  try {
    if (!webhookSecret()) return res.status(503).json({ error: 'Webhook secret is not configured.' });

    const signature = String(req.headers['x-razorpay-signature'] || '').trim();
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const expected = crypto.createHmac('sha256', webhookSecret()).update(raw).digest('hex');

    if (!signature || !safeEqual(expected, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const event = JSON.parse(raw.toString('utf8'));
    const eventName = String(event.event || '');

    if (eventName === 'order.paid' || eventName === 'payment.captured') {
      const paymentEntity = event?.payload?.payment?.entity || {};
      const orderEntity = event?.payload?.order?.entity || {};
      const orderId = String(paymentEntity.order_id || orderEntity.id || '').trim();
      const paymentId = String(paymentEntity.id || '').trim();

      if (!orderId || !paymentId) return res.json({ ok: true, ignored: true });

      const result = await activatePaidOrder({
        orderId,
        paymentId,
        amountPaise: Number(paymentEntity.amount || orderEntity.amount || 0)
      });

      if (!result.ok && result.status !== 409) {
        return res.status(result.status || 500).json({ error: result.error });
      }

      return res.json({ ok: true, processed: true });
    }

    if (eventName === 'payment.failed') {
      const paymentEntity = event?.payload?.payment?.entity || {};
      const orderId = String(paymentEntity.order_id || '').trim();
      const paymentId = String(paymentEntity.id || '').trim();

      if (orderId) {
        await supabase
          .from('payment_orders')
          .update({
            status: 'failed',
            gateway: 'razorpay',
            gateway_reference: paymentId || null
          })
          .eq('order_id', orderId)
          .eq('status', 'pending');
      }

      return res.json({ ok: true, processed: true });
    }

    return res.json({ ok: true, ignored: true });
  } catch (err) {
    console.error('[payment] webhook failed:', err.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

module.exports = router;
