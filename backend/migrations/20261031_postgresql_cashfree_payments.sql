BEGIN;

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS cf_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_session_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS provider_request_payload jsonb,
  ADD COLUMN IF NOT EXISTS customer_phone text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_cashfree_cf_order_uidx
  ON public.payment_orders (cf_order_id)
  WHERE gateway = 'cashfree' AND cf_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_cashfree_idempotency_uidx
  ON public.payment_orders (provider_idempotency_key)
  WHERE gateway = 'cashfree' AND provider_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_cashfree_provider_payment_uidx
  ON public.payment_orders (provider_payment_id)
  WHERE gateway = 'cashfree' AND provider_payment_id IS NOT NULL;

-- The ALTER TABLE above holds its lock until this migration transaction ends.
-- Fail with an actionable diagnostic if old Cashfree rows violate the invariant.
DO $cashfree_pending_preflight$
DECLARE
  v_user_id text;
  v_pending_count integer;
BEGIN
  SELECT user_id::text, COUNT(*)::integer
    INTO v_user_id, v_pending_count
    FROM public.payment_orders
   WHERE gateway = 'cashfree'
     AND status = 'pending'
   GROUP BY user_id
  HAVING COUNT(*) > 1
   ORDER BY COUNT(*) DESC, user_id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cashfree pending-order duplicates detected for user_id %, pending orders %.',
      v_user_id, v_pending_count
      USING ERRCODE = '23514',
            HINT = 'Run scripts/milan-pay-pending-audit.sql. Reconcile affected orders without deleting unresolved payment records, then rerun the migration.';
  END IF;
END;
$cashfree_pending_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_pending_cashfree_per_user_uidx
  ON public.payment_orders (user_id)
  WHERE gateway = 'cashfree' AND status = 'pending';

CREATE TABLE IF NOT EXISTS public.cashfree_payment_events (
  cf_payment_id text PRIMARY KEY,
  webhook_idempotency_key text,
  cf_order_id text NOT NULL,
  order_id text NOT NULL REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  order_amount numeric(12,2) NOT NULL CHECK (order_amount > 0),
  payment_amount numeric(12,2) NOT NULL CHECK (payment_amount > 0),
  order_currency text NOT NULL CHECK (char_length(order_currency) = 3),
  payment_currency text NOT NULL CHECK (char_length(payment_currency) = 3),
  payment_status text NOT NULL,
  payment_group text,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'review_required')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS cashfree_payment_events_webhook_idempotency_uidx
  ON public.cashfree_payment_events (webhook_idempotency_key)
  WHERE webhook_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS cashfree_payment_events_order_idx
  ON public.cashfree_payment_events (order_id, received_at DESC);

REVOKE ALL ON TABLE public.cashfree_payment_events FROM PUBLIC, milan_app;

GRANT SELECT, UPDATE ON TABLE
  public.payment_orders, public.users TO milan_pay_fn_owner;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.cashfree_payment_events TO milan_pay_fn_owner;

CREATE OR REPLACE FUNCTION public.attach_cashfree_order(
  p_order_id text,
  p_user_id text,
  p_cf_order_id text,
  p_payment_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_order_id), '') IS NULL
     OR NULLIF(btrim(p_user_id), '') IS NULL
     OR NULLIF(btrim(p_cf_order_id), '') IS NULL
     OR length(p_cf_order_id) > 100
     OR NULLIF(btrim(p_payment_session_id), '') IS NULL
     OR length(p_payment_session_id) > 2048 THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400, 'error', 'Invalid Cashfree order mapping.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
     AND user_id::text = p_user_id
     AND gateway = 'cashfree'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404, 'error', 'Cashfree payment order not found.'
    );
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Cashfree payment order is no longer pending.'
    );
  END IF;

  IF v_order.cf_order_id IS NOT NULL THEN
    IF v_order.cf_order_id = p_cf_order_id
       AND v_order.provider_payment_session_id = p_payment_session_id THEN
      RETURN jsonb_build_object('ok', true, 'reused', true);
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'A different Cashfree order is already linked.'
    );
  END IF;

  UPDATE public.payment_orders
     SET cf_order_id = p_cf_order_id,
         provider_payment_session_id = p_payment_session_id
   WHERE order_id = p_order_id
     AND user_id::text = p_user_id
     AND gateway = 'cashfree'
     AND status = 'pending'
     AND cf_order_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree provider order could not be attached.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'reused', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_cashfree_payment(
  p_order_id text,
  p_cf_order_id text,
  p_provider_payment_id text,
  p_order_amount numeric,
  p_payment_amount numeric,
  p_order_currency text,
  p_payment_currency text,
  p_payment_status text,
  p_event_type text,
  p_payment_group text,
  p_payload_sha256 text,
  p_webhook_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_event public.cashfree_payment_events%ROWTYPE;
  v_expected_amount integer;
  v_target_quota bigint;
  v_current_quota bigint;
  v_current_plan text;
  v_inserted_payment_id text;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF NULLIF(btrim(p_order_id), '') IS NULL
     OR NULLIF(btrim(p_cf_order_id), '') IS NULL
     OR NULLIF(btrim(p_provider_payment_id), '') IS NULL
     OR length(p_provider_payment_id) > 100
     OR p_order_amount IS NULL
     OR p_payment_amount IS NULL
     OR p_order_currency IS DISTINCT FROM 'INR'
     OR COALESCE(p_payment_currency, '') !~ '^[A-Z]{3}$'
     OR p_payment_amount <= 0
     OR p_payment_status IS DISTINCT FROM 'SUCCESS'
     OR COALESCE(p_event_type, '') = ''
     OR COALESCE(p_payload_sha256, '') !~ '^[a-f0-9]{64}$'
     OR (
       p_webhook_idempotency_key IS NOT NULL
       AND p_webhook_idempotency_key !~ '^[A-Za-z0-9+/=_-]{16,256}$'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400, 'error', 'Invalid verified Cashfree payment data.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
     AND gateway = 'cashfree'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404, 'error', 'Cashfree order not found.'
    );
  END IF;

  IF v_order.cf_order_id IS DISTINCT FROM p_cf_order_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Cashfree provider order does not match.'
    );
  END IF;

  CASE v_order.plan
    WHEN '500mb' THEN
      v_expected_amount := 250;
      v_target_quota := 524288000;
    WHEN '1gb' THEN
      v_expected_amount := 500;
      v_target_quota := 1073741824;
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409, 'error', 'Invalid storage plan.'
      );
  END CASE;

  -- Keep MILAN pricing anchored to the INR order amount. Cashfree may
  -- report a different payment amount/currency for eligible international
  -- transactions or when a customer-paid service fee applies.
  IF v_order.amount_inr IS DISTINCT FROM v_expected_amount
     OR p_order_amount IS DISTINCT FROM v_expected_amount::numeric THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Cashfree order amount does not match MILAN pricing.'
    );
  END IF;

  INSERT INTO public.cashfree_payment_events (
    cf_payment_id, webhook_idempotency_key, cf_order_id, order_id, event_type,
    order_amount, payment_amount, order_currency, payment_currency,
    payment_status, payment_group, payload_sha256
  )
  VALUES (
    p_provider_payment_id, p_webhook_idempotency_key,
    p_cf_order_id, p_order_id, left(p_event_type, 100),
    p_order_amount, p_payment_amount, p_order_currency, p_payment_currency,
    p_payment_status, left(p_payment_group, 100), p_payload_sha256
  )
  ON CONFLICT DO NOTHING
  RETURNING cf_payment_id INTO v_inserted_payment_id;

  IF v_inserted_payment_id IS NULL THEN
    SELECT *
      INTO v_event
      FROM public.cashfree_payment_events
     WHERE cf_payment_id = p_provider_payment_id
     FOR UPDATE;

    IF NOT FOUND AND p_webhook_idempotency_key IS NOT NULL THEN
      SELECT *
        INTO v_event
        FROM public.cashfree_payment_events
       WHERE webhook_idempotency_key = p_webhook_idempotency_key
       FOR UPDATE;
    END IF;

    IF NOT FOUND OR v_event.cf_payment_id IS DISTINCT FROM p_provider_payment_id THEN
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'error', 'Cashfree webhook idempotency key conflicts with another payment.'
      );
    END IF;

    IF v_event.order_id IS DISTINCT FROM p_order_id
       OR v_event.cf_order_id IS DISTINCT FROM p_cf_order_id
       OR v_event.order_amount IS DISTINCT FROM p_order_amount
       OR v_event.payment_amount IS DISTINCT FROM p_payment_amount
       OR v_event.order_currency IS DISTINCT FROM p_order_currency
       OR v_event.payment_currency IS DISTINCT FROM p_payment_currency
       OR v_event.payment_status IS DISTINCT FROM p_payment_status THEN
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409, 'error', 'Cashfree payment ID is linked to a different order.'
      );
    END IF;

    IF v_event.processing_status = 'processed' THEN
      RETURN jsonb_build_object(
        'ok', true, 'alreadyProcessed', true,
        'orderId', p_order_id, 'paymentStatus', 'paid'
      );
    END IF;

    IF v_event.processing_status = 'review_required'
       AND v_order.status = 'paid' THEN
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'code', 'MULTIPLE_SUCCESSFUL_PAYMENTS',
        'error', 'Another successful payment is already linked to this order. Review and refund may be required.'
      );
    END IF;

RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Cashfree payment event requires reconciliation.'
    );
  END IF;

  IF v_order.status = 'paid' THEN
    UPDATE public.cashfree_payment_events
       SET processing_status = 'review_required'
     WHERE cf_payment_id = p_provider_payment_id;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'code', 'MULTIPLE_SUCCESSFUL_PAYMENTS',
      'error', 'Another successful payment is already linked to this order. Review and refund may be required.'
    );
  END IF;

  IF v_order.status <> 'pending' THEN
    UPDATE public.cashfree_payment_events
       SET processing_status = 'review_required'
     WHERE cf_payment_id = p_provider_payment_id;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Cashfree order is not pending; payment requires reconciliation.'
    );
  END IF;

  SELECT COALESCE(dwn_quota_bytes, 104857600), storage_plan
    INTO v_current_quota, v_current_plan
    FROM public.users
   WHERE user_id = v_order.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.cashfree_payment_events
       SET processing_status = 'review_required'
     WHERE cf_payment_id = p_provider_payment_id;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404, 'error', 'MILAN user account not found.'
    );
  END IF;

  IF v_current_quota < v_target_quota THEN
    UPDATE public.users
       SET dwn_quota_bytes = GREATEST(v_current_quota, v_target_quota),
           storage_plan = v_order.plan,
           updated_at = v_now
     WHERE user_id = v_order.user_id;
  END IF;

  UPDATE public.payment_orders
     SET status = 'paid',
         provider_payment_id = p_provider_payment_id,
         gateway_reference = p_provider_payment_id,
         paid_at = v_now
   WHERE order_id = p_order_id
     AND gateway = 'cashfree'
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree order finalization failed; transaction rolled back.';
  END IF;

  UPDATE public.cashfree_payment_events
     SET processing_status = 'processed',
         processed_at = v_now
   WHERE cf_payment_id = p_provider_payment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Cashfree payment verified and storage updated.',
    'orderId', p_order_id,
    'paymentStatus', 'paid',
    'providerPaymentId', p_provider_payment_id,
    'quotaBytes', GREATEST(v_current_quota, v_target_quota),
    'quotaAlreadySufficient', v_current_quota >= v_target_quota
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_cashfree_order(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_cashfree_payment(
  text, text, text, numeric, numeric, text, text, text, text, text, text, text
) FROM PUBLIC;

-- PostgreSQL requires the new function owner to have CREATE on the schema
-- while ownership is transferred. Revoke it again immediately afterwards.
GRANT USAGE, CREATE ON SCHEMA public TO milan_pay_fn_owner;

ALTER FUNCTION public.attach_cashfree_order(text, text, text, text)
  OWNER TO milan_pay_fn_owner;
ALTER FUNCTION public.finalize_cashfree_payment(
  text, text, text, numeric, numeric, text, text, text, text, text, text, text
) OWNER TO milan_pay_fn_owner;

REVOKE CREATE ON SCHEMA public FROM milan_pay_fn_owner;

GRANT EXECUTE ON FUNCTION public.attach_cashfree_order(text, text, text, text)
  TO milan_app;
GRANT EXECUTE ON FUNCTION public.finalize_cashfree_payment(
  text, text, text, numeric, numeric, text, text, text, text, text, text, text
) TO milan_app;

GRANT INSERT (
  user_id, order_id, plan, amount_inr, gateway, gateway_reference,
  customer_phone, provider_idempotency_key, provider_request_payload
) ON TABLE public.payment_orders TO milan_app;

COMMIT;
