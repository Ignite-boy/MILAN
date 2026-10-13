'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PaytmChecksum = require('paytmchecksum');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const payment = read('backend/routes/payment.js');
const frontend = read('frontend/storage-upgrade.html');
const server = read('backend/server.js');
const env = read('backend/.env.example');
const pkg = JSON.parse(read('package.json'));

assert(payment.includes("require('paytmchecksum')"), 'Paytm checksum package must be used by the backend.');
assert(payment.includes('/theia/api/v1/initiateTransaction'), 'Paytm Initiate Transaction endpoint missing.');
assert(payment.includes('/v3/order/status'), 'Paytm Transaction Status endpoint missing.');
assert(payment.includes('PaytmChecksum.verifySignature'), 'Paytm response/callback/webhook verification missing.');
assert(payment.includes("gateway: 'paytm'"), 'New orders must use Paytm as gateway.');
assert(payment.includes("router.post('/callback'"), 'Paytm callback endpoint missing.');
assert(payment.includes("router.post('/webhook'"), 'Paytm S2S webhook missing.');
assert(payment.includes('amountPaise(reportedAmount) !== amountPaise(order.amount_inr)'), 'Paid amount must match the server-stored order.');
assert(payment.includes('sendPaymentSuccessEmail'), 'Payment-success email must remain wired.');
assert(frontend.includes('window.Paytm.CheckoutJS.init(checkoutConfig)'), 'Paytm CheckoutJS init missing.');
assert(frontend.includes('tokenType: "TXN_TOKEN"'), 'Paytm TXN_TOKEN config missing.');
assert(frontend.includes('await recoverPayment(order.orderId)'), 'Client must rely on server-side verification.');
assert(frontend.includes('Paytm Business'), 'Storage page must identify Paytm Business.');
assert(server.includes('https://securestage.paytmpayments.com'), 'CSP must allow Paytm staging.');
assert(server.includes('https://secure.paytmpayments.com'), 'CSP must allow Paytm production.');
assert(env.includes('PAYTM_MID='), 'Paytm MID example missing.');
assert(env.includes('PAYTM_MERCHANT_KEY='), 'Paytm Merchant Key example missing.');
assert(pkg.dependencies?.paytmchecksum === '1.5.1', 'Paytm checksum dependency missing.');
assert(pkg.scripts?.['test:payment'] === 'node scripts/payment-self-test.js', 'Payment test script missing.');
for (const [name, source] of Object.entries({ payment, frontend, server, env })) {
  assert(!/cashfree|stripe/i.test(source), 'Retired gateway reference remains in ' + name);
}

async function verifyChecksumRoundTrip() {
  const testKey = '1234567890123456';
  const body = JSON.stringify({ mid: 'TEST_MID', orderId: 'MLN_TEST_001' });
  const signature = await PaytmChecksum.generateSignature(body, testKey);
  assert.equal(await PaytmChecksum.verifySignature(body, testKey, signature), true,
    'Paytm checksum round trip must verify.');
  assert.equal(await PaytmChecksum.verifySignature(body + ' ', testKey, signature), false,
    'Paytm checksum must reject a tampered payload.');
}
verifyChecksumRoundTrip().then(() => {
  console.log('MILAN Paytm payment architecture checks passed.');
  console.log(' - Initiate Transaction + Transaction Status APIs');
  console.log(' - Callback/webhook checksum validation');
  console.log(' - Stored-price verification + storage activation path');
  console.log(' - Checksum round-trip + tamper detection');
}).catch(error => {
  console.error('MILAN Paytm payment tests FAILED:', error.message);
  process.exitCode = 1;
});
