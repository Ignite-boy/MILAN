'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const router = express.Router();

const PLANS = {
  '500mb': {
    name: '500 MB',
    amountInr: Number(process.env.PLAN_500_AMOUNT || 500),
    quotaBytes: 524288000
  },
  '1gb': {
    name: '1 GB',
    amountInr: Number(process.env.PLAN_1GB_AMOUNT || 1000),
    quotaBytes: 1073741824
  }
};

function createOrderId() {
  return 'MLN-' + Date.now();
}

router.post('/create-order', auth, async (req, res) => {
  try {
    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const customAmount = Number(req.body?.amount || plan.amountInr);

    if (!Number.isFinite(customAmount) || customAmount < 1) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }

    const orderId = createOrderId();

    const { error } = await supabase
      .from('payment_orders')
      .insert({
        user_id: req.account.id,
        order_id: orderId,
        plan: planKey,
        amount_inr: customAmount,
        status: 'pending'
      });

    if (error) throw error;

    const upiPayload = new URLSearchParams({
      pa: 'np7218468@okhdfcbank',
      pn: 'Nitesh Pandey',
      tr: orderId,
      tn: 'MILAN Stroage Upgrade',
      am: String(customAmount),
      cu: 'INR'
    }).toString();

    const qrDataUrl = await QRCode.toDataURL('upi://pay?' + upiPayload, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.json({
      success: true,
      orderId,
      plan: planKey,
      name: plan.name,
      amountInr: customAmount,
      status: 'pending',
      qrDataUrl
    });

  } catch (err) {
    res.status(500).json({
      error: 'Order creation failed'
    });
  }
});


router.post('/verify', auth, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const reference = String(req.body?.paymentReference || '').trim();

    if (!orderId || !reference) {
      return res.status(400).json({ error: 'Order and payment reference required' });
    }

    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('order_id', orderId)
      .eq('user_id', req.account.id)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return res.status(404).json({ error: 'Payment order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(409).json({ error: 'Order already processed' });
    }

    const plan = PLANS[order.plan];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid stored plan' });
    }

    const { error: userError } = await supabase
      .from('users')
      .update({
        dwn_quota_bytes: plan.quotaBytes,
        storage_plan: order.plan
      })
      .eq('id', req.account.id);

    if (userError) throw userError;

    const { error: updateError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        gateway_reference: reference,
        paid_at: new Date().toISOString()
      })
      .eq('order_id', orderId);

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Payment verified and storage upgraded'
    });

  } catch (err) {
    console.error('[payment] verify failed:', err.message);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

module.exports = router;
