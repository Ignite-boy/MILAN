'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('backend/server.js');
const adminRoute = read('backend/routes/admin.js');
const adminPage = read('frontend/admin-users.html');
const payRoute = read('backend/routes/milanPay.js');
const cashfreeRoute = read('backend/routes/payment.js');
const cashfreePage = read('frontend/storage-upgrade-cashfree.html');
const cashfreeMigration = read('backend/migrations/20261018_cashfree_atomic_activation.sql');
const storageRoute = read('backend/routes/storage.js');
const storagePage = read('frontend/storage-upgrade.html');
const payPage = read('frontend/milan-pay.html');
const env = read('backend/.env.example');
const pkg = JSON.parse(read('package.json'));
const migration = read('backend/migrations/20261014_milan_pay_manual_verification.sql');
const pendingOrdersMigration = read('backend/migrations/20261015_milan_pay_single_pending_order.sql');
const pendingAudit = read('scripts/milan-pay-pending-audit.sql');
const paymentOpsDoc = read('docs/MILAN_PAY_OPERATIONS.md');

const checks = [
  ['MILAN Pay route is mounted', server.includes("app.use('/api/milan-pay', require('./routes/milanPay'));")],
  ['Legacy payment route is not mounted', !server.includes("app.use('/api/payment', require('./routes/payment'));")],
  ['Legacy payment route file is removed', !fs.existsSync(path.join(root, 'backend/routes/payment.js'))],
  ['MILAN Pay config endpoint exists', payRoute.includes("router.get('/config'")],
  ['Payment and storage verification responses are explicitly non-cacheable',
    storageRoute.includes("router.use((_req, res, next) => {\n  res.setHeader('Cache-Control', 'no-store');") &&
    payRoute.includes("router.post('/orders', createOrderRateLimiter, auth, async (req, res) => {\n  res.setHeader('Cache-Control', 'no-store');")],
  ['Order creation requires authentication after rate limiting',
    payRoute.includes("router.post('/orders', createOrderRateLimiter, auth")],
  ['Order status endpoint requires authentication after rate limiting',
    payRoute.includes("router.get('/orders/:orderId/status', orderStatusRateLimiter, auth")],
  ['Order creation has an 8-per-minute route limit',
    payRoute.includes("createDistributedApiRateLimiter({ limit: 8, windowMs: 60_000")],
  ['Order status has a 60-per-minute route limit',
    payRoute.includes("createDistributedApiRateLimiter({ limit: 60, windowMs: 60_000")],
  ['UTR submission has a 6-per-minute route limit',
    storageRoute.includes("createDistributedApiRateLimiter({ limit: 6, windowMs: 60_000") &&
    storageRoute.includes("router.post('/upgrade-request', submitUpgradeRequestLimiter, auth")],
  ['Admin storage actions have a 30-per-minute route limit',
    storageRoute.includes("createDistributedApiRateLimiter({ limit: 30, windowMs: 60_000") &&
    storageRoute.includes("router.post('/admin/requests/:id/approve', adminStorageActionLimiter, adminRequired") &&
    storageRoute.includes("router.post('/admin/requests/:id/reject', adminStorageActionLimiter, adminRequired")],
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
  ['Checkout disables repeat-payment actions when support reconciliation is required',
    payPage.includes('function requiresPaymentSupport(code)') &&
    payPage.includes("'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED'") &&
    payPage.includes("'MILAN_PAY_ORDER_VERIFICATION_ALREADY_SUBMITTED'") &&
    payPage.includes('pay.disabled = supportRequired || !ready') &&
    payPage.includes("'Contact support'") &&
    payPage.includes('Payment status unavailable')],
  ['Checkout keeps storage pending until manual verification', payPage.includes('PENDING BANK VERIFICATION') && payPage.includes('storage is not upgraded yet')],
  ['Checkout shows server-generated order QR', payRoute.includes("QRCode.toDataURL") && payRoute.includes("qrDataUrl") && payPage.includes('id="upiQr"')],
  ['Checkout shows merchant receiver details', payRoute.includes("merchantVpa: ready ? vpa : null") && payPage.includes('id="payeeVpa"')],
  ['Existing pending order is reused to reduce duplicate orders', payRoute.includes("reusedOrder: true") && payRoute.includes("MILAN_PAY_PENDING_ORDER_EXISTS")],
  ['Concurrent order creation conflict is handled', payRoute.includes("A pending order was created at the same time")],
  ['Pending orders pin the selected merchant VPA', payRoute.includes("gateway_reference: vpa") && payRoute.includes("gateway_reference,paid_at")],
  ['Legacy pending orders without a pinned recipient are blocked on order reuse and status restore',
    payRoute.includes("code: 'MILAN_PAY_PENDING_ORDER_RECIPIENT_UNVERIFIED'") &&
    payRoute.includes('if (!pendingOrder.gateway_reference)') &&
    payRoute.includes('if (!data.gateway_reference)') &&
    !payRoute.includes('const orderVpa = validVpa(pendingOrder.gateway_reference) ? pendingOrder.gateway_reference : vpa') &&
    !payRoute.includes('const vpa = validVpa(data.gateway_reference) ? data.gateway_reference : configuredVpa') &&
    !payRoute.includes('.update({ gateway_reference: orderVpa })') &&
    !payRoute.includes('.update({ gateway_reference: vpa })')],
  ['Migration checks for duplicate pending orders before indexing', pendingOrdersMigration.includes("HAVING COUNT(*) > 1") && pendingOrdersMigration.includes("Multiple pending MILAN Pay orders exist")],
  ['Migration enforces one pending MILAN Pay order per user', pendingOrdersMigration.includes("payment_orders_one_pending_milanpay_per_user_uidx") && pendingOrdersMigration.includes("gateway = 'milanpay' AND status = 'pending'")],
  ['Order creation and restore fail closed when duplicate pending orders exist', payRoute.includes("MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED") && payRoute.includes(".limit(2)")],
  ['Order status suppresses payment links when a verification request already exists', payRoute.includes("paymentActionRequired: false") && payRoute.includes("Do not pay again")],
  ['Order reuse never issues a fresh QR after any verification request is already linked',
    payRoute.includes("code: 'MILAN_PAY_ORDER_VERIFICATION_ALREADY_SUBMITTED'") &&
    payRoute.includes(".eq('order_id', pendingOrder.order_id)") &&
    payRoute.includes('A verification request already exists for this order. Do not pay again')],
  ['Config clearly distinguishes unverified merchant setup from automatic confirmation', payRoute.includes("merchantVerificationStatus: ready ? 'configured-unverified'") && payRoute.includes("automaticPaymentConfirmationAvailable: false")],
  ['Pending-order reconciliation SQL is read-only', pendingAudit.startsWith('-- READ-ONLY') && !/(?:^|\n)\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/im.test(pendingAudit)],
  ['Operations runbook requires zero duplicate groups before migration', paymentOpsDoc.includes('duplicate-group result must return **zero rows**') && paymentOpsDoc.includes('Do not remove or bypass that preflight')],
  ['Operations runbook documents bank integration prerequisite for automatic confirmation', paymentOpsDoc.includes('current UPI intent/QR protocol does not provide a trusted server-to-server settlement callback') && paymentOpsDoc.includes('authorised UPI partner')],
  ['Google Pay iOS intent requires configured bank MCC', payRoute.includes("gpay://upi/pay?") && payRoute.includes("merchantMcc()") && payRoute.includes("MILAN_PAY_MCC")],
  ['Copy-payment fallback available for VPA amount and order reference', payPage.includes('id="copyVpa"') && payPage.includes('id="copyAmount"') && payPage.includes('id="copyOrderId"')],
  ['Restored checkout URI is rebuilt by the server', payPage.includes("Never trust the payment URI from sessionStorage") && payPage.includes("data.upiUri")],
  ['Storage page links to MILAN Pay', storagePage.includes('/milan-pay?plan=')],
  ['Cashfree hosted-checkout route is mounted independently of MILAN Pay',
    server.includes("app.use('/api/payment', require('./routes/payment'))") &&
    server.includes("app.use('/api/milan-pay', require('./routes/milanPay'))")],
  ['Cashfree route requires rate limiting and authentication for private endpoints',
    cashfreeRoute.includes("router.post('/create-order', createOrderRateLimiter, auth") &&
    cashfreeRoute.includes("router.post('/verify', verifyRateLimiter, auth") &&
    cashfreeRoute.includes("router.get('/status', statusRateLimiter, auth")],
  ['Cashfree configuration rejects unknown environment names',
    cashfreeRoute.includes("CASHFREE_ENVIRONMENT === 'sandbox' || CASHFREE_ENVIRONMENT === 'production'")],
  ['Cashfree order creation blocks duplicate pending orders and attempts safe resume',
    cashfreeRoute.includes("cashfree_pending_orders_reconciliation_required") &&
    cashfreeRoute.includes("providerOrder.payment_session_id")],
  ['Cashfree quota activation is atomic and calls a restricted RPC',
    cashfreeRoute.includes("'confirm_cashfree_storage_payment'") &&
    cashfreeMigration.includes('SECURITY DEFINER') &&
    cashfreeMigration.includes('TO service_role') &&
    cashfreeMigration.includes("gateway = 'cashfree'")],
  ['Cashfree webhook captures exact raw body before route handling',
    server.includes("req.rawBody = buf.toString('utf8')") &&
    server.indexOf("req.rawBody = buf.toString('utf8')") < server.indexOf("app.use('/api/payment', require('./routes/payment'))")],
  ['Cashfree webhook requires payment SUCCESS, ID and actual amount',
    cashfreeRoute.includes("if (paymentStatus !== 'SUCCESS')") &&
    cashfreeRoute.includes("Number(payment?.payment_amount)") &&
    cashfreeRoute.includes("paymentId") &&
    !cashfreeRoute.includes("orderEntity?.order_amount")],
  ['Failed Cashfree payment attempts are not treated as terminal failed orders',
    cashfreeRoute.slice(cashfreeRoute.indexOf("router.post('/webhook'")).includes("Do not mark the order terminally failed") &&
    !cashfreeRoute.slice(cashfreeRoute.indexOf("router.post('/webhook'")).includes(".update({")],
  ['Cashfree SDK domains are included in server CSP',
    server.includes('https://sdk.cashfree.com') &&
    server.includes('https://*.cashfree.com')],
  ['Cashfree hosted checkout is a separate page and leaves direct UPI route unchanged',
    cashfreePage.includes('https://sdk.cashfree.com/js/v3/cashfree.js') &&
    cashfreePage.includes('/api/payment/create-order') &&
    storagePage.includes('href="/milan-pay"') &&
    payRoute.includes("router.post('/orders'")],
  ['Direct UPI merchant setting is documented', env.includes('MILAN_PAY_UPI_ID=')],
  ['No dedicated hosted-payment SDK dependency is declared', !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(name => /(?:payment|gateway|checkout).*(?:sdk|client)|(?:sdk|client).*(?:payment|gateway|checkout)/i.test(name))],
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
