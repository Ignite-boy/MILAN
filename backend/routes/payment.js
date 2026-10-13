'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const { sendPaymentSuccessEmail } = require('../services/mailService');
const PaytmChecksum = require('paytmchecksum');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BASE_URL = String(
  process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL ||
  process.env.SEO_CANONICAL_URL || 'https://milanlife.in'
).replace(/\/+$/, '');

const PAYTM_ENVIRONMENT =
  String(process.env.PAYTM_ENVIRONMENT || 'staging').trim().toLowerCase() === 'production'
    ? 'production'
    : 'staging';
const PAYTM_PG_DOMAIN = PAYTM_ENVIRONMENT === 'production'
  ? 'https://secure.paytmpayments.com'
  : 'https://securestage.paytmpayments.com';

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

function merchantMid() {
  return String(process.env.PAYTM_MID || '').trim();
}
function merchantKey() {
  return String(process.env.PAYTM_MERCHANT_KEY || '').trim();
}
function websiteName() {
  return String(process.env.PAYTM_WEBSITE_NAME ||
    (PAYTM_ENVIRONMENT === 'production' ? 'DEFAULT' : 'WEBSTAGING')).trim();
}
function configured() {
  return Boolean(merchantMid() && merchantKey());
}
function requireConfigured() {
  if (!configured()) {
    const error = new Error('Paytm Business payment credentials are not configured.');
    error.status = 503;
    error.code = 'PAYTM_NOT_CONFIGURED';
    throw error;
  }
}
function checkoutJsUrl() {
  return merchantMid()
    ? PAYTM_PG_DOMAIN + '/merchantpgpui/checkoutjs/merchants/' +
      encodeURIComponent(merchantMid()) + '.js'
    : '';
}
function callbackUrl() {
  const value = String(process.env.PAYTM_CALLBACK_URL ||
    (BASE_URL + '/api/payment/callback')).trim();
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('PAYTM_CALLBACK_URL must be a publicly reachable HTTPS URL.');
  }
  return url.toString();
}
function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
function amountPaise(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}
function createOrderId(userId) {
  const owner = String(userId || 'USER').slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '') || 'USER';
  return 'MLN_' + owner + '_' + Date.now().toString(36) + '_' +
    crypto.randomBytes(8).toString('hex');
}
function paymentError(message, status, code) {
  const error = new Error(message);
  error.status = status || 502;
  error.code = code || 'PAYTM_REQUEST_FAILED';
  return error;
}
function publicPaymentError(error) {
  if (error?.code === 'PAYTM_NOT_CONFIGURED') {
    return {
      status: 503,
      message: 'Paytm Business is not configured. Set PAYTM_MID and PAYTM_MERCHANT_KEY in the server environment.'
    };
  }
  if (Number(error?.status) === 401 || Number(error?.status) === 403) {
    return {
      status: 502,
      message: 'Paytm rejected the merchant credentials or environment. Check the Paytm Business API details and environment.'
    };
  }
  if (/fetch failed|network|timeout|socket|aborted/i.test(String(error?.message || ''))) {
    return { status: 502, message: 'MILAN could not reach Paytm. Please retry shortly.' };
  }
  if (error?.code === 'PAYTM_RESPONSE_SIGNATURE_INVALID') {
    return { status: 502, message: 'Paytm response verification failed. No storage upgrade was applied.' };
  }
  return { status: 502, message: 'Paytm could not complete this payment request. Please retry with a new order.' };
}

async function postPaytm(endpoint, body) {
  requireConfigured();
  // Sign the exact JSON representation of Paytm's inner body.
  const bodyJson = JSON.stringify(body);
  const signature = await PaytmChecksum.generateSignature(bodyJson, merchantKey());
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, head: { signature } }),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw paymentError('Paytm returned an invalid response.', response.status || 502, 'PAYTM_INVALID_RESPONSE');
  }
  if (!response.ok) {
    throw paymentError('Paytm request failed.', response.status, 'PAYTM_HTTP_ERROR');
  }

  const responseBody = payload?.body;
  const responseSignature = payload?.head?.signature;
  if (!responseBody || !responseSignature) {
    throw paymentError('Paytm response signature is missing.', 502, 'PAYTM_RESPONSE_SIGNATURE_MISSING');
  }
  let signatureValid = false;
  try {
    signatureValid = await PaytmChecksum.verifySignature(
      JSON.stringify(responseBody), merchantKey(), responseSignature
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw paymentError('Paytm response checksum validation failed.', 502, 'PAYTM_RESPONSE_SIGNATURE_INVALID');
  }
  return payload;
}

async function initiatePaytmTransaction({ orderId, plan, account, customerPhone }) {
  const amount = Number(plan.amountInr);
  if (!Number.isFinite(amount) || amount <= 0 || amountPaise(amount) === null) {
    throw paymentError('The configured plan amount is invalid.', 500, 'INVALID_PLAN_AMOUNT');
  }
  const body = {
    requestType: 'Payment',
    mid: merchantMid(),
    websiteName: websiteName(),
    orderId,
    callbackUrl: callbackUrl(),
    txnAmount: { value: amount.toFixed(2), currency: 'INR' },
    userInfo: {
      custId: String(account.id),
      mobile: customerPhone,
      ...(account.email ? { email: String(account.email).slice(0, 100) } : {})
    }
  };
  const endpoint = new URL(PAYTM_PG_DOMAIN + '/theia/api/v1/initiateTransaction');
  endpoint.searchParams.set('mid', merchantMid());
  endpoint.searchParams.set('orderId', orderId);
  const result = await postPaytm(endpoint.toString(), body);
  const info = result.body?.resultInfo || {};
  if (String(info.resultStatus || '').toUpperCase() !== 'S') {
    throw paymentError('Paytm could not create a transaction token.', 502, 'PAYTM_INITIATE_FAILED');
  }
  const txnToken = String(result.body?.txnToken || '');
  if (!txnToken) throw paymentError('Paytm did not return a transaction token.', 502, 'PAYTM_TOKEN_MISSING');
  return {
    orderId,
    txnToken,
    amount: body.txnAmount.value,
    mid: merchantMid(),
    environment: PAYTM_ENVIRONMENT
  };
}

async function queryPaytmStatus(orderId) {
  const body = { mid: merchantMid(), orderId };
  const payload = await postPaytm(PAYTM_PG_DOMAIN + '/v3/order/status', body);
  const result = payload.body || {};
  if (String(result.orderId || result.ORDERID || '') !== orderId ||
      String(result.mid || result.MID || '') !== merchantMid()) {
    throw paymentError('Paytm transaction identity did not match this order.', 502, 'PAYTM_STATUS_IDENTITY_MISMATCH');
  }
  return result;
}

async function findOrder(orderId, userId) {
  let query = supabase.from('payment_orders').select('*').eq('order_id', orderId).limit(1);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function markPaytmOrderFailed(orderId, reference) {
  const { error } = await supabase.from('payment_orders').update({
    status: 'failed',
    gateway: 'paytm',
    gateway_reference: reference || null
  }).eq('order_id', orderId).eq('gateway', 'paytm').eq('status', 'pending');
  if (error) throw error;
}

async function activatePaidOrder({ orderId, paymentId, amountInr }) {
  const order = await findOrder(orderId);
  if (!order) return { ok: false, status: 404, error: 'Payment order not found.' };
  if (order.status === 'paid') return { ok: true, alreadyPaid: true, order };
  if (order.gateway !== 'paytm') {
    return { ok: false, status: 409, error: 'This order was not created through Paytm. Start a new payment.' };
  }
  if (order.status !== 'pending') {
    return { ok: false, status: 409, error: 'Payment order is no longer pending.' };
  }

  const plan = PLANS[order.plan];
  if (!plan) return { ok: false, status: 400, error: 'Invalid stored plan.' };

  const expectedPaise = amountPaise(order.amount_inr);
  const actualPaise = amountPaise(amountInr);
  if (expectedPaise === null || actualPaise === null || expectedPaise !== actualPaise) {
    return { ok: false, status: 409, error: 'Payment amount did not match the stored order.' };
  }

  const { data: user, error: userLookupError } = await supabase
    .from('users')
    .select('id,email,name,dwn_quota_bytes,storage_plan')
    .eq('id', order.user_id)
    .maybeSingle();
  if (userLookupError) throw userLookupError;
  if (!user) return { ok: false, status: 404, error: 'Account not found.' };

  const currentQuota = Number(user.dwn_quota_bytes || 0);
  const currentPlan = PLANS[user.storage_plan];
  const nextQuota = Math.max(currentQuota, plan.quotaBytes);
  const nextPlan = currentPlan && currentPlan.rank > plan.rank ? user.storage_plan : order.plan;

  const { error: userUpdateError } = await supabase.from('users').update({
    dwn_quota_bytes: nextQuota,
    storage_plan: nextPlan
  }).eq('id', user.id);
  if (userUpdateError) throw userUpdateError;

  const paidAt = new Date().toISOString();
  const { data: paidOrder, error: orderUpdateError } = await supabase
    .from('payment_orders')
    .update({
      status: 'paid',
      gateway: 'paytm',
      gateway_reference: paymentId || null,
      paid_at: paidAt
    })
    .eq('order_id', orderId)
    .eq('gateway', 'paytm')
    .eq('status', 'pending')
    .select('id,order_id,status,gateway,gateway_reference,paid_at,plan,amount_inr')
    .maybeSingle();
  if (orderUpdateError) throw orderUpdateError;

  if (!paidOrder) {
    const latest = await findOrder(orderId);
    if (latest?.status === 'paid') {
      return { ok: true, alreadyPaid: true, order: latest, quotaBytes: nextQuota };
    }
    return { ok: false, status: 409, error: 'Payment order could not be finalized.' };
  }

  sendPaymentSuccessEmail({
    to: user.email,
    name: user.name || '',
    plan: plan.name,
    amount: order.amount_inr,
    orderId,
    reference: paymentId || 'paytm'
  }).catch(error => console.warn('[MILAN mail] payment success email error:', error.message));

  return { ok: true, order: paidOrder, quotaBytes: nextQuota };
}

async function reconcileOrder(order) {
  if (order.status === 'paid') {
    return { ok: true, status: 'paid', message: 'Payment already verified.' };
  }
  if (order.status === 'failed') {
    return { ok: true, status: 'failed', message: 'Payment was not completed. Start a new order to retry.' };
  }
  if (order.gateway !== 'paytm') {
    return { ok: false, status: 409, error: 'This order is not a Paytm order. Start a new payment.' };
  }
  if (order.status !== 'pending') {
    return { ok: false, status: 409, error: 'Payment order is no longer pending.' };
  }

  const result = await queryPaytmStatus(String(order.order_id));
  const info = result.resultInfo || {};
  const state = String(info.resultStatus || result.status || '').toUpperCase();
  const paymentId = String(result.txnId || result.txnID || result.transactionId || '');
  if (state === 'TXN_SUCCESS') {
    const reportedAmount = result.txnAmount ?? result.txnamount ?? null;
    if (amountPaise(order.amount_inr) === null ||
        amountPaise(reportedAmount) !== amountPaise(order.amount_inr)) {
      console.error('[payment] Paytm success amount mismatch', {
        orderId: order.order_id, amountPresent: reportedAmount !== null
      });
      return {
        ok: false, status: 409,
        error: 'Paytm reported success but the amount did not match the stored order. Contact support before retrying.'
      };
    }
    const activated = await activatePaidOrder({
      orderId: order.order_id, paymentId, amountInr: reportedAmount
    });
    if (!activated.ok) return activated;
    return {
      ok: true, status: 'paid',
      message: 'Payment verified and storage upgraded.',
      quotaBytes: activated.quotaBytes
    };
  }
  if (state === 'TXN_FAILURE') {
    await markPaytmOrderFailed(order.order_id, paymentId);
    return {
      ok: true, status: 'failed',
      message: 'Payment was not completed. Start a new order to retry.'
    };
  }
  return {
    ok: true, status: 'pending',
    message: 'Paytm is still processing this payment. Checking again shortly.'
  };
}

function callbackParams(input) {
  const params = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (['string', 'number', 'boolean'].includes(typeof value)) params[key] = String(value);
  }
  return params;
}
async function verifyCallback(input) {
  requireConfigured();
  const params = callbackParams(input);
  const checksum = String(params.CHECKSUMHASH || '');
  if (!checksum) return { ok: false, params: {} };
  delete params.CHECKSUMHASH;
  let valid = false;
  try {
    valid = await PaytmChecksum.verifySignature(params, merchantKey(), checksum);
  } catch {
    valid = false;
  }
  return { ok: valid, params };
}
function extractSignedWebhookBody(rawBody) {
  if (!rawBody) return null;
  const match = rawBody.match(/"body"\s*:\s*\{/);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < rawBody.length; index += 1) {
    const character = rawBody[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return rawBody.slice(start, index + 1);
    }
  }
  return null;
}
function returnUrl(orderId) {
  const url = new URL('/storage-upgrade.html', BASE_URL);
  url.searchParams.set('payment', 'return');
  url.searchParams.set('order_id', orderId);
  return url.toString();
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    configured: configured(),
    environment: PAYTM_ENVIRONMENT,
    mid: configured() ? merchantMid() : '',
    checkoutJsUrl: configured() ? checkoutJsUrl() : '',
    currency: 'INR',
    plans: {
      '500mb': { name: PLANS['500mb'].name, amountInr: PLANS['500mb'].amountInr, quotaBytes: PLANS['500mb'].quotaBytes },
      '1gb': { name: PLANS['1gb'].name, amountInr: PLANS['1gb'].amountInr, quotaBytes: PLANS['1gb'].quotaBytes }
    }
  });
});

// The amount and plan always come from this server, never from a browser-supplied price.
router.post('/create-order', auth, async (req, res) => {
  let orderId = '';
  let orderSaved = false;
  try {
    requireConfigured();
    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ error: 'Invalid storage plan.' });
    const customerPhone = normalizePhone(req.body?.customerPhone);
    if (!customerPhone) {
      return res.status(400).json({ error: 'A valid phone number is required for Paytm checkout.' });
    }

    orderId = createOrderId(req.account.id);
    const { error: insertError } = await supabase.from('payment_orders').insert({
      user_id: req.account.id,
      order_id: orderId,
      plan: planKey,
      amount_inr: plan.amountInr,
      status: 'pending',
      gateway: 'paytm'
    });
    if (insertError) {
      console.error('[payment] Paytm order insert failed:', insertError.message);
      return res.status(500).json({ error: 'Could not save the payment order.' });
    }
    orderSaved = true;

    const initiated = await initiatePaytmTransaction({
      orderId, plan, account: req.account, customerPhone
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      orderId: initiated.orderId,
      txnToken: initiated.txnToken,
      amount: initiated.amount,
      amountInr: plan.amountInr,
      plan: planKey,
      name: plan.name,
      currency: 'INR',
      mid: initiated.mid,
      environment: initiated.environment
    });
  } catch (error) {
    if (orderSaved && orderId) {
      try { await markPaytmOrderFailed(orderId, null); }
      catch (storeError) {
        console.error('[payment] could not mark Paytm initiation failed', {
          orderId, message: storeError.message
        });
      }
    }
    const publicError = publicPaymentError(error);
    console.error('[payment] Paytm order creation failed', {
      orderId: orderId || null,
      environment: PAYTM_ENVIRONMENT,
      code: error.code || null,
      status: Number(error.status) || null,
      message: String(error.message || 'Unknown Paytm error').slice(0, 180)
    });
    return res.status(publicError.status).json({
      error: publicError.message,
      code: 'paytm_order_creation_failed'
    });
  }
});

router.post('/verify', auth, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });
    const order = await findOrder(orderId, req.account.id);
    if (!order) return res.status(404).json({ error: 'Payment order not found.' });
    if (order.status === 'paid') {
      return res.json({ ok: true, status: 'paid', message: 'Payment already verified.' });
    }
    requireConfigured();
    const result = await reconcileOrder(order);
    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error || 'Payment verification failed.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json(result);
  } catch (error) {
    const publicError = publicPaymentError(error);
    console.error('[payment] Paytm verification failed', {
      code: error.code || null,
      status: Number(error.status) || null,
      message: String(error.message || 'Unknown Paytm error').slice(0, 180)
    });
    return res.status(error.status && error.status < 500 ? error.status : 502).json({
      error: error.code === 'PAYTM_NOT_CONFIGURED'
        ? publicError.message
        : 'Payment verification is temporarily unavailable. No storage upgrade was applied.'
    });
  }
});

router.get('/status', auth, async (req, res) => {
  try {
    const orderId = String(req.query?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });
    const order = await findOrder(orderId, req.account.id);
    if (!order) return res.status(404).json({ error: 'Payment order not found.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true, status: order.status, paidAt: order.paid_at || null,
      gateway: order.gateway || null, gatewayReference: order.gateway_reference || null
    });
  } catch (error) {
    console.error('[payment] status lookup failed:', error.message);
    return res.status(500).json({ error: 'Payment status lookup failed.' });
  }
});

async function handlePaytmCallback(req, res) {
  try {
    const verified = await verifyCallback(req.method === 'GET' ? req.query : req.body);
    if (!verified.ok) {
      return res.status(400).type('text/plain').send(
        'Payment response could not be validated. Return to MILAN and check the order status.'
      );
    }
    const params = verified.params;
    const orderId = String(params.ORDERID || '');
    if (!orderId || String(params.MID || '') !== merchantMid()) {
      return res.status(400).type('text/plain').send('Invalid Paytm payment response.');
    }

    const order = await findOrder(orderId);
    if (!order || order.gateway !== 'paytm') {
      return res.status(404).type('text/plain').send('Paytm order not found.');
    }
    if (params.TXNAMOUNT && amountPaise(params.TXNAMOUNT) !== amountPaise(order.amount_inr)) {
      console.warn('[payment] Paytm callback amount mismatch', { orderId });
    } else {
      try { await reconcileOrder(order); }
      catch (error) {
        console.error('[payment] callback reconciliation deferred', {
          orderId, code: error.code || null, message: String(error.message || '').slice(0, 160)
        });
      }
    }
    return res.redirect(303, returnUrl(orderId));
  } catch (error) {
    console.error('[payment] callback validation failed', {
      code: error.code || null, message: String(error.message || '').slice(0, 160)
    });
    return res.status(400).type('text/plain').send('Payment callback could not be validated.');
  }
}
router.post('/callback', handlePaytmCallback);
router.get('/callback', handlePaytmCallback);

router.post('/webhook', async (req, res) => {
  try {
    requireConfigured();
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
    const payload = req.body || {};
    const signature = String(payload?.head?.signature || '');
    const signedBody = extractSignedWebhookBody(rawBody);
    let signatureValid = false;
    try {
      signatureValid = Boolean(signature && signedBody &&
        await PaytmChecksum.verifySignature(signedBody, merchantKey(), signature));
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return res.status(401).json({ ok: false, error: 'Invalid Paytm webhook signature.' });
    }
    const event = payload.body || {};
    const eventType = String(event.txnType || 'SALE').toUpperCase();
    const orderId = String(event.orderId || '');
    if (String(event.mid || '') !== merchantMid()) {
      return res.status(401).json({ ok: false, error: 'Paytm merchant ID mismatch.' });
    }
    if (!orderId || (eventType !== 'SALE' && eventType !== 'QR_PAYMENT')) {
      return res.status(200).json({ ok: true, ignored: true });
    }
    const order = await findOrder(orderId);
    if (!order || order.gateway !== 'paytm') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const reconciled = await reconcileOrder(order);
    if (!reconciled.ok && Number(reconciled.status) >= 500) {
      return res.status(500).json({ ok: false, error: 'Payment reconciliation will be retried.' });
    }
    if (!reconciled.ok) {
      console.error('[payment] signed Paytm event did not reconcile', {
        orderId, eventStatus: String(event.status || ''), reason: reconciled.error || 'unknown'
      });
    }
    return res.status(200).json({ ok: true, processed: reconciled.ok, status: reconciled.status || null });
  } catch (error) {
    console.error('[payment] Paytm webhook processing failed', {
      orderId: String(req.body?.body?.orderId || ''),
      code: error.code || null, message: String(error.message || '').slice(0, 160)
    });
    return res.status(500).json({ ok: false, error: 'Paytm webhook processing failed; retry later.' });
  }
});

module.exports = router;
