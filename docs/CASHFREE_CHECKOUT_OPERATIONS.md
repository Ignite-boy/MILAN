# Cashfree Hosted Checkout Operations

This integration adds a separate Cashfree hosted checkout for MILAN storage plans. It does not replace the existing MILAN Pay direct-UPI/manual-bank-verification flow.

## Configuration

Set these values in the hosting provider's secret manager, never in frontend code or committed secrets:

- `CASHFREE_ENVIRONMENT=sandbox` while testing.
- `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET` from the Cashfree sandbox dashboard.
- `CASHFREE_API_VERSION=2025-01-01`.

The configured environment must be exactly `sandbox` or `production`. The `/api/payment/config` endpoint returns only the client ID and public plan details; it never returns the client secret.

The checkout supports the server-defined 500 MB plan for ₹250 and 1 GB plan for ₹500. Prices are deliberately fixed in both application code and the atomic database function. Do not change only one side of that contract.

## Before applying the database migration

1. Back up the production database and inspect current Cashfree order/payment-reference rows.
2. Run a read-only duplicate-reference audit for non-null `gateway_reference` values where `gateway = 'cashfree'`.
3. Confirm the audit returns zero duplicate groups. The migration intentionally aborts if it finds duplicates.
4. Review `backend/migrations/20261018_cashfree_atomic_activation.sql` and apply it as a controlled database change. It is **not** run by the app at startup or by this branch.
5. Do not create a one-pending-order-per-user index for Cashfree: historical pending orders must be preserved and reconciled, not deleted or reset.

The migration adds a Cashfree-only unique transaction-reference index and a service-role-only RPC that atomically locks the order and user, validates the stored plan and actual provider amount, upgrades quota, and marks the order paid. MILAN Pay references are outside that index.

## Sandbox verification checklist

- [ ] Confirm Cashfree sandbox credentials are configured and the endpoint reports `environment: sandbox`.
- [ ] Sign in with a dedicated test user and open `/storage-upgrade-cashfree.html`.
- [ ] Verify a valid checkout session is opened from a server-created order; the browser never supplies the final price.
- [ ] Complete a Cashfree sandbox payment and wait for server verification/webhook confirmation.
- [ ] Confirm the order becomes paid and quota changes once; re-delivery of the same signed webhook must be idempotent.
- [ ] Verify wrong signatures, missing payment ID/amount, wrong currency, amount mismatches, and non-Cashfree order IDs do not activate storage.
- [ ] Verify a failed payment attempt alone does not terminally fail the whole Cashfree order.
- [ ] Test repeated order creation: one existing active pending order may be resumed; multiple/stale pending orders return a reconciliation response without creating a duplicate or deleting records.
- [ ] Run `npm run test:payment`, `npm run test:milan-pay`, `npm run test:security`, and `npm run build`.

## Production go-live gate

Do not switch `CASHFREE_ENVIRONMENT` to `production` until production credentials have been issued, the merchant account and desired payment methods have been approved/activated, the webhook endpoint is configured in Cashfree, the migration has been reviewed and applied, and the sandbox checklist passes. Payment method availability—including cards or international methods—is controlled by the merchant configuration and Cashfree eligibility; this code does not imply those methods are enabled.

Never deploy or apply the SQL migration solely because this documentation exists.
