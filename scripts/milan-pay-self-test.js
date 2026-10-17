'use strict';
const fs = require('fs');
const assert = require('assert');

const route = fs.readFileSync('backend/routes/milanPay.js', 'utf8');
const page = fs.readFileSync('frontend/milan-pay.html', 'utf8');
const storagePage = fs.readFileSync('frontend/storage-upgrade.html', 'utf8');
const server = fs.readFileSync('backend/server.js', 'utf8');

assert(server.includes("app.get('/milan-pay'"), 'Short MILAN Pay URL must be registered');
assert(server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));"),
  'MILAN Pay API route must be mounted');
assert(route.includes("router.get('/config'"), 'Public configuration endpoint missing');
assert(route.includes("router.post('/orders', auth"), 'Order creation must require authentication');
assert(route.includes("router.get('/orders/:orderId/status', auth"), 'Order status must require authentication');
assert(route.includes("gateway: 'milanpay'"), 'Orders must be marked with the MILAN Pay identifier');
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

console.log('MILAN Pay checks passed:');
console.log(' - Branded checkout created');
console.log(' - Authenticated server-owned orders');
console.log(' - UPI intent requires merchant VPA');
console.log(' - Order remains pending until trusted verification exists');
console.log(' - Cards and international processing are not falsely marked active');
