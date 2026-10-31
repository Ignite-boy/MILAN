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
const migration = read('backend/migrations/20261019_postgresql_milan_pay.sql');
const cashfreeMigration = read('backend/migrations/20261031_postgresql_cashfree_payments.sql');
const cashfreeService = read('backend/services/cashfreePayments.js');
const postgresqlMigration = migration;
const rolesMigration = read('backend/migrations/20261019_postgresql_00_roles.sql');
const pendingOrdersMigration = read('backend/migrations/20261015_milan_pay_single_pending_order.sql');
const pendingAudit = read('scripts/milan-pay-pending-audit.sql');
const paymentOpsDoc = read('docs/MILAN_PAY_OPERATIONS.md');

const checks = [
  ['Payment routes use PostgreSQL',
    payRoute.includes("require('../services/milanDb')") &&
    storageRoute.includes("require('../services/milanDb')")],
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
    payRoute.includes("limit: 8, windowMs: 60_000")],
  ['Order status has a 60-per-minute route limit',
    payRoute.includes("limit: 60, windowMs: 60_000")],
  ['UTR submission has a 6-per-minute route limit',
    storageRoute.includes("limit: 6, windowMs: 60_000") &&
    storageRoute.includes("router.post('/upgrade-request', submitUpgradeRequestLimiter, auth")],
  ['Admin storage actions have a 30-per-minute route limit',
    storageRoute.includes("limit: 30, windowMs: 60_000") &&
    storageRoute.includes("router.post('/admin/requests/:id/approve', adminStorageActionLimiter, adminRequired") &&
    storageRoute.includes("router.post('/admin/requests/:id/reject', adminStorageActionLimiter, adminRequired")],
  ['New orders start pending', payRoute.includes("status: 'pending'")],
  ['Order creation checks pending manual requests', payRoute.includes("public.storage_upgrade_requests")],
  ['Storage request validates the order ID', storageRoute.includes("req.body?.orderId")],
  ['Storage request checks the server order', storageRoute.includes("public.payment_orders") && storageRoute.includes("order.gateway !== 'milanpay'")],
  ['Storage request links the UTR to the order', storageRoute.includes("order_id") && storageRoute.includes("utr") && storageRoute.includes("orderId")],
  ['Manual request does not mark payment paid', !storageRoute.includes("status: 'paid'")],
  ['Admin approval requires explicit bank verification', storageRoute.includes("req.body?.bankVerified !== true")],
  ['Admin approval uses a database RPC', storageRoute.includes("public.admin_approve_milan_pay_storage_request")],
  ['Admin rejection uses a database RPC', storageRoute.includes("public.admin_reject_milan_pay_storage_request")],
  ['Duplicate UTR insert conflict is handled', storageRoute.includes("error.code === '23505'")],
  ['Admin token fails closed when missing', storageRoute.includes("process.env.ADMIN_TOKEN || ''")],
  ['Admin token is not accepted via query string', !storageRoute.includes('req.query.adminToken')],
  ['500 MB price is consistent', payRoute.includes("amountInr: 250") && storageRoute.includes("amountInr: 250")],
  ['1 GB price is consistent', payRoute.includes("amountInr: 500") && storageRoute.includes("amountInr: 500")],
  ['Cashfree checkout collects phone and submits selected plan to server',
    payPage.includes('body: JSON.stringify({ plan: state.selectedPlan, phone })') &&
    payPage.includes('api("/api/milan-pay/orders"') &&
    payPage.includes('id="phone"')],
  ['New checkout removes legacy UTR submission UI',
    !payPage.includes('id="utrForm"') &&
    !payPage.includes('name="utr"') &&
    !payPage.includes('currentOrderId')],
  ['Checkout locks repeat payment when support reconciliation is required',
    payPage.includes('function requiresPaymentSupport(code)') &&
    payPage.includes('"LEGACY_PAYMENT_RECONCILIATION_REQUIRED"') &&
    payPage.includes('"STORAGE_REQUEST_PENDING"') &&
    payPage.includes('"CASHFREE_PENDING_ORDER_RECONCILIATION_REQUIRED"') &&
    payPage.includes('"CASHFREE_PAYMENT_RECONCILIATION_REQUIRED"') &&
    payPage.includes('pay.disabled = state.busy || !state.ready || !loggedIn || state.requiresSupport') &&
    payPage.includes('pay.textContent = "Contact support"')],
  ['Storage activates only after provider reports paid; duplicate success requires review',
    payPage.includes('if (data.status === "paid")') &&
    payPage.includes('data.paymentReviewRequired === true') &&
    payPage.includes('Your MILAN storage upgrade is active.') &&
    payPage.includes('Do not pay again.')],
  ['Cashfree hosted checkout session replaces direct UPI QR',
    payRoute.includes('paymentSessionId: linked.paymentSessionId') &&
    payRoute.includes('providerOrder.payment_session_id') &&
    !payRoute.includes('QRCode.toDataURL')],
  ['Cashfree public config does not expose API credentials',
    payRoute.includes("router.get('/config'") &&
    payRoute.includes('cashfree.publicConfiguration()') &&
    cashfreeService.includes('checkoutSdk')],
  ['Pending Cashfree sessions are reused',
    payRoute.includes('localOrder.cf_order_id && localOrder.provider_payment_session_id') &&
    payRoute.includes('paymentSessionId: localOrder.provider_payment_session_id')],
  ['Concurrent Cashfree order conflicts are handled',
    payRoute.includes("error && error.code === '23505'") &&
    payRoute.includes('CASHFREE_PENDING_ORDER_EXISTS')],
  ['Cashfree order is linked through guarded database RPC',
    payRoute.includes('public.attach_cashfree_order($1, $2, $3, $4)')],
  ['Legacy direct-UPI orders are blocked pending reconciliation',
    payRoute.includes("gateway = 'milanpay' AND status = 'pending'") &&
    payRoute.includes('LEGACY_PAYMENT_RECONCILIATION_REQUIRED')],
  ['Migration checks for duplicate pending orders before indexing', pendingOrdersMigration.includes("HAVING COUNT(*) > 1") && pendingOrdersMigration.includes("Multiple pending MILAN Pay orders exist")],
  ['Migration enforces one pending MILAN Pay order per user', pendingOrdersMigration.includes("payment_orders_one_pending_milanpay_per_user_uidx") && pendingOrdersMigration.includes("gateway = 'milanpay' AND status = 'pending'")],
  ['Cashfree creation fails closed when duplicate pending orders exist',
    payRoute.includes('CASHFREE_PENDING_ORDER_RECONCILIATION_REQUIRED') &&
    payRoute.includes('LIMIT 2')],
  ['Paid Cashfree orders suppress repeat payment actions',
    payRoute.includes("localOrder.status === 'paid'") &&
    payRoute.includes('paymentActionRequired: false')],
  ['Cashfree payment status is confirmed against provider history',
    payRoute.includes('cashfree.getPaymentsForOrder(orderId)') &&
    payRoute.includes("'PAYMENT_STATUS_POLL'")],
  ['Cashfree config distinguishes disabled from ready checkout',
    payRoute.includes('cashfree.publicConfiguration()') &&
    cashfreeService.includes('CASHFREE_DISABLED')],
  ['Pending-order reconciliation SQL is read-only', pendingAudit.startsWith('-- READ-ONLY') && !/(?:^|\n)\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/im.test(pendingAudit)],
  ['Operations runbook requires zero duplicate groups before migration', paymentOpsDoc.includes('duplicate-group result must return **zero rows**') && paymentOpsDoc.includes('Do not remove or bypass that preflight')],
  ['Operations runbook documents bank integration prerequisite for automatic confirmation', paymentOpsDoc.includes('current UPI intent/QR protocol does not provide a trusted server-to-server settlement callback') && paymentOpsDoc.includes('authorised UPI partner')],
  ['Cashfree route does not construct direct UPI or Google Pay intents',
    !payRoute.includes('upi://pay?') && !payRoute.includes('gpay://upi/pay?')],
  ['Cashfree hosted checkout uses its payment session and no VPA-copy fallback',
    payPage.includes('cashfree.checkout({') &&
    payPage.includes('paymentSessionId: state.order.paymentSessionId') &&
    !payPage.includes('id="copyVpa"') &&
    !payPage.includes('id="copyAmount"')],
  ['Cashfree return URL is server-generated and restored using server payment status',
    cashfreeService.includes("returnUrl.searchParams.set('order_id', orderId)") &&
    payPage.includes('cashfree_return') &&
    payPage.includes('fetchOrderStatus(state.order.orderId)') &&
    payPage.includes('paymentSessionId: ""') &&
    !payPage.includes('sessionStorage.setItem("milanPaymentSessionId"')],
  ['Storage page links to MILAN Pay', storagePage.includes('/milan-pay?plan=')],
  ['Legacy hosted-payment route is not mounted', !server.includes("app.use('/api/payment'")],
  ['Direct UPI merchant setting is documented', env.includes('MILAN_PAY_UPI_ID=')],
  ['No dedicated hosted-payment SDK dependency is declared', !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(name => /(?:payment|gateway|checkout).*(?:sdk|client)|(?:sdk|client).*(?:payment|gateway|checkout)/i.test(name))],
  ['PostgreSQL migration creates the order link column', migration.includes('order_id text')],
  ['Migration creates a unique order link index', migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_order_id_uidx')],
  ['Migration enforces case-insensitive UTR uniqueness', migration.includes('storage_upgrade_requests_utr_normalized_uidx')],
  ['Migration checks order, user, plan and amount', migration.includes("v_order.gateway IS DISTINCT FROM 'milanpay'") && migration.includes('v_order.amount_inr IS DISTINCT FROM v_expected_amount')],
  ['Migration checks reused UTRs', migration.includes('This transaction reference has already been used.')],
  ['Migration updates payment and quota transactionally', migration.includes("status = 'paid'") && migration.includes('dwn_quota_bytes = GREATEST')],
  ['PostgreSQL role migration declares a least-privilege app role and non-login function owners',
    rolesMigration.includes('CREATE ROLE milan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS') &&
    rolesMigration.includes('CREATE ROLE milan_pay_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS') &&
    rolesMigration.includes('CREATE ROLE milan_rate_limit_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS')],
  ['PostgreSQL payment RPCs use a non-login owner and explicitly grant execution to milan_app',
    postgresqlMigration.includes('ALTER FUNCTION public.admin_approve_milan_pay_storage_request(text, text)\n  OWNER TO milan_pay_fn_owner;') &&
    postgresqlMigration.includes('ALTER FUNCTION public.admin_reject_milan_pay_storage_request(text, text)\n  OWNER TO milan_pay_fn_owner;') &&
    postgresqlMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)\n  TO milan_app;') &&
    postgresqlMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)\n  TO milan_app;') &&
    !postgresqlMigration.includes('TO CURRENT_USER;')],
  ['PostgreSQL runtime cannot write storage quota or plan columns directly',
    postgresqlMigration.includes('REVOKE INSERT, UPDATE ON TABLE public.users FROM milan_app;') &&
    postgresqlMigration.includes('GRANT INSERT (') &&
    postgresqlMigration.includes('GRANT UPDATE (') &&
    !/GRANT\\s+(?:SELECT,\\s*)?INSERT,\\s*UPDATE\\s+ON TABLE public\\.users\\s+TO milan_app/.test(postgresqlMigration)],
  ['PostgreSQL runtime cannot set payment or request status on insert',
    postgresqlMigration.includes('GRANT INSERT (user_id, order_id, plan, amount_inr, gateway, gateway_reference)') &&
    !postgresqlMigration.includes('GRANT UPDATE (status, reviewed_at, reviewer_note)') &&
    cashfreeMigration.includes('customer_phone, provider_idempotency_key, provider_request_payload') &&
    !/GRANT INSERT\s*\([^)]*\bstatus\b[^)]*\)\s*ON TABLE public\.payment_orders TO milan_app/s.test(cashfreeMigration) &&
    payRoute.includes('customer_phone, provider_idempotency_key, provider_request_payload)') &&
    storageRoute.includes('(user_id, order_id, plan, quota_bytes, amount_inr, payment_method, utr)')],
  ['Legacy rejection uses a guarded RPC and has no direct app status-update grant',
    storageRoute.includes('public.admin_reject_legacy_milan_storage_request') &&
    !/UPDATE\s+public\.storage_upgrade_requests/i.test(storageRoute) &&
    postgresqlMigration.includes('CREATE OR REPLACE FUNCTION public.admin_reject_legacy_milan_storage_request') &&
    /ALTER FUNCTION public\.admin_reject_legacy_milan_storage_request\(text, text\)\s+OWNER TO milan_pay_fn_owner;/.test(postgresqlMigration) &&
    /GRANT EXECUTE ON FUNCTION public\.admin_reject_legacy_milan_storage_request\(text, text\)\s+TO milan_app;/.test(postgresqlMigration) &&
    !/GRANT UPDATE\s*\(status, reviewed_at, reviewer_note\)\s+ON TABLE public\.storage_upgrade_requests TO milan_app;/.test(postgresqlMigration)],
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
