'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('backend/server.js');
const adminRoute = read('backend/routes/admin.js');
const adminPage = read('frontend/admin-users.html');
const payRoute = read('backend/routes/milanPay.js');
const storageRoute = read('backend/routes/storage.js');
const storagePage = read('frontend/storage-upgrade.html');
const payPage = read('frontend/milan-pay.html');
const env = read('backend/.env.example');
const pkg = JSON.parse(read('package.json'));
const migration = read('backend/migrations/20261014_milan_pay_manual_verification.sql');
const pendingOrdersMigration = read('backend/migrations/20261015_milan_pay_single_pending_order.sql');

const checks = [
  ['MILAN Pay route is mounted', server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));")],
  ['Legacy payment route is not mounted', !server.includes("app.use('/api/payment', require('./routes/payment'));")],
  ['Legacy payment route file is removed', !fs.existsSync(path.join(root, 'backend/routes/payment.js'))],
  ['MILAN Pay config endpoint exists', payRoute.includes("router.get('/config'")],
  ['Order creation requires authentication', payRoute.includes("router.post('/orders', auth")],
  ['Order status endpoint requires authentication', payRoute.includes("router.get('/orders/:orderId/status', auth")],
  ['New orders start pending', payRoute.includes("status: 'pending'")],
  ['Order creation checks pending manual requests', payRoute.includes("from('storage_upgrade_requests')")],
  ['Storage request validates the order ID', storageRoute.includes("req.body?.orderId")],
  ['Storage request checks the server order', storageRoute.includes("from('payment_orders')") && storageRoute.includes("order.gateway !== 'milanpay'")],
  ['Storage request links the UTR to the order', storageRoute.includes("order_id: orderId") && storageRoute.includes("utr,")],
  ['Manual request does not mark payment paid', !storageRoute.includes("status: 'paid'")],
  ['Admin approval requires explicit bank verification', storageRoute.includes("req.body?.bankVerified !== true")],
  ['Admin approval uses a database RPC', storageRoute.includes("supabase.rpc(") && storageRoute.includes("'admin_approve_milan_pay_storage_request'")],
  ['Admin rejection uses a database RPC', storageRoute.includes("'admin_reject_milan_pay_storage_request'")],
  ['Duplicate UTR insert conflict is handled', storageRoute.includes("error.code === '23505'")],
  ['Admin token fails closed when missing', storageRoute.includes("process.env.ADMIN_TOKEN || ''")],
  ['Admin token is not accepted via query string', !storageRoute.includes('req.query.adminToken')],
  ['500 MB price is consistent', payRoute.includes("amountInr: 250") && storageRoute.includes("amountInr: 250")],
  ['1 GB price is consistent', payRoute.includes("amountInr: 500") && storageRoute.includes("amountInr: 500")],
  ['Checkout has a UTR form', payPage.includes('id="utrForm"') && payPage.includes('name="utr"')],
  ['Checkout submits the server order ID and UTR', payPage.includes('orderId: currentOrderId') && payPage.includes('utr')],
  ['Checkout keeps storage pending until manual verification', payPage.includes('PENDING BANK VERIFICATION') && payPage.includes('storage is not upgraded yet')],
  ['Checkout shows server-generated order QR', payRoute.includes("QRCode.toDataURL") && payRoute.includes("qrDataUrl") && payPage.includes('id="upiQr"')],
  ['Checkout shows merchant receiver details', payRoute.includes("merchantVpa: ready ? vpa : null") && payPage.includes('id="payeeVpa"')],
  ['Existing pending order is reused to reduce duplicate orders', payRoute.includes("reusedOrder: true") && payRoute.includes("MILAN_PAY_PENDING_ORDER_EXISTS")],
  ['Concurrent order creation conflict is handled', payRoute.includes("A pending order was created at the same time")],
  ['Pending orders pin the selected merchant VPA', payRoute.includes("gateway_reference: vpa") && payRoute.includes("gateway_reference,paid_at")],
  ['Migration checks for duplicate pending orders before indexing', pendingOrdersMigration.includes("HAVING COUNT(*) > 1") && pendingOrdersMigration.includes("Multiple pending MILAN Pay orders exist")],
  ['Migration enforces one pending MILAN Pay order per user', pendingOrdersMigration.includes("payment_orders_one_pending_milanpay_per_user_uidx") && pendingOrdersMigration.includes("gateway = 'milanpay' AND status = 'pending'")],
  ['Google Pay iOS intent requires configured bank MCC', payRoute.includes("gpay://upi/pay?") && payRoute.includes("merchantMcc()") && payRoute.includes("MILAN_PAY_MCC")],
  ['Copy-payment fallback available for VPA amount and order reference', payPage.includes('id="copyVpa"') && payPage.includes('id="copyAmount"') && payPage.includes('id="copyOrderId"')],
  ['Restored checkout URI is rebuilt by the server', payPage.includes("Never trust the payment URI from sessionStorage") && payPage.includes("data.upiUri")],
  ['Storage page links to MILAN Pay', storagePage.includes('/milan-pay?plan=')],
  ['Old Paytm hosts are removed from active source', !server.includes('paytmpayments.com')],
  ['Old Paytm variables are absent from environment example', !env.includes('PAYTM_')],
  ['Legacy checksum package is absent', !pkg.dependencies?.paytmchecksum],
  ['Migration adds the order link column', migration.includes('ADD COLUMN IF NOT EXISTS order_id')],
  ['Migration creates a unique order link index', migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_order_id_uidx')],
  ['Migration enforces case-insensitive UTR uniqueness', migration.includes('storage_upgrade_requests_utr_normalized_uidx')],
  ['Migration checks order, user, plan and amount', migration.includes("v_order.gateway IS DISTINCT FROM 'milanpay'") && migration.includes('v_order.amount_inr IS DISTINCT FROM v_expected_amount')],
  ['Migration checks reused UTRs', migration.includes('This transaction reference has already been used.')],
  ['Migration updates payment and quota transactionally', migration.includes("status = 'paid'") && migration.includes('dwn_quota_bytes = GREATEST')],
  ['Migration restricts the RPC to service role', migration.includes('REVOKE ALL ON FUNCTION public.admin_approve_milan_pay_storage_request') && migration.includes('TO service_role')],
  ['Admin API rejects missing or placeholder token configuration',
    adminRoute.includes("process.env.ADMIN_TOKEN || ''") &&
    adminRoute.includes("expected === 'change-this-admin-token'")],
  ['Admin API no longer accepts token query parameters',
    !adminRoute.includes('req.query.adminToken') && !adminRoute.includes('req.query.token')],
  ['Admin dashboard sends token in header',
    adminPage.includes('"x-admin-token": token') && !adminPage.includes('adminToken=')],
  ['Admin dashboard stores token only in session storage',
    adminPage.includes('sessionStorage.getItem("milanAdminToken")') &&
    !adminPage.includes('localStorage.getItem("milanAdminToken")')],
  ['Admin dashboard has storage payment queue',
    adminPage.includes('data-tab="storage"') &&
    adminPage.includes('/api/storage/admin/requests')],
  ['Admin approval requires explicit confirmation and bankVerified flag',
    adminPage.includes('Have you independently checked your bank records') &&
    adminPage.includes('bankVerified:true')],
  ['Test script is configured', pkg.scripts?.['test:payment'] === 'node scripts/payment-self-test.js']
];

let failed = false;
for (const [label, passed] of checks) {
  console.log((passed ? 'PASS: ' : 'FAIL: ') + label);
  if (!passed) failed = true;
}

if (failed) {
  console.log('Some MILAN Pay integration checks failed.');
  process.exitCode = 1;
} else {
  console.log('All MILAN Pay manual-verification integration checks passed.');
}
