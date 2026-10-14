'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLANS = {
  '500mb': { name: '500 MB Storage', amountInr: 250 },
  '1gb': { name: '1 GB Storage', amountInr: 500 }
};

function merchantName() {
  return String(process.env.MILAN_PAY_MERCHANT_NAME || 'MILAN Pay')
    .trim().slice(0, 70);
}

function merchantVpa() {
  return String(process.env.MILAN_PAY_UPI_ID || '').trim();
}

function validVpa(value) {
  return /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(value);
}

function makeOrderId(userId) {
  const user = String(userId || 'USER')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'USER';
  return `MLNPAY_${user}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const vpa = merchantVpa();
  const ready = validVpa(vpa);

  res.json({
    ok: true,
    brand: 'MILAN Pay',
    merchantName: merchantName(),
    upiAvailable: ready,
    cardPaymentsAvailable: false,
    internationalPaymentsAvailable: false,
    status: ready ? 'upi-intent-awaiting-verification' : 'merchant-upi-not-configured',
    methods: ready ? ['UPI apps supported by the customer device'] : [],
    message: ready
      ? 'UPI intent checkout is available. Payment verification and automatic settlement confirmation require an authorised bank/acquirer connection.'
      : 'Configure MILAN_PAY_UPI_ID for the bank-linked merchant UPI ID. Bank account number and IFSC alone do not enable UPI/card processing.'
  });
});

router.post('/orders', auth, async (req, res) => {
  try {
    const vpa = merchantVpa();
    if (!validVpa(vpa)) {
      return res.status(503).json({
        ok: false,
        code: 'MILAN_PAY_NOT_CONFIGURED',
        error: 'MILAN Pay merchant UPI ID is not configured.'
      });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];
    if (!plan) {
      return res.status(400).json({ ok: false, error: 'Invalid plan.' });
    }

    const orderId = makeOrderId(req.account.id);
    const { error } = await supabase.from('payment_orders').insert({
      user_id: req.account.id,
      order_id: orderId,
      plan: planKey,
      amount_inr: plan.amountInr,
      status: 'pending',
      gateway: 'milanpay'
    });

    if (error) {
      console.error('[MILAN Pay] Order insert failed:', error.message);
      return res.status(500).json({ ok: false, error: 'Could not create payment order.' });
    }

    const params = new URLSearchParams({
      pa: vpa,
      pn: merchantName(),
      tr: orderId,
      tn: `MILAN Pay ${plan.name} ${orderId}`,
      am: plan.amountInr.toFixed(2),
      cu: 'INR'
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      ok: true,
      brand: 'MILAN Pay',
      orderId,
      amountInr: plan.amountInr,
      currency: 'INR',
      status: 'pending',
      upiUri: `upi://pay?${params.toString()}`,
      message: 'Complete payment in your UPI app. This order stays pending until a trusted payment-verification connection confirms settlement.'
    });
  } catch (error) {
    console.error('[MILAN Pay] Order creation failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not create payment order.' });
  }
});

router.get('/orders/:orderId/status', auth, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'Invalid order ID.' });
    }

    const { data, error } = await supabase
      .from('payment_orders')
      .select('order_id,status,amount_inr,plan,gateway,paid_at')
      .eq('order_id', orderId)
      .eq('user_id', req.account.id)
      .eq('gateway', 'milanpay')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: 'Order not found.' });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      orderId: data.order_id,
      status: data.status,
      amountInr: data.amount_inr,
      plan: data.plan,
      paidAt: data.paid_at || null
    });
  } catch (error) {
    console.error('[MILAN Pay] Status lookup failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not check order status.' });
  }
});

module.exports = router;
