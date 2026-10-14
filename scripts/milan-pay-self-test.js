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
assert(!route.includes('PAYTM_MERCHANT_KEY'), 'MILAN Pay must not rely on Paytm Merchant Key');
assert(storagePage.includes('href="/milan-pay"'), 'Storage page must link to MILAN Pay checkout');
assert(page.includes('MILAN Pay'), 'Branded checkout missing');
assert(page.includes('Cards — subject to merchant activation'), 'Card availability must depend on merchant activation');
assert(page.includes('not marked successful'), 'Checkout must explain server-side verification limitation');
assert(page.includes('/api/payment/create-order'), 'Checkout must use the existing server-side payment order API');
assert(page.includes('/api/payment/verify'), 'Checkout must use trusted server-side payment verification');

console.log('MILAN Pay checks passed:');
console.log(' - Branded checkout created');
console.log(' - Authenticated server-owned orders');
console.log(' - UPI intent requires merchant VPA');
console.log(' - Order remains pending until trusted verification exists');
console.log(' - Cards and international processing are not falsely marked active');
