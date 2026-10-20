# MILAN Pay operational hardening runbook

## Current production mode

MILAN Pay creates direct UPI intent/QR instructions. It is **not** an acquiring bank integration and must not mark an order paid from a deep-link return, QR display, client response, or customer-entered UTR alone. Current approval remains manual: an authorised administrator checks the incoming transaction in the receiving bank/acquirer records and then approves the linked request.

The public configuration endpoint reports whether a VPA looks syntactically valid. That check does **not** prove merchant onboarding, settlement eligibility, bank credit, or payment success. Cards and international processing are not supported by this direct UPI flow.

## 1. Reconcile pending orders before applying the single-pending-order index

1. Connect to the production Voroa PostgreSQL database with an appropriately privileged SQL role.
2. Run the read-only script in `scripts/milan-pay-pending-audit.sql`. It lists pending order IDs, plan/amount/time, whether a recipient reference is set, and whether a UTR/verification request is linked. It also lists duplicate-order groups. It performs no writes.
3. For each order, check the receiving merchant bank account/acquirer statement around the order timestamp. Search by credit amount, transaction reference/remarks if present, and the actual settlement/credit record. A missing UTR in MILAN is **not** proof that the bank was not credited.
4. If a matching credit exists, do not mark that order failed. Contact the account holder through the normal support process to recover the transaction reference and complete a controlled review. Do not create a paid status from the UPI app's "success" screen alone.
5. If there is no matching credit, verify the statement for the full relevant date/time window and confirm there is no linked verification request before resolving that exact order as failed. Do not bulk-expire all pending orders by age. Preserve the order ID and reconciliation outcome in an internal support/audit record.
6. Re-run the audit SQL. The duplicate-group result must return **zero rows** before attempting the migration.

**Legacy recipient safeguard:** pending orders with a null/blank `gateway_reference` are now blocked from payment-link reuse and status restoration. Do not fill them with the current `MILAN_PAY_UPI_ID` merely to unblock checkout. Reconcile the exact order and bank records first; only a confirmed historical recipient may be repaired through an approved, audited operator procedure. New orders already pin the VPA used at creation.

**Submitted-UTR safeguard:** when any verification request is already linked to a pending order, order creation returns a conflict instead of issuing another QR. If the request/order statuses disagree, reconcile the records; do not ask the customer to pay again.

Do not paste bank statements, account numbers, authentication headers, or secrets into chat or issues.

## 2. Apply and verify the database safeguard

After duplicate pending orders have been independently reconciled, run this from the repository shell configured with the intended Voroa PostgreSQL connection:

```bash
cd /mnt/d/milan/MILAN
psql "$MILAN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/20261015_milan_pay_single_pending_order.sql
```

The migration intentionally raises an exception if duplicates still exist. Do not remove or bypass that preflight.

Verify the index:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'payment_orders_one_pending_milanpay_per_user_uidx';
```

Re-run `scripts/milan-pay-pending-audit.sql`; its duplicate-group result must still return zero rows. The unique partial index is the concurrency backstop; application checks alone are not sufficient.

## 3. Merchant configuration and Google Pay iOS

1. Confirm with the acquiring bank that the configured VPA is authorised to receive merchant/P2M collections and settles into the expected receiving account. A personal UPI ID that accepts transfers is not, by itself, evidence of merchant onboarding.
2. Obtain the 4-digit MCC assigned to this merchant by the acquiring bank. Do not guess or borrow another merchant's MCC.
3. In the production secret/environment settings, set `MILAN_PAY_UPI_ID`, `MILAN_PAY_MERCHANT_NAME`, and `MILAN_PAY_MCC` to the bank-confirmed values. Keep `MILAN_PAY_GOOGLE_PAY_IOS_ENABLED=false` until merchant onboarding and iPhone Safari/GPay testing are complete.
4. Only then set `MILAN_PAY_GOOGLE_PAY_IOS_ENABLED=true` and redeploy. The API intentionally requires both the bank MCC and the explicit opt-in to return a `gpay://` URI.
5. Check the public config endpoint, but never treat it as a bank connectivity/payment test. The configuration field `merchantVerificationStatus: configured-unverified` remains until a genuine bank verification process exists.

Google's iOS UPI-intent documentation says the `gpay://` URI follows the Android UPI intent parameters and iOS users may need to switch manually back to the merchant app after paying. A return to MILAN is not payment evidence. See [Google Pay for India — iOS in-app payments](https://developers.google.com/pay/india/api/ios/in-app-payments) and [NPCI UPI FAQ](https://www.npci.org.in/what-we-do/upi/faqs).

## 4. Real-device checkout test matrix

Run this only with an approved test account and an operator-controlled payer account, understanding that this is a real transfer at the configured ₹250 / ₹500 amount. Do not use customer funds or label an unverified app-screen result as success.

- Android Chrome: tap UPI intent, verify recipient VPA/name/amount/reference before paying, submit the transaction reference, and confirm the order remains pending until an administrator matches the bank credit.
- iPhone Safari: exercise the generic UPI fallback and (only when explicitly enabled) the Google Pay iOS shortcut; manually return to Safari and confirm the order remains pending until bank verification.
- Android tablet and iPad Safari: test responsive layout, copy VPA/amount/reference, QR visibility, focus/keyboard behavior, and recovery after refresh.
- Desktop: scan the displayed QR with a separate trusted phone; verify the receiver and amount before paying; then test UTR submission and refresh/recovery.
- For each successful bank credit, match the bank statement to the unique order reference, approve through the admin workflow, and verify the request becomes approved, the order becomes paid, and quota changes exactly once. For cancellation/failure, confirm no quota upgrade occurs.
- Never test by manually setting order status to paid or by trusting the frontend redirect/deep-link return.

## 5. Automatic bank payment confirmation without a payment gateway

The current UPI intent/QR protocol does not provide a trusted server-to-server settlement callback by itself. To automate confirmation while continuing to avoid third-party payment gateways, MILAN needs the acquiring bank's or authorised UPI partner's direct merchant API contract and onboarding. The bank must provide documentation, credentials/certificate requirements, transaction-status lookup or signed callback mechanism, and the merchant identifiers.

Only after those are available should an adapter be implemented with: authenticated signature/mTLS verification as required by the bank, strict amount/currency/order/reference matching, idempotent duplicate event handling, replay protection, pending/failed/paid state transitions inside a transaction, reconciliation jobs for delayed callbacks, secure audit logs, and alerting. No endpoint should accept a client-supplied `bankVerified` value as proof of settlement.

Until that integration exists, report automatic confirmation as **not available** and keep manual bank verification fail-closed. This is a genuine external dependency, not something a code-only change can safely fake.

## 6. Shared API rate limiting rollout and rollback

Sensitive payment and storage routes support an optional shared PostgreSQL rate limiter. Until explicitly enabled, they continue using the existing process-local limiter.

Configured per-IP, per-route limits:
- MILAN Pay order creation: 8 requests per 60 seconds.
- MILAN Pay order status: 60 requests per 60 seconds.
- Storage upgrade / UTR submission: 6 requests per 60 seconds.
- Admin storage actions: 30 requests per 60 seconds.

### Prerequisites

1. Review `backend/migrations/20261019_voroa_distributed_rate_limit.sql` against the intended Voroa PostgreSQL schema before applying it.
2. Apply the migration to Voroa PostgreSQL using an appropriately privileged database role, for example with `psql "$MILAN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/20261019_voroa_distributed_rate_limit.sql`. Do not execute it against an unverified project.
3. Verify that `public.api_rate_limit_buckets` exists, RLS is enabled, and the `public.consume_api_rate_limit(text, integer, integer)` function exists.
4. Verify permissions: `PUBLIC` must not execute the RPC or access the bucket table directly. The `milan_app` role should receive only the RPC execute grant; the non-login `milan_rate_limit_fn_owner` role should retain the required table access.
5. Generate a random HMAC secret with at least 32 characters using a secure local generator. Store it in Voroa's encrypted production environment as `MILAN_PAY_RATE_LIMIT_HMAC_SECRET`. Never commit it or paste it into chat, logs, issues, or this runbook.
6. Keep `MILAN_PAY_SHARED_RATE_LIMIT_ENABLED=false` or unset while deploying the reviewed code and verifying the migration and secret configuration.

### Controlled enablement

1. Confirm the migration and permissions checks passed, and that the deployed code contains the shared middleware.
2. Set `MILAN_PAY_RATE_LIMIT_HMAC_SECRET` and `MILAN_PAY_SHARED_RATE_LIMIT_ENABLED=true` in the Voroa production service environment, then deploy/restart the service so the Node runtime receives those values.
3. Verify a normal unauthenticated request to a protected endpoint is still rejected by authentication, while the response includes rate-limit headers. Do not perform repeated high-volume tests on the live production domain.
4. Validate threshold and cross-instance behavior in a staging environment or with an approved low-impact test plan. Mocked unit tests alone do not establish that the production PostgreSQL RPC works.
5. Monitor HTTP 429 and 503 responses, Voroa PostgreSQL RPC/database errors, latency, and table growth. A 503 in shared mode means the limiter could not validate the request; it must not be bypassed.

The middleware uses an HMAC-derived key, not the raw IP, in database rows. The secret must remain stable during normal operation; rotating it creates new bucket identities and should be planned. Validate that Express `req.ip` represents the intended client address behind Voroa's reverse proxy before relying on per-IP limits.

### Rollback

If shared rate limiting causes unexpected 503s or database errors:

1. Set `MILAN_PAY_SHARED_RATE_LIMIT_ENABLED=false` in the Production environment and redeploy.
2. Confirm that protected endpoints return to the existing process-local rate limiter and retain authentication checks.
3. Keep the migration table and function in place during investigation. Do not drop them as an emergency rollback.
4. Investigate database connectivity, RPC permissions, the configured HMAC secret, proxy/IP behavior, and rate-limit latency before attempting enablement again.

Turning the flag off restores local per-instance limits; it does not provide distributed enforcement. Keep the existing global API limiter and the route authentication middleware in place throughout rollback and recovery.
