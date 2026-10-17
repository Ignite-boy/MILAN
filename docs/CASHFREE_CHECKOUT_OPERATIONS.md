# Cashfree Hosted Checkout Operations

Cashfree is the active hosted checkout for MILAN storage plans. MILAN Pay checkout routes and upgrade-page links have been retired; legacy source files and historical payment records are preserved. Existing historical payments must not be deleted or reset.

## Configuration

Set these values in the hosting provider's secret manager, never in frontend code or committed secrets:

- `CASHFREE_ENVIRONMENT=sandbox` while testing.
- `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET` from the Cashfree sandbox dashboard.
- `CASHFREE_API_VERSION=2025-01-01`.

The configured environment must be exactly `sandbox` or `production`. Vercel Preview deployments are sandbox-only and use their own `VERCEL_URL` for the browser return URL, avoiding cross-environment redirects to production. By default, Cashfree webhooks use that host too; if Vercel Deployment Protection blocks provider POSTs, set `CASHFREE_WEBHOOK_URL` to an HTTPS webhook endpoint that is publicly reachable for the test environment. The endpoint still verifies Cashfree's HMAC signature; do not put protection-bypass tokens in the URL. The `/api/payment/config` endpoint returns only the client ID and public plan details; it never returns the client secret.

The checkout supports the server-defined 500 MB plan for ₹250 and 1 GB plan for ₹500. Prices are deliberately fixed in both application code and the atomic database function. Do not change only one side of that contract. Cashfree's `customer_phone` contract is 10 digits; checkout accepts 10 digits, strips a `+91` prefix or leading `0`, and rejects unsupported lengths before order creation. Customer names are sanitized before being sent to Cashfree. Each MILAN order also gets a deterministic UUIDv5 `x-idempotency-key`, reused for retries of that same order and distinct across MILAN order IDs.

## Before applying the database migration

1. Back up the production database and inspect current Cashfree order/payment-reference rows.
2. Run a read-only duplicate-reference audit for non-null `gateway_reference` values where `gateway = 'cashfree'`.
3. Confirm the audit returns zero duplicate groups. The migration intentionally aborts if it finds duplicates.
4. Review `backend/migrations/20261018_cashfree_atomic_activation.sql` and apply it as a controlled database change. It is **not** run by the app at startup or by this branch.
5. Do not create a one-pending-order-per-user index for Cashfree: historical pending orders must be preserved and reconciled, not deleted or reset.

The migration adds a Cashfree-only unique transaction-reference index, a service-role-only order-reservation RPC that locks the user row to serialize concurrent checkout requests, and a service-role-only activation RPC that atomically locks the order and user, validates the stored plan and actual provider amount, upgrades quota, and marks the order paid. MILAN Pay references are outside the Cashfree-only index. The reservation RPC rejects an account that already has sufficient quota and returns a reconciliation conflict when another pending Cashfree order exists.

## Sandbox verification checklist

- [ ] Confirm Cashfree sandbox credentials are configured and the endpoint reports `environment: sandbox`.
- [ ] Sign in with a dedicated test user and open `/storage-upgrade-cashfree.html`.
- [ ] Verify a valid checkout session is opened from a server-created order; the browser never supplies the final price.
- [ ] Complete a Cashfree sandbox payment and wait for server verification/webhook confirmation.
- [ ] Confirm the order becomes paid and quota changes once; re-delivery of the same signed webhook must be idempotent.
- [ ] Verify wrong signatures, missing payment ID/amount, wrong currency, amount mismatches, and non-Cashfree order IDs do not activate storage.
- [ ] Verify a failed payment attempt alone does not terminally fail the whole Cashfree order.
- [ ] Test pending-order recovery: resume an active provider order, verify and atomically activate a provider-paid order after a missed webhook, and require reconciliation for multiple/stale pending rows without deleting records.
- [ ] Verify an `EXPIRED` or `TERMINATED` Cashfree order is marked failed only after the provider payment list has no `SUCCESS` or `PENDING` payment; the customer can then create a new order without stale return URL parameters.
- [ ] Test two simultaneous checkout requests for the same account; the database reservation lock must allow at most one new pending Cashfree order.
- [ ] Run `npm run test:payment`, `npm run test:milan-pay`, `npm run test:security`, and `npm run build`.

## Production go-live gate

Do not switch `CASHFREE_ENVIRONMENT` to `production` until production credentials have been issued, the merchant account and desired payment methods have been approved/activated, the webhook endpoint is configured in Cashfree, the migration has been reviewed and applied, and the sandbox checklist passes. Payment method availability—including cards or international methods—is controlled by the merchant configuration and Cashfree eligibility; this code does not imply those methods are enabled.

Never deploy or apply the SQL migration solely because this documentation exists.
