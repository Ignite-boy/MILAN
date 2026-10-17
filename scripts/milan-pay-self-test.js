const fs = require('fs');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('PASS:', message);
  }
}

const server = fs.readFileSync('backend/server.js', 'utf8');
const storagePage = fs.readFileSync('frontend/storage-upgrade.html', 'utf8');
const cashfreePage = fs.readFileSync('frontend/storage-upgrade-cashfree.html', 'utf8');
const mobileNav = fs.readFileSync('frontend/milan-mobile.js', 'utf8');

assert(!server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));"),
  'MILAN Pay API is not mounted');
assert(!server.includes("app.get('/milan-pay'"),
  'MILAN Pay short checkout URL is not registered');
assert(server.includes("app.use('/api/payment', require('./routes/payment'))"),
  'Cashfree payment API remains mounted');
assert(storagePage.includes('/storage-upgrade-cashfree.html?plan='),
  'Storage upgrade opens Cashfree checkout');
assert(!storagePage.includes('/milan-pay'),
  'Storage upgrade contains no MILAN Pay checkout link');
assert(mobileNav.includes('href="/storage-upgrade.html#payment">💳 Payment Update'),
  'Mobile hamburger Payment Update opens the Cashfree payment section');
assert(!/MILAN Pay|Direct UPI|Manual bank verification/.test(storagePage),
  'Storage upgrade page contains no stale MILAN Pay or manual-UPI messaging');
assert(storagePage.includes('Cashfree hosted checkout') && storagePage.includes('server-side payment verification'),
  'Storage upgrade clearly identifies Cashfree and server-side verification');
assert(cashfreePage.includes('https://sdk.cashfree.com/js/v3/cashfree.js'),
  'Cashfree hosted checkout SDK remains configured');
assert(fs.existsSync('backend/routes/milanPay.js'),
  'Legacy MILAN Pay route source is preserved, not deleted');
assert(fs.existsSync('frontend/milan-pay.html'),
  'Legacy MILAN Pay page source is preserved, not deleted');

if (process.exitCode) process.exit(process.exitCode);
console.log('MILAN Pay decommissioning checks passed.');
