'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pay = read('backend/routes/milanPay.js');
const storage = read('backend/routes/storage.js');
const migration = read('backend/migrations/20261019_voroa_milan_pay.sql');
const pendingMigration = read('backend/migrations/20261015_milan_pay_single_pending_order.sql');
const roles = read('backend/migrations/20261019_voroa_00_roles.sql');
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/milan-ci.yml');

function between(source, from, to, label) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${label}: section boundaries must exist`);
  return source.slice(start, end);
}

const createOrder = between(
  pay, "router.post('/orders',", "router.get('/orders/:orderId/status',", 'create order route'
);
const orderStatus = between(
  pay, "router.get('/orders/:orderId/status',", 'module.exports = router;', 'order status route'
);
const submitRequest = between(
  storage, "router.post('/upgrade-request',", "router.get('/upgrade-status',", 'upgrade request route'
);
const approveRoute = between(
  storage, "router.post('/admin/requests/:id/approve',",
  "router.post('/admin/requests/:id/reject',", 'approve route'
);
const rejectRoute = between(
  storage, "router.post('/admin/requests/:id/reject',",
  'module.exports = router;', 'reject route'
);
const approveRpc = between(
  migration, 'CREATE OR REPLACE FUNCTION public.admin_approve_milan_pay_storage_request(',
  'CREATE OR REPLACE FUNCTION public.admin_reject_milan_pay_storage_request(', 'approval RPC'
);
const rejectRpc = between(
  migration, 'CREATE OR REPLACE FUNCTION public.admin_reject_milan_pay_storage_request(',
  'CREATE OR REPLACE FUNCTION public.admin_reject_legacy_milan_storage_request(', 'rejection RPC'
);

let failures = 0;
let passed = 0;
function check(label, condition) {
  try {
    assert.ok(condition, label);
    passed += 1;
    console.log(`PASS: ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

check('A08 regression suite is registered in package.json',
  pkg.scripts?.['test:payment-idempotency'] === 'node scripts/payment-idempotency-self-test.js');

check('CI runs payment idempotency checks as an independent build step',
  workflow.includes('Verify payment idempotency and quota invariants') &&
  workflow.includes('run: npm run test:payment-idempotency'));

check('Order creation is authenticated and rate-limited',
  pay.includes("router.post('/orders', createOrderRateLimiter, auth"));

check('New payment order insert cannot set caller-controlled status',
  /INSERT INTO public\.payment_orders\s*\(\s*user_id,\s*order_id,\s*plan,\s*amount_inr,\s*gateway,\s*gateway_reference\s*\)/s.test(createOrder) &&
  !/INSERT INTO public\.payment_orders\s*\([^)]*\bstatus\b/is.test(createOrder));

check('New orders remain pending until independent verification',
  createOrder.includes("status: 'pending'") &&
  approveRpc.includes("SET status = 'paid'"));

check('Concurrent pending-order creation is protected by a partial unique index',
  pendingMigration.includes('payment_orders_one_pending_milanpay_per_user_uidx') &&
  /ON public\.payment_orders\s*\(user_id\)\s*WHERE gateway = 'milanpay' AND status = 'pending'/s.test(pendingMigration) &&
  createOrder.includes("error.code === '23505'"));

check('Order restore is scoped to authenticated owner and gateway',
  /WHERE order_id = \$1 AND user_id = \$2 AND gateway = 'milanpay'/s.test(orderStatus) &&
  orderStatus.includes('if (!data) return res.status(404)'));

check('UTR submission is authenticated and rate-limited',
  storage.includes("router.post('/upgrade-request', submitUpgradeRequestLimiter, auth"));

check('UTR submission validates the server-owned order against the caller',
  /WHERE order_id = \$1 AND user_id = \$2/s.test(submitRequest) &&
  submitRequest.includes("order.gateway !== 'milanpay'") &&
  submitRequest.includes("order.status !== 'pending'") &&
  submitRequest.includes('order.plan !== planKey') &&
  submitRequest.includes('Number(order.amount_inr) !== plan.amountInr'));

check('UTR format is validated and duplicate insert races return conflict',
  submitRequest.includes("! /^[A-Za-z0-9._-]{6,80}$/.test(utr)") === false &&
  submitRequest.includes("error.code === '23505'"));

check('Database has unique normalized UTR and order-to-request constraints',
  migration.includes('storage_upgrade_requests_order_id_uidx') &&
  migration.includes('storage_upgrade_requests_utr_normalized_uidx') &&
  /ON public\.storage_upgrade_requests\s*\(lower\(btrim\(utr\)\)\)/s.test(migration));

check('Admin approval fails closed without explicit bank verification',
  approveRoute.includes('req.body?.bankVerified !== true') &&
  storage.includes('function adminRequired') &&
  storage.includes("req.headers['x-admin-token']") &&
  storage.includes('crypto.timingSafeEqual'));

check('Admin approve/reject routes delegate transitions to database RPCs',
  approveRoute.includes('public.admin_approve_milan_pay_storage_request') &&
  rejectRoute.includes('public.admin_reject_milan_pay_storage_request') &&
  !/UPDATE\s+public\.(?:payment_orders|storage_upgrade_requests|users)/i.test(approveRoute + rejectRoute));

check('Approval RPC is SECURITY DEFINER with fixed search_path',
  approveRpc.includes('SECURITY DEFINER') &&
  approveRpc.includes('SET search_path = pg_catalog, pg_temp'));

check('Approval locks request, order, and account rows against concurrent transitions',
  (approveRpc.match(/FOR UPDATE;/g) || []).length >= 3 &&
  approveRpc.includes('WHERE id::text = p_request_id') &&
  /WHERE order_id = v_request\.order_id\s+AND user_id = v_request\.user_id\s+FOR UPDATE;/s.test(approveRpc) &&
  /WHERE user_id = v_request\.user_id\s+FOR UPDATE;/s.test(approveRpc));

check('Approval rejects any request not in pending state',
  approveRpc.includes("v_request.status IS DISTINCT FROM 'pending'"));

check('Approval verifies gateway, pending order status, owner, plan, amount, and quota',
  approveRpc.includes("v_order.gateway IS DISTINCT FROM 'milanpay'") &&
  approveRpc.includes("v_order.status IS DISTINCT FROM 'pending'") &&
  /WHERE order_id = v_request\.order_id\s+AND user_id = v_request\.user_id\s+FOR UPDATE;/s.test(approveRpc) &&
  approveRpc.includes('v_order.plan IS DISTINCT FROM v_request.plan') &&
  approveRpc.includes('v_order.amount_inr IS DISTINCT FROM v_expected_amount') &&
  approveRpc.includes('v_request.quota_bytes IS DISTINCT FROM v_target_quota') &&
  approveRpc.includes('v_current_quota >= v_target_quota'));

check('Approval uses monotonic quota activation',
  /SET dwn_quota_bytes = GREATEST\(v_current_quota, v_target_quota\)/s.test(approveRpc));

check('Payment activation is conditional on pending state and owner, and failure rolls back',
  /UPDATE public\.payment_orders\s+SET status = 'paid'[\s\S]*?WHERE order_id = v_request\.order_id[\s\S]*?AND user_id = v_request\.user_id[\s\S]*?AND gateway = 'milanpay'[\s\S]*?AND status = 'pending'[\s\S]*?RETURNING \* INTO v_order;/s.test(approveRpc) &&
  approveRpc.includes('Payment order could not be finalized; transaction rolled back.'));

check('Request approval is conditional on pending state and checked for failure',
  /UPDATE public\.storage_upgrade_requests\s+SET status = 'approved'[\s\S]*?WHERE id = v_request\.id[\s\S]*?AND status = 'pending'[\s\S]*?RETURNING \* INTO v_request;/s.test(approveRpc) &&
  approveRpc.includes('Storage request could not be finalized; transaction rolled back.'));

check('Rejection RPC locks request and order and cannot reject an already approved request',
  rejectRpc.includes('FOR UPDATE;') &&
  rejectRpc.includes("v_request.status IS DISTINCT FROM 'pending'") &&
  rejectRpc.includes('Only pending or failed payment orders may be rejected.'));

check('Rejection only transitions pending orders to failed and pending requests to rejected',
  /UPDATE public\.payment_orders\s+SET status = 'failed'[\s\S]*?AND status = 'pending'[\s\S]*?RETURNING \* INTO v_order;/s.test(rejectRpc) &&
  /UPDATE public\.storage_upgrade_requests\s+SET status = 'rejected'[\s\S]*?AND status = 'pending'[\s\S]*?RETURNING \* INTO v_request;/s.test(rejectRpc));

check('Payment RPC execution is restricted to the application role',
  migration.includes('OWNER TO milan_pay_fn_owner;') &&
  migration.includes('GRANT EXECUTE ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)') &&
  migration.includes('TO milan_app;') &&
  migration.includes('REVOKE ALL ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)'));

check('Runtime role cannot directly change payment status or storage entitlement',
  migration.includes('REVOKE INSERT, UPDATE ON TABLE public.users FROM milan_app;') &&
  migration.includes('REVOKE INSERT, UPDATE ON TABLE public.payment_orders FROM milan_app;') &&
  migration.includes('REVOKE INSERT, UPDATE ON TABLE public.storage_upgrade_requests FROM milan_app;') &&
  migration.includes('GRANT INSERT (user_id, order_id, plan, amount_inr, gateway, gateway_reference)'));

check('Manual UPI mode does not claim automatic settlement confirmation',
  pay.includes("verificationMode: 'manual-bank-verification'") &&
  pay.includes('automaticPaymentConfirmationAvailable: false') &&
  !/status:\s*['"]paid['"]/.test(pay));

check('Test scope includes the current payment and role migrations',
  fs.existsSync(path.join(root, 'backend/migrations/20261019_voroa_milan_pay.sql')) &&
  fs.existsSync(path.join(root, 'backend/migrations/20261019_voroa_00_roles.sql')));

console.log(`A08 PAYMENT IDEMPOTENCY SELF-TEST: ${passed} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
