'use strict';

const crypto = require('crypto');

class CashfreeGatewayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CashfreeGatewayError';
    this.status = options.status || 502;
    this.code = options.code || 'CASHFREE_PROVIDER_ERROR';
    this.retryable = options.retryable === true;
    this.providerStatus = options.providerStatus || null;
  }
}

function settings() {
  const environment = String(process.env.CASHFREE_ENV || '').trim().toLowerCase();
  const enabled = String(process.env.CASHFREE_ENABLED || '').trim().toLowerCase() === 'true';
  const appId = String(process.env.CASHFREE_APP_ID || '').trim();
  const secretKey = String(process.env.CASHFREE_SECRET_KEY || '').trim();
  const apiVersion = String(process.env.CASHFREE_API_VERSION || '2026-01-01').trim();

  const validEnvironment = ['sandbox', 'production'].includes(environment);
  const validVersion = /^\d{4}-\d{2}-\d{2}$/.test(apiVersion);

  return {
    enabled,
    environment,
    appId,
    secretKey,
    apiVersion,
    configured: enabled && validEnvironment && Boolean(appId) &&
      Boolean(secretKey) && validVersion
  };
}

function publicConfig() {
  const config = settings();
  return {
    enabled: config.configured,
    environment: config.configured ? config.environment : null
  };
}

function requireConfig() {
  const config = settings();

  if (!config.enabled) {
    throw new CashfreeGatewayError('Cashfree checkout is disabled.', {
      status: 503,
      code: 'CASHFREE_DISABLED'
    });
  }

  if (!config.configured) {
    throw new CashfreeGatewayError('Cashfree provider configuration is incomplete.', {
      status: 503,
      code: 'CASHFREE_NOT_CONFIGURED'
    });
  }

  return config;
}

function baseUrl(environment) {
  return environment === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function safeDiagnosticValue(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\\r\\n\\t]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, maxLength) || null;
}

function logProviderRejection(response, payload, requestId) {
  // Log only Cashfree's error metadata; never log request headers, API keys,
  // payment-session IDs, customer details, or the raw provider response.
  const details = {
    requestId,
    providerStatus: response.status,
    providerType: safeDiagnosticValue(payload?.type || payload?.error_type, 80),
    providerCode: safeDiagnosticValue(
      payload?.code || payload?.error_code || payload?.errorCode,
      100
    ),
    providerMessage: safeDiagnosticValue(
      payload?.message || payload?.error_description || payload?.errorDescription,
      200
    )
  };

  console.error('[Cashfree] Provider API rejected request:', JSON.stringify(details));
}

async function request(method, resource, options = {}) {
  const config = requireConfig();

  if (typeof resource !== 'string' || !resource.startsWith('/')) {
    throw new CashfreeGatewayError('Invalid provider resource path.', {
      status: 500,
      code: 'CASHFREE_INVALID_RESOURCE'
    });
  }

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'x-client-id': config.appId,
    'x-client-secret': config.secretKey,
    'x-api-version': config.apiVersion,
    'x-request-id': crypto.randomUUID()
  };

  if (options.idempotencyKey) {
    headers['x-idempotency-key'] = options.idempotencyKey;
  }

  let response;

  try {
    response = await fetch(baseUrl(config.environment) + resource, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    });
  } catch (_) {
    throw new CashfreeGatewayError('Cashfree provider is temporarily unreachable.', {
      status: 503,
      code: 'CASHFREE_PROVIDER_UNAVAILABLE',
      retryable: true
    });
  }

  let payload;
  try {
    const raw = await response.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw new CashfreeGatewayError('Cashfree returned an invalid response.', {
      status: 502,
      code: 'CASHFREE_INVALID_RESPONSE',
      retryable: response.status >= 500
    });
  }

  if (!response.ok) {
    logProviderRejection(response, payload, headers['x-request-id']);
    const status = response.status === 409 ? 409 :
      response.status === 429 ? 503 :
      response.status >= 500 ? 503 : 502;

    throw new CashfreeGatewayError('Cashfree could not complete the requested operation.', {
      status,
      code: 'CASHFREE_PROVIDER_REJECTED',
      providerStatus: response.status,
      retryable: response.status === 429 || response.status >= 500
    });
  }

  return payload;
}

function verifyWebhookSignature(rawBody, timestamp, signature) {
  const config = requireConfig();
  // Cashfree signs webhooks with the PG API Secret Key.
  const webhookSecret = config.secretKey;

  if (!webhookSecret || !Buffer.isBuffer(rawBody) ||
      rawBody.length === 0 || rawBody.length > 1024 * 1024 ||
      typeof timestamp !== 'string' || !/^\d{10,20}$/.test(timestamp) ||
      typeof signature !== 'string' || signature.length > 256) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(timestamp, 'utf8')
    .update(rawBody)
    .digest();

  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64');
  } catch (_) {
    return false;
  }

  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function hashWebhookEvent(timestamp, rawBody) {
  return crypto.createHash('sha256')
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(rawBody)
    .digest('hex');
}

function hashPayload(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function createOrder(body, idempotencyKey) {
  return request('POST', '/orders', {
    idempotencyKey,
    body
  });
}

function getOrder(orderId) {
  return request('GET', '/orders/' + encodeURIComponent(orderId));
}

function getPayment(orderId, paymentId) {
  return request(
    'GET',
    '/orders/' + encodeURIComponent(orderId) +
      '/payments/' + encodeURIComponent(paymentId)
  );
}

function getPayments(orderId) {
  return request(
    'GET',
    '/orders/' + encodeURIComponent(orderId) + '/payments'
  );
}

function createRefund(orderId, body, idempotencyKey) {
  return request(
    'POST',
    '/orders/' + encodeURIComponent(orderId) + '/refunds',
    { body, idempotencyKey }
  );
}

function getRefunds(orderId) {
  return request(
    'GET',
    '/orders/' + encodeURIComponent(orderId) + '/refunds'
  );
}

module.exports = {
  CashfreeGatewayError,
  settings,
  publicConfig,
  createOrder,
  getOrder,
  getPayment,
  getPayments,
  createRefund,
  getRefunds,
  verifyWebhookSignature,
  hashWebhookEvent,
  hashPayload
};
