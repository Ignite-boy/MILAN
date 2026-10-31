'use strict';
const fs = require('fs');
const assert = require('assert');

const route = fs.readFileSync('backend/routes/milanPay.js', 'utf8');
const service = fs.readFileSync('backend/services/cashfreePayments.js', 'utf8');
const migration = fs.readFileSync('backend/migrations/20261031_postgresql_cashfree_payments.sql', 'utf8');
const env = fs.readFileSync('backend/.env.example', 'utf8');
const server = fs.readFileSync('backend/server.js', 'utf8');

const checks = [
  ['MILAN Pay API mount remains unchanged',
    server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));")],
  ['Public Cashfree configuration endpoint exists',
    route.includes("router.get('/config'") && route.includes("paymentConfigResponse()")],
  ['Order creation requires authentication after rate limiting',
    route.includes("router.post('/orders', createOrderRateLimiter, auth")],
  ['Order status requires authentication after rate limiting',
    route.includes("router.get('/orders/:orderId/status', orderStatusRateLimiter, auth")],
  ['Order creation rate limit remains 8 per minute',
    route.includes("limit: 8, windowMs: 60_000")],
  ['Order status rate limit remains 60 per minute',
    route.includes("limit: 60, windowMs: 60_000")],
  ['Cashfree is the gateway for new orders',
    route.includes("gateway = 'cashfree'") &&
    route.includes("'cashfree', NULL, $5, $6, $7::jsonb")],
  ['Old direct-UPI orders are blocked pending reconciliation',
    route.includes("gateway = 'milanpay'") &&
    route.includes('LEGACY_PAYMENT_RECONCILIATION_REQUIRED')],
  ['New order insert omits caller-controlled status',
    route.includes('(user_id, order_id, plan, amount_inr, gateway, gateway_reference,') &&
    route.includes('customer_phone, provider_idempotency_key, provider_request_payload)') &&
    !/INSERT INTO public\.payment_orders[\s\S]{0,500}\bstatus\b/i.test(route)],
  ['Plan prices remain server-controlled',
    route.includes("'500mb': Object.freeze({ name: '500 MB Storage', amountInr: 250") &&
    route.includes("'1gb': Object.freeze({ name: '1 GB Storage', amountInr: 500") &&
    !route.includes('req.body.amountInr')],
  ['Customer name and email come from authenticated account',
    route.includes('name: req.account.name') && route.includes('email: req.account.email')],
  ['Customer phone is normalized and validated',
    route.includes('cashfree.normalizePhone(req.body && req.body.phone)')],
  ['Order retries reuse saved payload and provider idempotency key',
    route.includes('localOrder.provider_idempotency_key') &&
    route.includes('localOrder.provider_request_payload') &&
    route.includes('cashfree.createOrder(payload, idempotencyKey)')],
  ['Provider order is attached through a guarded database function',
    route.includes('public.attach_cashfree_order($1, $2, $3, $4)')],
  ['Route never directly marks an order paid',
    !/UPDATE\s+public\.payment_orders[\s\S]{0,250}SET\s+status\s*=\s*'paid'/i.test(route) &&
    route.includes('public.finalize_cashfree_payment(')],
  ['Webhook endpoint verifies the untouched raw body signature',
    route.includes("router.post('/webhook'") &&
    route.includes('req.rawBody') &&
    route.includes('cashfree.verifyWebhookSignature(signature, timestamp, rawBody)')],
  ['Webhook independently verifies Cashfree order and payment history',
    route.includes('cashfree.getOrder(orderId)') &&
    route.includes('cashfree.getPaymentsForOrder(orderId)')],
  ['Only successful Cashfree payment events are finalized',
    route.includes("'PAYMENT_SUCCESS_WEBHOOK'") &&
    route.includes("payment.payment_status !== 'SUCCESS'")],
  ['Webhook retries can be acknowledged after durable duplicate-payment review',
    route.includes('MULTIPLE_SUCCESSFUL_PAYMENTS') &&
    route.includes('reviewRequired: true')],
  ['Payment status is scoped to the authenticated user and Cashfree gateway',
    route.includes("WHERE order_id = $1 AND user_id = $2 AND gateway = 'cashfree'")],
  ['Payment status is confirmed from Cashfree server APIs',
    route.includes('cashfree.getPaymentsForOrder(orderId)') &&
    route.includes("eventType: 'PAYMENT_STATUS_POLL'")],
  ['Cashfree service defaults to disabled sandbox mode',
    env.includes('CASHFREE_ENABLED=false') && env.includes('CASHFREE_ENV=sandbox')],
  ['Cashfree API credentials remain server-side',
    service.includes("'x-client-id': config.appId") &&
    service.includes("'x-client-secret': config.secretKey")],
  ['Cashfree provider calls use the API version and idempotency header',
    service.includes("'x-api-version': config.apiVersion") &&
    service.includes("headers['x-idempotency-key'] = idempotencyKey")],
  ['Webhook uses timestamp plus raw body HMAC-SHA256',
    service.includes("createHmac('sha256', config.secretKey)") &&
    service.includes("update(timestamp + rawBody.toString('utf8'), 'utf8')") &&
    service.includes('crypto.timingSafeEqual(received, expected)')],
  ['Migration records unique Cashfree payment attempts',
    migration.includes('cf_payment_id text PRIMARY KEY') &&
    migration.includes('cashfree_payment_events_webhook_idempotency_uidx')],
  ['Payment finalizer is a SECURITY DEFINER function',
    migration.includes('CREATE OR REPLACE FUNCTION public.finalize_cashfree_payment') &&
    migration.includes('SECURITY DEFINER')],
  ['Migration fixes the expected INR plan amounts',
    migration.includes('v_expected_amount := 250') &&
    migration.includes('v_expected_amount := 500')],
  ['Migration permits valid payment currencies while retaining INR order pricing',
    migration.includes("p_order_currency IS DISTINCT FROM 'INR'") &&
    migration.includes("COALESCE(p_payment_currency, '') !~ '^[A-Z]{3}$'") &&
    migration.includes('OR p_payment_amount <= 0') &&
    !migration.includes('OR p_payment_amount IS DISTINCT FROM v_expected_amount::numeric')],
  ['Application cannot access Cashfree event table directly',
    migration.includes('REVOKE ALL ON TABLE public.cashfree_payment_events FROM PUBLIC, milan_app')],
  ['Application order insert grant omits status and payment entitlement columns',
    /GRANT INSERT\s*\(\s*user_id,\s*order_id,\s*plan,\s*amount_inr,\s*gateway,\s*gateway_reference,\s*customer_phone,\s*provider_idempotency_key,\s*provider_request_payload\s*\)\s*ON TABLE public\.payment_orders TO milan_app/s.test(migration) &&
    !/GRANT INSERT\s*\([^)]*\bstatus\b[^)]*\)\s*ON TABLE public\.payment_orders TO milan_app/s.test(migration)],
  ['Function-owner CREATE privilege is revoked after ownership transfer',
    migration.includes('OWNER TO milan_pay_fn_owner') &&
    migration.includes('REVOKE CREATE ON SCHEMA public FROM milan_pay_fn_owner')],
  ['Server captures untouched webhook bytes before route processing',
    server.includes("req.path === '/api/milan-pay/webhook'") &&
    server.includes('req.rawBody = Buffer.from(buffer)')],
  ['Storage page continues to link to MILAN Pay',
    fs.readFileSync('frontend/storage-upgrade.html', 'utf8').includes('href="/milan-pay"')]
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
  if (!passed) failed++;
}
console.log(`Cashfree MILAN Pay checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exitCode = 1;
