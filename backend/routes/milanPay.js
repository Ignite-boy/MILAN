'use strict';

const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
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

// The acquiring bank supplies the merchant category code (MCC). This is not a secret.
function merchantMcc() {
  const value = String(process.env.MILAN_PAY_MCC || '').trim();
  return /^\d{4}$/.test(value) ? value : '';
}

function validVpa(value) {
  return /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(value);
}

// The iOS shortcut remains off by default even when an MCC is present. Enable it only
// after the bank/acquirer has verified merchant onboarding and the real-device flow.
function googlePayIosEnabled() {
  return String(process.env.MILAN_PAY_GOOGLE_PAY_IOS_ENABLED || '').trim().toLowerCase() === 'true';
}

function googlePayIosAvailable(vpa) {
  return validVpa(vpa) && Boolean(merchantMcc()) && googlePayIosEnabled();
}

function makeOrderId(userId) {
  const user = String(userId || 'USER')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'USER';
  return `MLNPAY_${user}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function makeUpiUri(vpa, orderId, plan) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: merchantName(),
    tr: orderId,
    tn: 'MILAN Pay ' + plan.name + ' ' + orderId,
    am: plan.amountInr.toFixed(2),
    cu: 'INR'
  });
  const mcc = merchantMcc();
  if (mcc) params.set('mc', mcc);
  return 'upi://pay?' + params.toString();
}

function makeGooglePayIosUri(vpa, orderId, plan) {
  if (!googlePayIosAvailable(vpa)) return null;
  const mcc = merchantMcc();
  const params = new URLSearchParams({
    pa: vpa,
    pn: merchantName(),
    tr: orderId,
    tn: 'MILAN Pay ' + plan.name + ' ' + orderId,
    am: plan.amountInr.toFixed(2),
    cu: 'INR',
    mc: mcc
  });
  return 'gpay://upi/pay?' + params.toString();
}

async function makeQrDataUrl(upiUri) {
  return QRCode.toDataURL(upiUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#08111f', light: '#ffffff' }
  });
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const vpa = merchantVpa();
  const ready = validVpa(vpa);

  res.json({
    ok: true,
    brand: 'MILAN Pay',
    merchantName: merchantName(),
    merchantVpa: ready ? vpa : null,
    merchantMccConfigured: Boolean(merchantMcc()),
    googlePayIosAvailable: ready && googlePayIosAvailable(vpa),
    qrPaymentsAvailable: ready,
    // These flags describe app capability, not confirmation that the VPA has live
    // merchant collection privileges or that a transaction was settled.
    merchantVerificationStatus: ready ? 'configured-unverified' : 'not-configured',
    verificationMode: 'manual-bank-verification',
    automaticPaymentConfirmationAvailable: false,
    upiAvailable: ready,
    cardPaymentsAvailable: false,
    internationalPaymentsAvailable: false,
    status: ready ? 'upi-intent-awaiting-verification' : 'merchant-upi-not-configured',
    methods: ready ? ['UPI apps supported by the customer device'] : [],
    message: ready
      ? 'UPI intent and QR can be generated for the configured VPA. Verify merchant collection eligibility with your bank; settlement is not confirmed by this app.'
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

    const { data: activeRequest, error: activeRequestError } = await supabase
      .from('storage_upgrade_requests')
      .select('id')
      .eq('user_id', req.account.id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (activeRequestError) throw activeRequestError;
    if (activeRequest) {
      return res.status(409).json({
        ok: false,
        code: 'STORAGE_REQUEST_PENDING',
        error: 'Your existing storage request is awaiting payment verification.'
      });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];
    if (!plan) {
      return res.status(400).json({ ok: false, error: 'Invalid plan.' });
    }

    const { data: pendingOrders, error: pendingOrderError } = await supabase
      .from('payment_orders')
      .select('order_id,plan,amount_inr,status,gateway_reference')
      .eq('user_id', req.account.id)
      .eq('gateway', 'milanpay')
      .eq('status', 'pending')
      .limit(2);

    if (pendingOrderError) throw pendingOrderError;
    const existingPendingOrders = Array.isArray(pendingOrders) ? pendingOrders : [];
    if (existingPendingOrders.length > 1) {
      return res.status(409).json({
        ok: false,
        code: 'MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED',
        error: 'Multiple pending MILAN Pay orders exist for your account. For your safety, no payment link will be issued until support reconciles the orders against bank records.'
      });
    }
    const pendingOrder = existingPendingOrders[0] || null;
    if (pendingOrder) {
      if (pendingOrder.plan !== planKey || Number(pendingOrder.amount_inr) !== plan.amountInr) {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_EXISTS',
          error: 'You already have a pending MILAN Pay order for a different plan. Resume or resolve that order first.'
        });
      }
      if (pendingOrder.gateway_reference && !validVpa(pendingOrder.gateway_reference)) {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_INVALID',
          error: 'The recipient saved for this pending order is invalid. Contact support; do not pay this order.'
        });
      }
      // Legacy rows without a pinned recipient must be reconciled. Never attach the
      // current environment VPA to an order that may have been created for another recipient.
      if (!pendingOrder.gateway_reference) {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED',
          error: 'This older pending order has no saved recipient. For your safety, no payment link will be issued until support reconciles the order and bank records.'
        });
      }
      const orderVpa = pendingOrder.gateway_reference;
      const upiUri = makeUpiUri(orderVpa, pendingOrder.order_id, plan);
      const qrDataUrl = await makeQrDataUrl(upiUri);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        ok: true,
        brand: 'MILAN Pay',
        orderId: pendingOrder.order_id,
        amountInr: plan.amountInr,
        currency: 'INR',
        plan: planKey,
        status: 'pending',
        reusedOrder: true,
        merchantName: merchantName(),
        merchantVpa: orderVpa,
        upiUri,
        googlePayIosUri: makeGooglePayIosUri(orderVpa, pendingOrder.order_id, plan),
        qrDataUrl,
        message: 'Resuming your existing pending order. Complete payment in your UPI app and submit the UTR; storage remains pending until independent bank verification.'
      });
    }

    const orderId = makeOrderId(req.account.id);
    const upiUri = makeUpiUri(vpa, orderId, plan);
    const qrDataUrl = await makeQrDataUrl(upiUri);
    const { error } = await supabase.from('payment_orders').insert({
      user_id: req.account.id,
      order_id: orderId,
      plan: planKey,
      amount_inr: plan.amountInr,
      status: 'pending',
      gateway: 'milanpay',
      // While pending, pin the exact merchant VPA used in the payment intent.
      // The approval RPC replaces this field with the verified UTR once paid.
      gateway_reference: vpa
    });

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_EXISTS',
          error: 'A pending order was created at the same time. Retry once to resume the existing order.'
        });
      }
      console.error('[MILAN Pay] Order insert failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'Could not create payment order.'
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      ok: true,
      brand: 'MILAN Pay',
      orderId,
      amountInr: plan.amountInr,
      currency: 'INR',
      plan: planKey,
      status: 'pending',
      reusedOrder: false,
      merchantName: merchantName(),
      merchantVpa: vpa,
      upiUri,
      googlePayIosUri: makeGooglePayIosUri(vpa, orderId, plan),
      qrDataUrl,
      message: 'Complete payment in your UPI app, then submit the UTR. Storage is upgraded only after independent bank verification.'
    });
  } catch (error) {
    console.error('[MILAN Pay] Order creation failed:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Could not create payment order.'
    });
  }
});

router.get('/orders/:orderId/status', auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'Invalid order ID.' });
    }

    const { data, error } = await supabase
      .from('payment_orders')
      .select('order_id,status,amount_inr,plan,gateway,gateway_reference,paid_at')
      .eq('order_id', orderId)
      .eq('user_id', req.account.id)
      .eq('gateway', 'milanpay')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: 'Order not found.' });

    const plan = PLANS[data.plan];
    if (!plan || Number(data.amount_inr) !== plan.amountInr) {
      return res.status(409).json({ ok: false, error: 'Stored order plan or amount is invalid.' });
    }

    let paymentDetails = {};
    if (data.status === 'pending') {
      // A submitted verification request means this order is awaiting review, not another payment.
      const { data: linkedRequest, error: linkedRequestError } = await supabase
        .from('storage_upgrade_requests')
        .select('id,status')
        .eq('order_id', data.order_id)
        .limit(1)
        .maybeSingle();
      if (linkedRequestError) throw linkedRequestError;
      if (linkedRequest) {
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          ok: true,
          orderId: data.order_id,
          status: data.status,
          amountInr: data.amount_inr,
          plan: data.plan,
          paidAt: data.paid_at || null,
          paymentActionRequired: false,
          verificationPending: linkedRequest.status === 'pending',
          requestStatus: linkedRequest.status,
          message: linkedRequest.status === 'pending'
            ? 'A verification request is already linked to this order. Do not pay again; wait for bank-record review.'
            : 'A verification request is already linked to this order. Do not pay again; contact support if you need help.'
        });
      }

      // Never issue or restore a payment intent when account-level duplicates exist.
      const { data: activeOrders, error: activeOrdersError } = await supabase
        .from('payment_orders')
        .select('order_id')
        .eq('user_id', req.account.id)
        .eq('gateway', 'milanpay')
        .eq('status', 'pending')
        .limit(2);
      if (activeOrdersError) throw activeOrdersError;
      if (Array.isArray(activeOrders) && activeOrders.length > 1) {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED',
          error: 'Multiple pending MILAN Pay orders exist for your account. No payment link will be shown until support reconciles the orders against bank records.'
        });
      }

      if (data.gateway_reference && !validVpa(data.gateway_reference)) {
        return res.status(409).json({ ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_INVALID', error: 'The saved recipient for this pending order is invalid. Do not pay; contact support.' });
      }
      // A pending legacy order with no saved recipient cannot safely inherit today's
      // environment setting: the merchant VPA may have changed since order creation.
      if (!data.gateway_reference) {
        return res.status(409).json({
          ok: false,
          code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED',
          error: 'This older pending order has no saved recipient. For your safety, no payment link will be issued until support reconciles the order and bank records.'
        });
      }
      const vpa = data.gateway_reference;
      const upiUri = makeUpiUri(vpa, data.order_id, plan);
      const qrDataUrl = await makeQrDataUrl(upiUri);
      paymentDetails = {
        merchantName: merchantName(),
        merchantVpa: vpa,
        upiUri,
        googlePayIosUri: makeGooglePayIosUri(vpa, data.order_id, plan),
        qrDataUrl
      };
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      orderId: data.order_id,
      status: data.status,
      amountInr: data.amount_inr,
      plan: data.plan,
      paidAt: data.paid_at || null,
      ...paymentDetails
    });
  } catch (error) {
    console.error('[MILAN Pay] Status lookup failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not check order status.' });
  }
});

module.exports = router;
