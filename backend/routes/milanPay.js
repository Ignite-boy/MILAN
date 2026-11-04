'use strict';

const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const auth = require('../middleware/auth');
const db = require('../services/milanDb');
const createDistributedApiRateLimiter = require('../middleware/distributedApiRateLimiter');

const router = express.Router();

const createOrderRateLimiter = createDistributedApiRateLimiter({
  limit: 8, windowMs: 60_000, scope: 'milan-pay-order-create'
});
const orderStatusRateLimiter = createDistributedApiRateLimiter({
  limit: 60, windowMs: 60_000, scope: 'milan-pay-order-status'
});

const PLANS = {
  '500mb': { name: '500 MB Storage', amountInr: 250, quotaBytes: 524288000 },
  '1gb': { name: '1 GB Storage', amountInr: 500, quotaBytes: 1073741824 }
};

function merchantName() {
  return String(process.env.MILAN_PAY_MERCHANT_NAME || 'MILAN Pay').trim().slice(0, 70);
}

function merchantVpa() {
  return String(process.env.MILAN_PAY_UPI_ID || '').trim();
}

function merchantMcc() {
  const value = String(process.env.MILAN_PAY_MCC || '').trim();
  return /^\d{4}$/.test(value) ? value : '';
}

function validVpa(value) {
  return /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(value);
}

function googlePayIosEnabled() {
  return String(process.env.MILAN_PAY_GOOGLE_PAY_IOS_ENABLED || '').trim().toLowerCase() === 'true';
}

function googlePayIosAvailable(vpa) {
  return validVpa(vpa) && Boolean(merchantMcc()) && googlePayIosEnabled();
}

function makeOrderId(userId) {
  const user = String(userId || 'USER').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'USER';
  return `MLNPAY_${user}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function makeUpiUri(vpa, orderId, plan) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: merchantName(),
    tr: orderId,
    tn: `MILAN Pay ${plan.name} ${orderId}`,
    am: plan.amountInr.toFixed(2),
    cu: 'INR'
  });
  const mcc = merchantMcc();
  if (mcc) params.set('mc', mcc);
  return 'upi://pay?' + params.toString();
}

function makeGooglePayIosUri(vpa, orderId, plan) {
  if (!googlePayIosAvailable(vpa)) return null;
  return 'gpay://upi/pay?' + new URLSearchParams({
    pa: vpa,
    pn: merchantName(),
    tr: orderId,
    tn: `MILAN Pay ${plan.name} ${orderId}`,
    am: plan.amountInr.toFixed(2),
    cu: 'INR',
    mc: merchantMcc()
  }).toString();
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
    merchantVerificationStatus: ready ? 'configured-unverified' : 'not-configured',
    verificationMode: 'manual-bank-verification',
    automaticPaymentConfirmationAvailable: false,
    upiAvailable: ready,
    cardPaymentsAvailable: false,
    internationalPaymentsAvailable: false,
    status: ready ? 'upi-intent-awaiting-verification' : 'merchant-upi-not-configured',
    methods: ready ? ['UPI apps supported by the customer device'] : [],
    message: ready
      ? 'UPI intent and QR can be generated for the configured VPA. Bank settlement is not confirmed by this app.'
      : 'Configure MILAN_PAY_UPI_ID for the bank-linked merchant UPI ID.'
  });
});

router.post('/orders', createOrderRateLimiter, auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const vpa = merchantVpa();
    if (!validVpa(vpa)) {
      return res.status(503).json({
        ok: false, code: 'MILAN_PAY_NOT_CONFIGURED',
        error: 'MILAN Pay merchant UPI ID is not configured.'
      });
    }

    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ ok: false, error: 'Invalid plan.' });

    const currentQuotaBytes = Number(
      req.account.dwnQuotaBytes || req.account.dwn_quota_bytes || 1073741824
    );
    if (!Number.isSafeInteger(currentQuotaBytes) || currentQuotaBytes < 1) {
      return res.status(503).json({
        ok: false, code: 'STORAGE_QUOTA_UNAVAILABLE',
        error: 'Your current storage quota could not be verified. No payment order was created.'
      });
    }
    if (currentQuotaBytes >= plan.quotaBytes) {
      return res.status(409).json({
        ok: false, code: 'STORAGE_PLAN_NOT_AN_UPGRADE',
        error: 'Your account already has an equal or higher storage quota. No payment order was created.'
      });
    }

    const activeRequest = await db.query(
      `SELECT id
         FROM public.storage_upgrade_requests
        WHERE user_id = $1 AND status = 'pending'
        LIMIT 1`,
      [req.account.id]
    );

    if (activeRequest.rows.length) {
      return res.status(409).json({
        ok: false, code: 'STORAGE_REQUEST_PENDING',
        error: 'Your existing storage request is awaiting payment verification.'
      });
    }

    const pendingResult = await db.query(
      `SELECT order_id, plan, amount_inr, status, gateway_reference
         FROM public.payment_orders
        WHERE user_id = $1 AND gateway = 'milanpay' AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 2`,
      [req.account.id]
    );

    const existingPendingOrders = pendingResult.rows || [];
    if (existingPendingOrders.length > 1) {
      return res.status(409).json({
        ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED',
        error: 'Multiple pending MILAN Pay orders exist. Contact support for bank-record reconciliation.'
      });
    }

    const pendingOrder = existingPendingOrders[0] || null;
    if (pendingOrder) {
      if (pendingOrder.plan !== planKey || Number(pendingOrder.amount_inr) !== plan.amountInr) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_EXISTS',
          error: 'You already have a pending MILAN Pay order for a different plan.'
        });
      }

      const priorRequest = await db.query(
        `SELECT id, status
           FROM public.storage_upgrade_requests
          WHERE order_id = $1
          LIMIT 1`,
        [pendingOrder.order_id]
      );

      if (priorRequest.rows.length) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_ORDER_VERIFICATION_ALREADY_SUBMITTED',
          error: 'A verification request already exists for this order. Do not pay again; wait for bank-record review or contact support.'
        });
      }

      if (pendingOrder.gateway_reference && !validVpa(pendingOrder.gateway_reference)) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_INVALID',
          error: 'The saved recipient for this pending order is invalid. Contact support; do not pay this order.'
        });
      }

      if (!pendingOrder.gateway_reference) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED',
          error: 'This older pending order has no saved recipient. Contact support before paying.'
        });
      }

      const orderVpa = pendingOrder.gateway_reference;
      const upiUri = makeUpiUri(orderVpa, pendingOrder.order_id, plan);
      const qrDataUrl = await makeQrDataUrl(upiUri);

      return res.status(200).json({
        ok: true, brand: 'MILAN Pay',
        orderId: pendingOrder.order_id,
        amountInr: plan.amountInr, currency: 'INR',
        plan: planKey, status: 'pending', reusedOrder: true,
        merchantName: merchantName(), merchantVpa: orderVpa, upiUri,
        googlePayIosUri: makeGooglePayIosUri(orderVpa, pendingOrder.order_id, plan),
        qrDataUrl,
        message: 'Resuming your existing pending order. Submit the UTR after payment; storage remains unchanged until independent bank verification.'
      });
    }

    const orderId = makeOrderId(req.account.id);
    const upiUri = makeUpiUri(vpa, orderId, plan);
    const qrDataUrl = await makeQrDataUrl(upiUri);

    try {
      await db.query(
        `INSERT INTO public.payment_orders
           (user_id, order_id, plan, amount_inr, gateway, gateway_reference)
         VALUES ($1, $2, $3, $4, 'milanpay', $5)`,
        [req.account.id, orderId, planKey, plan.amountInr, vpa]
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_EXISTS',
          error: 'A pending order was created at the same time. Retry once to resume it.'
        });
      }
      throw error;
    }

    return res.status(201).json({
      ok: true, brand: 'MILAN Pay',
      orderId, amountInr: plan.amountInr, currency: 'INR',
      plan: planKey, status: 'pending', reusedOrder: false,
      merchantName: merchantName(), merchantVpa: vpa,
      upiUri, googlePayIosUri: makeGooglePayIosUri(vpa, orderId, plan),
      qrDataUrl,
      message: 'Complete payment in your UPI app, then submit the UTR. Storage is upgraded only after independent bank verification.'
    });
  } catch (error) {
    console.error('[MILAN Pay] Order creation failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not create payment order.' });
  }
});

router.get('/orders/:orderId/status', orderStatusRateLimiter, auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'Invalid order ID.' });
    }

    const result = await db.query(
      `SELECT order_id, status, amount_inr, plan, gateway, gateway_reference, paid_at
         FROM public.payment_orders
        WHERE order_id = $1 AND user_id = $2 AND gateway = 'milanpay'
        LIMIT 1`,
      [orderId, req.account.id]
    );

    const data = result.rows[0];
    if (!data) return res.status(404).json({ ok: false, error: 'Order not found.' });

    const plan = PLANS[data.plan];
    if (!plan || Number(data.amount_inr) !== plan.amountInr) {
      return res.status(409).json({ ok: false, error: 'Stored order plan or amount is invalid.' });
    }

    let paymentDetails = {};
    if (data.status === 'pending') {
      const linkedRequest = await db.query(
        `SELECT id, status
           FROM public.storage_upgrade_requests
          WHERE order_id = $1
          LIMIT 1`,
        [data.order_id]
      );

      if (linkedRequest.rows.length) {
        const request = linkedRequest.rows[0];
        return res.json({
          ok: true, orderId: data.order_id, status: data.status,
          amountInr: data.amount_inr, plan: data.plan,
          paidAt: data.paid_at || null,
          paymentActionRequired: false,
          verificationPending: request.status === 'pending',
          requestStatus: request.status,
          message: request.status === 'pending'
            ? 'A verification request is already linked to this order. Do not pay again; wait for bank-record review.'
            : 'A verification request is already linked to this order. Do not pay again; contact support if you need help.'
        });
      }

      const activeOrders = await db.query(
        `SELECT order_id
           FROM public.payment_orders
          WHERE user_id = $1 AND gateway = 'milanpay' AND status = 'pending'
          LIMIT 2`,
        [req.account.id]
      );

      if (activeOrders.rows.length > 1) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED',
          error: 'Multiple pending MILAN Pay orders exist. No payment link will be shown until support reconciles bank records.'
        });
      }

      if (data.gateway_reference && !validVpa(data.gateway_reference)) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_INVALID',
          error: 'The saved recipient for this pending order is invalid. Do not pay; contact support.'
        });
      }

      if (!data.gateway_reference) {
        return res.status(409).json({
          ok: false, code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED',
          error: 'This older pending order has no saved recipient. Contact support before paying.'
        });
      }

      const vpa = data.gateway_reference;
      const upiUri = makeUpiUri(vpa, data.order_id, plan);
      paymentDetails = {
        merchantName: merchantName(),
        merchantVpa: vpa,
        upiUri,
        googlePayIosUri: makeGooglePayIosUri(vpa, data.order_id, plan),
        qrDataUrl: await makeQrDataUrl(upiUri)
      };
    }

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
