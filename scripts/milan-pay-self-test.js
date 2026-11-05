'use strict';
const fs = require('fs');
const assert = require('assert');

const route = fs.readFileSync('backend/routes/milanPay.js', 'utf8');
const page = fs.readFileSync('frontend/milan-pay.html', 'utf8');
assert.match(page, /initializeCashfree\(\);/,
  'Cashfree hosted checkout must be the primary checkout initializer');
assert.doesNotMatch(page,
  /Promise\.allSettled\(\[loadConfig\(\), loadCashfreeConfig\(\)\]\)/,
  'Legacy UPI configuration must not gate Cashfree checkout');
assert.match(page, /MILAN_PAY_UPI_ID is not required for Cashfree hosted checkout/,
  'Missing Cashfree setup must explain that a separate UPI ID is not required');

const storagePage = fs.readFileSync('frontend/storage-upgrade.html', 'utf8');
const server = fs.readFileSync('backend/server.js', 'utf8');

assert(server.includes("app.get('/milan-pay'"), 'Short MILAN Pay URL must be registered');
assert(server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));"),
  'MILAN Pay API route must be mounted');
assert(route.includes("router.get('/config'"), 'Public configuration endpoint missing');
assert(route.includes("router.post('/orders', createOrderRateLimiter, auth"), 'Order creation must require authentication after rate limiting');
assert(route.includes("limit: 8, windowMs: 60_000"), 'Order creation rate limit missing');
assert(route.includes("router.get('/orders/:orderId/status', orderStatusRateLimiter, auth"), 'Order status must require authentication after rate limiting');
assert(route.includes("limit: 60, windowMs: 60_000"), 'Order status rate limit missing');
assert(
  route.includes("gateway = 'milanpay'") &&
  route.includes("(user_id, order_id, plan, amount_inr, gateway, gateway_reference)") &&
  route.includes("VALUES ($1, $2, $3, $4, 'milanpay', $5)"),
  'Order queries and inserts must use the MILAN Pay gateway identifier and omit caller-controlled status'
);
assert(route.includes("status: 'pending'"), 'New orders must start pending');
assert(!/status:\s*['"]paid['"]/.test(route), 'Intent-only flow must never mark orders paid automatically');
assert(route.includes('MILAN_PAY_UPI_ID'), 'Merchant UPI configuration hook missing');
assert(route.includes('upi://pay?'), 'UPI intent generation missing');
assert(route.includes("require('qrcode')") && route.includes("QRCode.toDataURL"), 'Server-generated dynamic UPI QR missing');
assert(route.includes("reusedOrder: true") && route.includes("MILAN_PAY_PENDING_ORDER_EXISTS"), 'Existing pending orders must be reused or block plan changes');
assert(route.includes("merchantVpa: ready ? vpa : null"), 'Public checkout config must expose the receiver VPA for customer verification');
assert(route.includes("gpay://upi/pay?") && route.includes("merchantMcc"), 'Google Pay iOS intent must use documented scheme and bank-supplied MCC');
assert(route.includes("MILAN_PAY_GOOGLE_PAY_IOS_ENABLED") && route.includes("googlePayIosAvailable(vpa)"), 'Google Pay iOS shortcut must require explicit merchant-approved opt-in');
assert(fs.readFileSync('backend/.env.example', 'utf8').includes('MILAN_PAY_GOOGLE_PAY_IOS_ENABLED=false'), 'Google Pay iOS shortcut must default off until bank onboarding and device QA');
assert(page.includes('id="upiQr"') && page.includes('id="payeeVpa"'), 'Checkout must show dynamic QR and receiver UPI ID');
assert(page.includes('id="copyVpa"') && page.includes('id="copyAmount"') && page.includes('id="copyOrderId"'), 'Cross-device copy-payment fallbacks missing');
assert(page.includes("Never trust the payment URI from sessionStorage"), 'Pending order restore must use the authenticated server-owned payment URI');
assert(page.includes('data.paymentActionRequired === false') && page.includes('Verification pending'), 'Checkout must not reopen a payment intent after UTR submission');
assert(page.includes("navigator.clipboard") && page.includes('document.execCommand("copy")'), 'Clipboard fallback missing');
assert(fs.readFileSync('backend/.env.example', 'utf8').includes('MILAN_PAY_MCC='), 'Document bank-assigned MCC setting for iOS UPI intent');
assert(storagePage.includes('href="/milan-pay"'), 'Storage page must link to MILAN Pay checkout');
assert(storagePage.includes('/milan-pay?plan='), 'Upgrade Storage must open MILAN Pay');
assert(page.includes('MILAN Pay'), 'Branded checkout missing');
assert(page.includes('Cards — not enabled in direct UPI mode'), 'Cards must remain disabled in direct UPI mode');
assert(
  page.includes('Direct UPI checkout does not automatically verify payment') &&
  page.includes('independently verifies the transaction against bank records'),
  'Checkout must explain manual bank verification limitation'
);
assert(page.includes('/api/milan-pay/orders'), 'Checkout must create a direct MILAN Pay UPI order');
assert(!page.includes('/api/payment/create-order'), 'Direct UPI checkout must not invoke a legacy hosted-checkout endpoint');
assert(!page.includes('/api/payment/verify'), 'Direct UPI checkout must not depend on legacy processor verification APIs');


const cashfreeRoute = fs.readFileSync('backend/routes/cashfree.js', 'utf8');
const cashfreeService = fs.readFileSync('backend/services/cashfreeGateway.js', 'utf8');
const envExample = fs.readFileSync('backend/.env.example', 'utf8');
const login = fs.readFileSync('frontend/assets/login.js', 'utf8');

assert(server.includes("app.use('/api/cashfree', cashfreeRoutes);"),
  'Cashfree API router must be mounted');
assert(
  server.includes("express.raw({ type: 'application/json', limit: '1mb' })") &&
  server.indexOf("app.post(\n  '/api/cashfree/webhook'") <
    server.indexOf("app.use(express.json"),
  'Cashfree webhook must capture raw request bytes before JSON parsing'
);
assert(server.includes('https://sdk.cashfree.com') &&
       server.includes('https://payments-test.cashfree.com'),
  'Cashfree SDK and hosted checkout origins must be present in CSP');

assert(page.includes('id="cashfreePanel"') &&
       page.includes('id="cashfreePhone"') &&
       page.includes('id="cashfreePay"'),
  'Cashfree hosted checkout panel must exist');
assert(page.includes('pattern="[6-9][0-9]{9}"'),
  'Cashfree checkout must validate a 10-digit Indian mobile number');
assert(page.includes('/api/cashfree/config') &&
       page.includes('/api/cashfree/orders') &&
       page.includes('/verify'),
  'Cashfree browser flow must load config, create orders and verify status');
assert(page.includes('https://sdk.cashfree.com/js/v3/cashfree.js') &&
       page.includes('redirectTarget: "_self"'),
  'Cashfree hosted SDK must use the documented browser checkout flow');

const sdkLoaderStart = page.indexOf('function loadCashfreeSdk()');
const sdkLoaderEnd = page.indexOf('function setCashfreeLoginState()', sdkLoaderStart);
assert(sdkLoaderStart >= 0 && sdkLoaderEnd > sdkLoaderStart,
  'Cashfree SDK loader must remain independently testable');
const sdkLoader = page.slice(sdkLoaderStart, sdkLoaderEnd);
assert.doesNotMatch(sdkLoader, /crossOrigin\s*=/i,
  'Cashfree SDK must use the documented classic-script loading mode without forcing CORS');
assert(sdkLoader.includes('script.remove()') && sdkLoader.includes('cashfreeSdkPromise = null'),
  'Failed Cashfree SDK script elements must be removed so retries can load a fresh script');
assert(sdkLoader.includes('20000') && sdkLoader.includes('window.clearTimeout'),
  'Cashfree SDK loading must have a bounded timeout and clear it after completion');
assert(page.includes('data.status === "paid"') &&
       page.includes('Payment confirmed by Cashfree'),
  'Browser must only show completion after server verification');
assert(page.includes('data.reviewRequired === true') &&
       page.includes('cashfreePay.disabled = true') &&
       page.includes('cashfreeResumeAllowed = false'),
  'Review-required orders must block checkout resume');
assert(cashfreeRoute.includes('hasUnresolvedPaymentReview') &&
       cashfreeRoute.includes('CASHFREE_PAYMENT_REVIEW_REQUIRED') &&
       cashfreeRoute.includes('public.cashfree_payment_attempts') &&
       cashfreeRoute.includes('public.cashfree_webhook_events'),
  'Backend must enforce persistent Cashfree review locks');
assert(cashfreeRoute.includes('/orders/:orderId/verify') &&
       cashfreeRoute.includes('process_cashfree_payment_event'),
  'Cashfree verification must reconcile through the authoritative database RPC');
assert(cashfreeService.includes('verifyWebhookSignature') &&
       cashfreeService.includes('createOrder'),
  'Cashfree provider service must implement order creation and webhook verification');

assert(page.includes('sessionStorage.setItem("milanPostLoginReturn", "/milan-pay")') &&
       login.includes('sessionStorage.getItem("milanPostLoginReturn") === "/milan-pay"') &&
       login.includes('getPostLoginDestination()'),
  'Cashfree login recovery must use a fixed one-time return path');
assert(page.includes('id="cashfreeLogin" href="/"'),
  'Cashfree login link must point to the actual MILAN login page');
assert(envExample.includes('CASHFREE_ENABLED=false') &&
       envExample.includes('CASHFREE_ENV=sandbox') &&
       envExample.includes('CASHFREE_APP_ID=') &&
       envExample.includes('CASHFREE_SECRET_KEY='),
  'Cashfree environment template must remain disabled with blank credentials');

console.log('PASS: Cashfree frontend panel and Indian mobile validation');
console.log('PASS: Cashfree SDK, authenticated order creation and server verification');
console.log('PASS: Review-required order checkout lock');
console.log('PASS: Raw webhook parsing precedes the global JSON parser');
console.log('PASS: Backend persistent review guard and authoritative RPC');
console.log('PASS: Cashfree CSP and provider security hooks');

const restoreStart = page.indexOf('async function restoreCashfreeOrder()');
const restoreEnd = page.indexOf('async function restorePendingOrder()', restoreStart);
assert(restoreStart >= 0 && restoreEnd > restoreStart,
  'Cashfree restore function must be available for regression checks');
const restoreBlock = page.slice(restoreStart, restoreEnd);
const orderAssignment = restoreBlock.indexOf('cashfreeOrderId = savedId;');
const orderPersistence = restoreBlock.indexOf('sessionStorage.setItem("milanCashfreeOrderId", savedId);');
const loginCheck = restoreBlock.indexOf('if (!token())');
assert(orderAssignment >= 0 && orderPersistence > orderAssignment && loginCheck > orderPersistence,
  'Cashfree return order ID must persist before the login check');

console.log('PASS: Cashfree return order ID survives login recovery');

console.log('PASS: Safe one-time login return and disabled-by-default environment');

console.log('MILAN Pay checks passed:');
console.log(' - Branded checkout created');
console.log(' - Authenticated server-owned orders');
console.log(' - UPI intent requires merchant VPA');
console.log(' - Order remains pending until trusted verification exists');
console.log(' - Cards and international processing are not falsely marked active');
