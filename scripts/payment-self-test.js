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
const voroaMigration = read('backend/migrations/20261019_voroa_milan_pay.sql');
const rolesMigration = read('backend/migrations/20261019_voroa_00_roles.sql');
const pendingOrdersMigration = read('backend/migrations/20261015_milan_pay_single_pending_order.sql');
const pendingAudit = read('scripts/milan-pay-pending-audit.sql');
const paymentOpsDoc = read('docs/MILAN_PAY_OPERATIONS.md');

const checks = [
  ['Payment routes use Voroa PostgreSQL and no Supabase SDK',
    !payRoute.includes('@supabase/supabase-js') &&
    !storageRoute.includes('@supabase/supabase-js') &&
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
  ['Pending orders pin the selected merchant VPA', payRoute.includes("gateway_reference") && payRoute.includes("INSERT INTO public.payment_orders")],
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
  ['Order creation and restore fail closed when duplicate pending orders exist', payRoute.includes("MILAN_PAY_PENDING_ORDER_RECONCILIATION_REQUIRED") && payRoute.includes("LIMIT 2")],
  ['Order status suppresses payment links when a verification request already exists', payRoute.includes("paymentActionRequired: false") && payRoute.includes("Do not pay again")],
  ['Order reuse never issues a fresh QR after any verification request is already linked',
    payRoute.includes("code: 'MILAN_PAY_ORDER_VERIFICATION_ALREADY_SUBMITTED'") &&
    payRoute.includes("WHERE order_id = $1") && payRoute.includes("[pendingOrder.order_id]") &&
    payRoute.includes('A verification request already exists for this order. Do not pay again')],
  ['Config clearly distinguishes unverified merchant setup from automatic confirmation', payRoute.includes("merchantVerificationStatus: ready ? 'configured-unverified'") && payRoute.includes("automaticPaymentConfirmationAvailable: false")],
  ['Pending-order reconciliation SQL is read-only', pendingAudit.startsWith('-- READ-ONLY') && !/(?:^|\n)\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/im.test(pendingAudit)],
  ['Operations runbook requires zero duplicate groups before migration', paymentOpsDoc.includes('duplicate-group result must return **zero rows**') && paymentOpsDoc.includes('Do not remove or bypass that preflight')],
  ['Operations runbook documents bank integration prerequisite for automatic confirmation', paymentOpsDoc.includes('current UPI intent/QR protocol does not provide a trusted server-to-server settlement callback') && paymentOpsDoc.includes('authorised UPI partner')],
  ['Google Pay iOS intent requires configured bank MCC', payRoute.includes("gpay://upi/pay?") && payRoute.includes("merchantMcc()") && payRoute.includes("MILAN_PAY_MCC")],
  ['Copy-payment fallback available for VPA amount and order reference', payPage.includes('id="copyVpa"') && payPage.includes('id="copyAmount"') && payPage.includes('id="copyOrderId"')],
  ['Restored checkout URI is rebuilt by the server', payPage.includes("Never trust the payment URI from sessionStorage") && payPage.includes("data.upiUri")],
  ['Storage page links to MILAN Pay', storagePage.includes('/milan-pay?plan=')],
  ['Legacy hosted-payment route is not mounted', !server.includes("app.use('/api/payment'")],
  ['Direct UPI merchant setting is documented', env.includes('MILAN_PAY_UPI_ID=')],
  ['No dedicated hosted-payment SDK dependency is declared', !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(name => /(?:payment|gateway|checkout).*(?:sdk|client)|(?:sdk|client).*(?:payment|gateway|checkout)/i.test(name))],
  ['Migration adds the order link column', migration.includes('ADD COLUMN IF NOT EXISTS order_id')],
  ['Migration creates a unique order link index', migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_order_id_uidx')],
  ['Migration enforces case-insensitive UTR uniqueness', migration.includes('storage_upgrade_requests_utr_normalized_uidx')],
  ['Migration checks order, user, plan and amount', migration.includes("v_order.gateway IS DISTINCT FROM 'milanpay'") && migration.includes('v_order.amount_inr IS DISTINCT FROM v_expected_amount')],
  ['Migration checks reused UTRs', migration.includes('This transaction reference has already been used.')],
  ['Migration updates payment and quota transactionally', migration.includes("status = 'paid'") && migration.includes('dwn_quota_bytes = GREATEST')],
  ['Legacy Supabase migration grants the RPC to service role', migration.includes('REVOKE ALL ON FUNCTION public.admin_approve_milan_pay_storage_request') && migration.includes('TO service_role')],
  ['Voroa role migration declares a least-privilege app role and non-login function owners',
    rolesMigration.includes('CREATE ROLE milan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS') &&
    rolesMigration.includes('CREATE ROLE milan_pay_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS') &&
    rolesMigration.includes('CREATE ROLE milan_rate_limit_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS')],
  ['Voroa payment RPCs use a non-login owner and explicitly grant execution to milan_app',
    voroaMigration.includes('ALTER FUNCTION public.admin_approve_milan_pay_storage_request(text, text)\n  OWNER TO milan_pay_fn_owner;') &&
    voroaMigration.includes('ALTER FUNCTION public.admin_reject_milan_pay_storage_request(text, text)\n  OWNER TO milan_pay_fn_owner;') &&
    voroaMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)\n  TO milan_app;') &&
    voroaMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)\n  TO milan_app;') &&
    !voroaMigration.includes('TO CURRENT_USER;')],
  ['Voroa runtime cannot write storage quota or plan columns directly',
    voroaMigration.includes('REVOKE INSERT, UPDATE ON TABLE public.users FROM milan_app;') &&
    voroaMigration.includes('GRANT INSERT (') &&
    voroaMigration.includes('GRANT UPDATE (') &&
    !/GRANT\\s+(?:SELECT,\\s*)?INSERT,\\s*UPDATE\\s+ON TABLE public\\.users\\s+TO milan_app/.test(voroaMigration)],
  ['Voroa runtime cannot set payment or request status on insert',
    voroaMigration.includes('GRANT INSERT (user_id, order_id, plan, amount_inr, gateway, gateway_reference)') &&
    !voroaMigration.includes('GRANT UPDATE (status, reviewed_at, reviewer_note)') &&
    payRoute.includes('(user_id, order_id, plan, amount_inr, gateway, gateway_reference)') &&
    storageRoute.includes('(user_id, order_id, plan, quota_bytes, amount_inr, payment_method, utr)')],
  ['Legacy rejection uses a guarded RPC and has no direct app status-update grant',
    storageRoute.includes('public.admin_reject_legacy_milan_storage_request') &&
    !/UPDATE\s+public\.storage_upgrade_requests/i.test(storageRoute) &&
    voroaMigration.includes('CREATE OR REPLACE FUNCTION public.admin_reject_legacy_milan_storage_request') &&
    /ALTER FUNCTION public\.admin_reject_legacy_milan_storage_request\(text, text\)\s+OWNER TO milan_pay_fn_owner;/.test(voroaMigration) &&
    /GRANT EXECUTE ON FUNCTION public\.admin_reject_legacy_milan_storage_request\(text, text\)\s+TO milan_app;/.test(voroaMigration) &&
    !/GRANT UPDATE\s*\(status, reviewed_at, reviewer_note\)\s+ON TABLE public\.storage_upgrade_requests TO milan_app;/.test(voroaMigration)],
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
