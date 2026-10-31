'use strict';

const crypto = require('node:crypto');

class CashfreeError extends Error {
  constructor(message, code, httpStatus = 503) {
    super(message);
    this.name = 'CashfreeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function configuration() {
  const environment = String(process.env.CASHFREE_ENV || 'sandbox').trim().toLowerCase();
  const enabled = String(process.env.CASHFREE_ENABLED || '').trim().toLowerCase() === 'true';
  const appId = String(process.env.CASHFREE_APP_ID || '').trim();
  const secretKey = String(process.env.CASHFREE_SECRET_KEY || '').trim();
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();

  return {
    enabled,
    configured: Boolean(appId && secretKey),
    environment,
    appId,
    secretKey,
    apiVersion: String(process.env.CASHFREE_API_VERSION || '2026-01-01').trim(),
    apiBase: environment === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg',
    publicBaseUrl
  };
}

function requireConfiguration() {
  const config = configuration();

  if (!config.enabled) {
    throw new CashfreeError(
      'Cashfree payments are not enabled on this server.',
      'CASHFREE_DISABLED',
      503
    );
  }

  if (!config.configured) {
    throw new CashfreeError(
      'Cashfree API credentials are not configured.',
      'CASHFREE_CREDENTIALS_MISSING',
      503
    );
  }

  if (!['sandbox', 'production'].includes(config.environment)) {
    throw new CashfreeError(
      'Cashfree environment must be sandbox or production.',
      'CASHFREE_ENV_INVALID',
      503
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.apiVersion)) {
    throw new CashfreeError(
      'Cashfree API version is invalid.',
      'CASHFREE_API_VERSION_INVALID',
      503
    );
  }

  let base;
  try {
    base = new URL(config.publicBaseUrl);
  } catch (_) {
    throw new CashfreeError(
      'PUBLIC_BASE_URL must be configured before enabling Cashfree.',
      'CASHFREE_PUBLIC_URL_MISSING',
      503
    );
  }

  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '::1'].includes(base.hostname)
  ) {
    throw new CashfreeError(
      'Cashfree requires a valid public application URL.',
      'CASHFREE_PUBLIC_URL_INVALID',
      503
    );
  }

  return config;
}

function publicConfiguration() {
  const config = configuration();
  let ready = false;
  try {
    requireConfiguration();
    ready = true;
  } catch (_) {
    ready = false;
  }

  return {
    ok: true,
    provider: 'cashfree',
    enabled: ready,
    mode: config.environment,
    checkoutSdk: ready ? 'https://sdk.cashfree.com/js/v3/cashfree.js' : null,
    methods: ready ? 'provider-configured' : [],
    message: ready
      ? 'Secure Cashfree checkout is available.'
      : 'Cashfree checkout is being prepared or server configuration is incomplete.'
  };
}

async function request(method, path, { body, idempotencyKey } = {}) {
  const config = requireConfiguration();
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client-id': config.appId,
    'x-client-secret': config.secretKey,
    'x-api-version': config.apiVersion
  };

  if (idempotencyKey) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new CashfreeError(
        'Invalid Cashfree idempotency key.',
        'CASHFREE_IDEMPOTENCY_KEY_INVALID',
        400
      );
    }
    headers['x-idempotency-key'] = idempotencyKey;
  }

  let response;
  try {
    response = await fetch(config.apiBase + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const timeout = error && error.name === 'TimeoutError';
    throw new CashfreeError(
      timeout
        ? 'Cashfree did not respond in time. Retry using the same payment order.'
        : 'Could not reach Cashfree. Check the connection and retry the same payment order.',
      timeout ? 'CASHFREE_TIMEOUT' : 'CASHFREE_NETWORK_ERROR',
      503
    );
  }

  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new CashfreeError(
        'Cashfree returned an unreadable response.',
        'CASHFREE_INVALID_RESPONSE',
        502
      );
    }
  }

  if (!response.ok) {
    const code = String(data.code || data.type || '').slice(0, 80);
    throw new CashfreeError(
      'Cashfree rejected the request' + (code ? ` (${code})` : '') + '.',
      'CASHFREE_PROVIDER_ERROR',
      response.status >= 500 ? 502 : 409
    );
  }

  return data;
}

function normalizePhone(value) {
  const phone = String(value || '').trim();
  const digits = phone.replace(/[\s()+.-]/g, '');

  if (!/^\d{8,15}$/.test(digits)) {
    throw new CashfreeError(
      'Enter a valid mobile number with country code where applicable.',
      'CUSTOMER_PHONE_INVALID',
      400
    );
  }

  return digits;
}

function makeOrderPayload({
  orderId,
  userId,
  name,
  email,
  phone,
  amountInr
}) {
  const config = requireConfiguration();

  const customerId = String(userId || '').trim();
  const customerName = String(name || '').trim().slice(0, 100);
  const customerEmail = String(email || '').trim().toLowerCase();
  const customerPhone = normalizePhone(phone);

  if (!customerId || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
    throw new CashfreeError(
      'A valid MILAN account name and email are required for checkout.',
      'CUSTOMER_DETAILS_INVALID',
      400
    );
  }

  if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
    throw new CashfreeError(
      'Invalid MILAN payment order ID.',
      'MILAN_ORDER_ID_INVALID',
      400
    );
  }

  if (!Number.isSafeInteger(amountInr) || amountInr <= 0) {
    throw new CashfreeError(
      'Invalid MILAN payment amount.',
      'MILAN_ORDER_AMOUNT_INVALID',
      400
    );
  }

  const returnUrl = new URL('/milan-pay.html', config.publicBaseUrl);
  returnUrl.searchParams.set('cashfree_return', '1');
  returnUrl.searchParams.set('order_id', orderId);

  const notifyUrl = new URL('/api/milan-pay/webhook', config.publicBaseUrl);

  return {
    order_id: orderId,
    order_amount: amountInr,
    order_currency: 'INR',
    customer_details: {
      customer_id: customerId,
      customer_name: customerName || customerEmail.split('@')[0],
      customer_email: customerEmail,
      customer_phone: customerPhone
    },
    order_meta: {
      return_url: returnUrl.toString(),
      notify_url: notifyUrl.toString()
    },
    order_note: `MILAN storage upgrade ${orderId}`
  };
}

function createOrder(payload, idempotencyKey) {
  return request('POST', '/orders', {
    body: payload,
    idempotencyKey
  });
}

function getPaymentsForOrder(orderId) {
  return request(
    'GET',
    `/orders/${encodeURIComponent(String(orderId))}/payments`
  );
}

function getOrder(orderId) {
  return request(
    'GET',
    `/orders/${encodeURIComponent(String(orderId))}`
  );
}

function verifyWebhookSignature(signature, timestamp, rawBody) {
  const config = configuration();

  if (
    !config.configured ||
    typeof signature !== 'string' ||
    typeof timestamp !== 'string' ||
    !Buffer.isBuffer(rawBody) ||
    rawBody.length === 0 ||
    !/^\d{10,16}$/.test(timestamp) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
  ) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', config.secretKey)
    .update(timestamp + rawBody.toString('utf8'), 'utf8')
    .digest();

  let received;
  try {
    received = Buffer.from(signature, 'base64');
  } catch (_) {
    return false;
  }

  return received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  CashfreeError,
  configuration,
  publicConfiguration,
  requireConfiguration,
  normalizePhone,
  makeOrderPayload,
  createOrder,
  getOrder,
  getPaymentsForOrder,
  verifyWebhookSignature,
  sha256
};
