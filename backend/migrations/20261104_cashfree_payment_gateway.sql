BEGIN;

-- MILAN Cashfree gateway hardening.
-- Apply only with an appropriately privileged database role after backup
-- and review. This migration deliberately fails if pending orders conflict.

DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'milan_app'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'milan_pay_fn_owner'
  ) THEN
    RAISE EXCEPTION
      'Required milan_app and milan_pay_fn_owner roles must exist first.';
  END IF;
END
$roles$;

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS cf_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_session_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS customer_phone text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_cashfree_fields_check'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_cashfree_fields_check
      CHECK (
        gateway <> 'cashfree'
        OR (
          length(order_id) BETWEEN 3 AND 45
          AND order_id ~ '^[A-Za-z0-9_-]+$'
          AND provider_idempotency_key IS NOT NULL
          AND customer_phone ~ '^[6-9][0-9]{9}$'
        )
      ) NOT VALID;
  END IF;
END
$constraints$;

ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_cashfree_fields_check;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_cf_order_id_uidx
  ON public.payment_orders (cf_order_id)
  WHERE cf_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_idempotency_uidx
  ON public.payment_orders (provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_payment_id_uidx
  ON public.payment_orders (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- Never create a shared index by silently resolving or expiring old orders.
DO $pending_preflight$
BEGIN
  IF EXISTS (
    SELECT user_id
    FROM public.payment_orders
    WHERE gateway IN ('milanpay', 'cashfree')
      AND status = 'pending'
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Multiple pending MILAN payment orders exist for a user across gateways. Reconcile exact orders and bank/provider records before retrying.';
  END IF;
END
$pending_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_pending_payment_per_user_uidx
  ON public.payment_orders (user_id)
  WHERE gateway IN ('milanpay', 'cashfree')
    AND status = 'pending';

CREATE TABLE IF NOT EXISTS public.cashfree_payment_attempts (
  cf_payment_id text PRIMARY KEY,
  order_id text NOT NULL
    REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  payment_status text NOT NULL
    CHECK (payment_status IN (
      'SUCCESS', 'PENDING', 'FAILED', 'USER_DROPPED',
      'NOT_ATTEMPTED', 'VOID', 'CANCELLED'
    )),
  order_amount numeric(12,2),
  order_currency text,
  payment_amount numeric(12,2),
  payment_currency text,
  payment_group text,
  bank_reference text,
  payload_sha256 char(64) NOT NULL
    CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  first_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_event_at timestamptz NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'review_required')),
  review_reason text
);

CREATE INDEX IF NOT EXISTS cashfree_payment_attempts_order_seen_idx
  ON public.cashfree_payment_attempts (order_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.cashfree_webhook_events (
  event_hash char(64) PRIMARY KEY
    CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  payload_sha256 char(64) NOT NULL
    CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL,
  provider_event_time timestamptz,
  order_id text,
  cf_order_id text,
  cf_payment_id text,
  payment_status text,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received', 'processed', 'review_required'
    )),
  error_code text
);

CREATE INDEX IF NOT EXISTS cashfree_webhook_events_order_received_idx
  ON public.cashfree_webhook_events (order_id, received_at DESC);

CREATE INDEX IF NOT EXISTS cashfree_webhook_events_unprocessed_idx
  ON public.cashfree_webhook_events (received_at)
  WHERE processing_status = 'received';

CREATE TABLE IF NOT EXISTS public.cashfree_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL
    REFERENCES public.payment_orders(order_id) ON DELETE RESTRICT,
  cf_payment_id text NOT NULL
    REFERENCES public.cashfree_payment_attempts(cf_payment_id) ON DELETE RESTRICT,
  refund_id text NOT NULL UNIQUE
    CHECK (refund_id ~ '^[A-Za-z0-9_-]{3,40}$'),
  idempotency_key uuid NOT NULL UNIQUE,
  cf_refund_id text UNIQUE,
  refund_amount numeric(12,2) NOT NULL
    CHECK (refund_amount > 0),
  refund_currency text NOT NULL DEFAULT 'INR'
    CHECK (refund_currency = 'INR'),
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN (
      'REQUESTED', 'PENDING', 'PENDING_APPROVAL',
      'SUCCESS', 'CANCELLED', 'ONHOLD', 'REJECTED', 'FAILED'
    )),
  reason text,
  request_sha256 char(64) NOT NULL
    CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS cashfree_refunds_order_created_idx
  ON public.cashfree_refunds (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cashfree_refunds_pending_idx
  ON public.cashfree_refunds (created_at)
  WHERE status IN (
    'REQUESTED', 'PENDING', 'PENDING_APPROVAL', 'ONHOLD'
  );

-- Provider order attachment is atomic and can only attach to its own
-- still-pending Cashfree order. Provider sessions are never written by callers.
CREATE OR REPLACE FUNCTION public.attach_cashfree_order(
  p_order_id text,
  p_user_id uuid,
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
     OR NULLIF(btrim(p_cf_order_id), '') IS NULL
     OR NULLIF(btrim(p_payment_session_id), '') IS NULL
     OR length(p_cf_order_id) > 100
     OR length(p_payment_session_id) > 4096 THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400, 'error', 'Invalid provider order details.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
     AND user_id = p_user_id
     AND gateway = 'cashfree'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404, 'error', 'Cashfree order not found.'
    );
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Cashfree order is no longer pending.'
    );
  END IF;

  IF v_order.cf_order_id IS NOT NULL
     AND v_order.cf_order_id IS DISTINCT FROM p_cf_order_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Provider order mapping conflict.'
    );
  END IF;

  IF v_order.provider_payment_session_id IS NOT NULL
     AND v_order.provider_payment_session_id IS DISTINCT FROM p_payment_session_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Provider session mapping conflict.'
    );
  END IF;

  UPDATE public.payment_orders
     SET cf_order_id = p_cf_order_id,
         provider_payment_session_id = p_payment_session_id
   WHERE order_id = p_order_id
     AND user_id = p_user_id
     AND gateway = 'cashfree'
     AND status = 'pending';

  RETURN jsonb_build_object(
    'ok', true, 'orderId', p_order_id, 'providerOrderAttached', true
  );
END;
$function$;

-- One verified, signed event or reconciliation result is recorded once.
-- Failed/pending attempts remain retryable. Only exact SUCCESS can grant quota.
CREATE OR REPLACE FUNCTION public.process_cashfree_payment_event(
  p_event_hash text,
  p_payload_sha256 text,
  p_event_type text,
  p_provider_event_time timestamptz,
  p_order_id text,
  p_cf_order_id text,
  p_cf_payment_id text,
  p_payment_status text,
  p_order_amount numeric,
  p_order_currency text,
  p_payment_amount numeric,
  p_payment_currency text,
  p_payment_group text DEFAULT NULL,
  p_bank_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_inserted_hash text;
  v_order public.payment_orders%ROWTYPE;
  v_event public.cashfree_webhook_events%ROWTYPE;
  v_attempt public.cashfree_payment_attempts%ROWTYPE;
  v_target_quota bigint;
  v_current_quota bigint;
  v_current_plan text;
  v_now timestamptz := statement_timestamp();
  v_reason text;
  v_updated_order_id text;
BEGIN
  IF p_event_hash IS NULL OR p_event_hash !~ '^[a-f0-9]{64}$'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR NULLIF(btrim(p_event_type), '') IS NULL
     OR NULLIF(btrim(p_order_id), '') IS NULL
     OR NULLIF(btrim(p_cf_order_id), '') IS NULL
     OR length(p_cf_order_id) > 100 THEN
    RAISE EXCEPTION 'Invalid Cashfree event identity or payload hash.';
  END IF;

  INSERT INTO public.cashfree_webhook_events (
    event_hash, payload_sha256, event_type, provider_event_time,
    order_id, cf_order_id, cf_payment_id, payment_status
  )
  VALUES (
    p_event_hash, p_payload_sha256, left(p_event_type, 120),
    p_provider_event_time, p_order_id, p_cf_order_id, p_cf_payment_id,
    upper(btrim(COALESCE(p_payment_status, '')))
  )
  ON CONFLICT (event_hash) DO NOTHING
  RETURNING event_hash INTO v_inserted_hash;

  IF NOT FOUND THEN
    SELECT *
      INTO v_event
      FROM public.cashfree_webhook_events
     WHERE event_hash = p_event_hash
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cashfree event disappeared during idempotency check.';
    END IF;

    IF v_event.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
      RAISE EXCEPTION 'Cashfree event hash was reused with a different payload.';
    END IF;

    IF v_event.processing_status = 'processed' THEN
      RETURN jsonb_build_object(
        'ok', true, 'duplicateEvent', true, 'message', 'Event already processed.'
      );
    END IF;

    -- Review-required events can be retried after reconciliation.
    UPDATE public.cashfree_webhook_events
       SET processing_status = 'received',
           processed_at = NULL,
           error_code = NULL
     WHERE event_hash = p_event_hash;
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
     AND gateway = 'cashfree'
   FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = 'ORDER_NOT_FOUND'
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', 'ORDER_NOT_FOUND'
    );
  END IF;

  IF p_cf_payment_id IS NULL
     OR p_cf_payment_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = 'INVALID_PAYMENT_ID'
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', 'INVALID_PAYMENT_ID'
    );
  END IF;

  IF upper(btrim(COALESCE(p_payment_status, ''))) NOT IN (
    'SUCCESS', 'PENDING', 'FAILED', 'USER_DROPPED',
    'NOT_ATTEMPTED', 'VOID', 'CANCELLED'
  ) THEN
    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = 'UNKNOWN_PAYMENT_STATUS'
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', 'UNKNOWN_PAYMENT_STATUS'
    );
  END IF;

  SELECT *
    INTO v_attempt
    FROM public.cashfree_payment_attempts
   WHERE cf_payment_id = p_cf_payment_id
   FOR UPDATE;

  IF FOUND AND v_attempt.order_id IS DISTINCT FROM p_order_id THEN
    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = 'PAYMENT_ID_ORDER_MISMATCH'
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', 'PAYMENT_ID_ORDER_MISMATCH'
    );
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.cashfree_payment_attempts (
      cf_payment_id, order_id, payment_status,
      order_amount, order_currency, payment_amount, payment_currency,
      payment_group, bank_reference, payload_sha256, last_event_at
    )
    VALUES (
      p_cf_payment_id, p_order_id, upper(btrim(p_payment_status)),
      p_order_amount, upper(btrim(COALESCE(p_order_currency, ''))),
      p_payment_amount, upper(btrim(COALESCE(p_payment_currency, ''))),
      left(COALESCE(p_payment_group, ''), 80),
      left(COALESCE(p_bank_reference, ''), 256),
      p_payload_sha256, COALESCE(p_provider_event_time, v_now)
    )
    ON CONFLICT (cf_payment_id) DO NOTHING;

    SELECT *
      INTO v_attempt
      FROM public.cashfree_payment_attempts
     WHERE cf_payment_id = p_cf_payment_id
     FOR UPDATE;

    IF NOT FOUND OR v_attempt.order_id IS DISTINCT FROM p_order_id THEN
      UPDATE public.cashfree_webhook_events
         SET processing_status = 'review_required',
             processed_at = v_now,
             error_code = 'PAYMENT_ATTEMPT_CONFLICT'
       WHERE event_hash = p_event_hash;

      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 202,
        'reviewRequired', true, 'code', 'PAYMENT_ATTEMPT_CONFLICT'
      );
    END IF;
  ELSE
    UPDATE public.cashfree_payment_attempts
       SET payment_status = CASE
             WHEN payment_status = 'SUCCESS' THEN 'SUCCESS'
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS' THEN 'SUCCESS'
             WHEN COALESCE(p_provider_event_time, v_now) >= last_event_at
               THEN upper(btrim(p_payment_status))
             ELSE payment_status
           END,
           order_amount = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN p_order_amount ELSE order_amount END,
           order_currency = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN upper(btrim(COALESCE(p_order_currency, '')))
             ELSE order_currency END,
           payment_amount = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN p_payment_amount ELSE payment_amount END,
           payment_currency = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN upper(btrim(COALESCE(p_payment_currency, '')))
             ELSE payment_currency END,
           payment_group = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN left(COALESCE(p_payment_group, ''), 80)
             ELSE payment_group END,
           bank_reference = CASE
             WHEN upper(btrim(p_payment_status)) = 'SUCCESS'
               OR COALESCE(p_provider_event_time, v_now) >= last_event_at
             THEN left(COALESCE(p_bank_reference, ''), 256)
             ELSE bank_reference END,
           payload_sha256 = p_payload_sha256,
           last_event_at = GREATEST(
             last_event_at, COALESCE(p_provider_event_time, v_now)
           ),
           last_seen_at = v_now
     WHERE cf_payment_id = p_cf_payment_id;

    SELECT *
      INTO v_attempt
      FROM public.cashfree_payment_attempts
     WHERE cf_payment_id = p_cf_payment_id
     FOR UPDATE;
  END IF;

  -- A success already observed for this payment attempt is terminal.
  IF v_attempt.payment_status = 'SUCCESS'
     AND v_order.status = 'paid'
     AND v_order.provider_payment_id = p_cf_payment_id THEN
    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'processed',
           review_reason = NULL
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'processed', processed_at = v_now
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', true, 'alreadyFinalized', true,
      'orderId', p_order_id, 'paymentStatus', 'paid'
    );
  END IF;

  -- The merchant order mapping, plan price and both currency/amount values
  -- must all match before any entitlement change.
  IF v_order.cf_order_id IS DISTINCT FROM p_cf_order_id
     OR p_order_amount IS DISTINCT FROM v_order.amount_inr::numeric
     OR p_payment_amount IS DISTINCT FROM v_order.amount_inr::numeric
     OR upper(btrim(COALESCE(p_order_currency, ''))) <> 'INR'
     OR upper(btrim(COALESCE(p_payment_currency, ''))) <> 'INR' THEN
    v_reason := 'ORDER_MAPPING_AMOUNT_OR_CURRENCY_MISMATCH';

    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'review_required',
           review_reason = v_reason
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = v_reason
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', v_reason
    );
  END IF;

  -- Transitional statuses are recorded but never finalize or fail an order.
  IF v_attempt.payment_status <> 'SUCCESS' THEN
    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'processed',
           review_reason = NULL
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'processed', processed_at = v_now
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', true, 'finalized', false,
      'paymentStatus', v_attempt.payment_status,
      'orderStatus', v_order.status
    );
  END IF;

  -- A different successful attempt must never grant quota twice.
  IF v_order.status = 'paid' THEN
    v_reason := 'ORDER_ALREADY_PAID_BY_DIFFERENT_ATTEMPT';
  ELSIF v_order.status <> 'pending' THEN
    v_reason := 'ORDER_NOT_PENDING';
  ELSE
    v_reason := NULL;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'review_required',
           review_reason = v_reason
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = v_reason
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', v_reason
    );
  END IF;

  CASE v_order.plan
    WHEN '500mb' THEN v_target_quota := 524288000;
    WHEN '1gb' THEN v_target_quota := 1073741824;
    ELSE v_target_quota := NULL;
  END CASE;

  IF v_target_quota IS NULL
     OR NOT COALESCE(
       (v_order.plan = '500mb' AND v_order.amount_inr = 250)
       OR (v_order.plan = '1gb' AND v_order.amount_inr = 500),
       false
     ) THEN
    v_reason := 'INVALID_STORED_PLAN_OR_AMOUNT';

    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'review_required',
           review_reason = v_reason
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = v_reason
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', v_reason
    );
  END IF;

  SELECT COALESCE(dwn_quota_bytes, 104857600), storage_plan
    INTO v_current_quota, v_current_plan
    FROM public.users
   WHERE user_id = v_order.user_id
   FOR UPDATE;

  IF NOT FOUND OR v_current_quota >= v_target_quota THEN
    v_reason := 'ACCOUNT_MISSING_OR_QUOTA_ALREADY_AT_TARGET';

    UPDATE public.cashfree_payment_attempts
       SET processing_status = 'review_required',
           review_reason = v_reason
     WHERE cf_payment_id = p_cf_payment_id;

    UPDATE public.cashfree_webhook_events
       SET processing_status = 'review_required',
           processed_at = v_now,
           error_code = v_reason
     WHERE event_hash = p_event_hash;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 202,
      'reviewRequired', true, 'code', v_reason
    );
  END IF;

  -- Quota and order become final in this same PostgreSQL transaction.
  UPDATE public.users
     SET dwn_quota_bytes = GREATEST(v_current_quota, v_target_quota),
         storage_plan = v_order.plan,
         updated_at = v_now
   WHERE user_id = v_order.user_id;

  UPDATE public.payment_orders
     SET status = 'paid',
         provider_payment_id = p_cf_payment_id,
         paid_at = v_now
   WHERE order_id = p_order_id
     AND gateway = 'cashfree'
     AND status = 'pending'
  RETURNING order_id INTO v_updated_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Cashfree payment finalization lost its pending-order condition; transaction rolled back.';
  END IF;

  UPDATE public.cashfree_payment_attempts
     SET processing_status = 'processed',
         review_reason = NULL
   WHERE cf_payment_id = p_cf_payment_id;

  UPDATE public.cashfree_webhook_events
     SET processing_status = 'processed', processed_at = v_now
   WHERE event_hash = p_event_hash;

  RETURN jsonb_build_object(
    'ok', true,
    'finalized', true,
    'orderId', p_order_id,
    'paymentStatus', 'paid',
    'quotaBytes', GREATEST(v_current_quota, v_target_quota)
  );
END;
$function$;

-- Reserve a refund before calling the provider. REQUESTED/PENDING refunds
-- reserve their amount so concurrent admin actions cannot over-refund.
CREATE OR REPLACE FUNCTION public.reserve_cashfree_refund(
  p_order_id text,
  p_user_id uuid,
  p_refund_id text,
  p_idempotency_key uuid,
  p_refund_amount numeric,
  p_reason text,
  p_request_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing public.cashfree_refunds%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_attempt public.cashfree_payment_attempts%ROWTYPE;
  v_reserved numeric(12,2);
  v_inserted_refund_id text;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF NULLIF(btrim(p_order_id), '') IS NULL
     OR p_refund_id IS NULL
     OR p_refund_id !~ '^[A-Za-z0-9_-]{3,40}$'
     OR p_idempotency_key IS NULL
     OR p_refund_amount IS NULL
     OR p_refund_amount <= 0
     OR round(p_refund_amount, 2) <> p_refund_amount
     OR p_request_sha256 IS NULL
     OR p_request_sha256 !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400, 'error', 'Invalid refund request.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
     AND user_id = p_user_id
     AND gateway = 'cashfree'
   FOR UPDATE;

  IF NOT FOUND
     OR v_order.status <> 'paid'
     OR v_order.provider_payment_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Only successfully paid Cashfree orders can be refunded.'
    );
  END IF;

  -- Recheck idempotency after taking the paid-order lock. This serializes
  -- same-order retries before checking the remaining refundable balance.
  SELECT *
    INTO v_existing
    FROM public.cashfree_refunds
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
       OR v_existing.refund_id IS DISTINCT FROM p_refund_id
       OR v_existing.refund_amount IS DISTINCT FROM p_refund_amount
       OR v_existing.request_sha256 IS DISTINCT FROM p_request_sha256 THEN
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'error', 'Refund idempotency key was reused with different details.'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'reused', true,
      'refundId', v_existing.refund_id,
      'providerRefundId', v_existing.cf_refund_id,
      'status', v_existing.status
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cashfree_refunds
    WHERE refund_id = p_refund_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Refund ID already exists.'
    );
  END IF;

  SELECT *
    INTO v_attempt
    FROM public.cashfree_payment_attempts
   WHERE cf_payment_id = v_order.provider_payment_id
     AND order_id = v_order.order_id
     AND payment_status = 'SUCCESS'
     AND processing_status = 'processed'
   FOR UPDATE;

  IF NOT FOUND OR v_attempt.payment_amount IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Verified successful payment attempt is unavailable.'
    );
  END IF;

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_reserved
    FROM public.cashfree_refunds
   WHERE order_id = p_order_id
     AND status IN (
       'REQUESTED', 'PENDING', 'PENDING_APPROVAL', 'ONHOLD', 'SUCCESS'
     );

  IF v_reserved + p_refund_amount > v_attempt.payment_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Refund amount exceeds the unrefunded payment amount.'
    );
  END IF;

  INSERT INTO public.cashfree_refunds (
    order_id, cf_payment_id, refund_id, idempotency_key,
    refund_amount, status, reason, request_sha256
  )
  VALUES (
    p_order_id, v_order.provider_payment_id, p_refund_id,
    p_idempotency_key, p_refund_amount, 'REQUESTED',
    left(NULLIF(btrim(p_reason), ''), 250), p_request_sha256
  )
  ON CONFLICT DO NOTHING
  RETURNING refund_id INTO v_inserted_refund_id;

  IF NOT FOUND THEN
    -- A concurrent request may have inserted this idempotency key.
    SELECT *
      INTO v_existing
      FROM public.cashfree_refunds
     WHERE idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF FOUND THEN
      IF v_existing.order_id IS DISTINCT FROM p_order_id
         OR v_existing.refund_id IS DISTINCT FROM p_refund_id
         OR v_existing.refund_amount IS DISTINCT FROM p_refund_amount
         OR v_existing.request_sha256 IS DISTINCT FROM p_request_sha256 THEN
        RETURN jsonb_build_object(
          'ok', false, 'httpStatus', 409,
          'error', 'Refund idempotency key was reused with different details.'
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', true, 'reused', true,
        'refundId', v_existing.refund_id,
        'providerRefundId', v_existing.cf_refund_id,
        'status', v_existing.status
      );
    END IF;

    -- A different idempotency key may have claimed the refund ID.
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Refund ID already exists.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'created', true,
    'refundId', p_refund_id,
    'status', 'REQUESTED',
    'refundAmount', p_refund_amount
  );
END;
$function$;

-- Attach provider refund IDs and refresh provider status without ever
-- changing payment_orders.status or storage quota.
CREATE OR REPLACE FUNCTION public.update_cashfree_refund_status(
  p_refund_id text,
  p_cf_refund_id text,
  p_provider_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_refund public.cashfree_refunds%ROWTYPE;
  v_status text := upper(btrim(COALESCE(p_provider_status, '')));
  v_now timestamptz := statement_timestamp();
BEGIN
  IF NULLIF(btrim(p_refund_id), '') IS NULL
     OR v_status NOT IN (
       'PENDING', 'PENDING_APPROVAL', 'SUCCESS',
       'CANCELLED', 'ONHOLD', 'REJECTED', 'FAILED'
     )
     OR (p_cf_refund_id IS NOT NULL AND length(p_cf_refund_id) > 100) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400, 'error', 'Invalid provider refund status.'
    );
  END IF;

  SELECT *
    INTO v_refund
    FROM public.cashfree_refunds
   WHERE refund_id = p_refund_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404, 'error', 'Refund not found.'
    );
  END IF;

  IF v_refund.cf_refund_id IS NOT NULL
     AND p_cf_refund_id IS NOT NULL
     AND v_refund.cf_refund_id IS DISTINCT FROM p_cf_refund_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409, 'error', 'Provider refund ID mismatch.'
    );
  END IF;

  UPDATE public.cashfree_refunds
     SET cf_refund_id = COALESCE(cf_refund_id, p_cf_refund_id),
         status = CASE
           WHEN status IN ('SUCCESS', 'CANCELLED', 'REJECTED', 'FAILED')
             THEN status
           ELSE v_status
         END,
         updated_at = v_now,
         processed_at = CASE
           WHEN v_status IN ('SUCCESS', 'CANCELLED', 'REJECTED', 'FAILED')
             THEN COALESCE(processed_at, v_now)
           ELSE processed_at
         END
   WHERE refund_id = p_refund_id
  RETURNING * INTO v_refund;

  RETURN jsonb_build_object(
    'ok', true,
    'refundId', v_refund.refund_id,
    'providerRefundId', v_refund.cf_refund_id,
    'status', v_refund.status
  );
END;
$function$;

-- Transfer all privileged writes to the dedicated non-login function owner.
GRANT USAGE, CREATE ON SCHEMA public TO milan_pay_fn_owner;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.payment_orders,
  public.users,
  public.cashfree_payment_attempts,
  public.cashfree_webhook_events,
  public.cashfree_refunds
TO milan_pay_fn_owner;

ALTER FUNCTION public.attach_cashfree_order(text, uuid, text, text)
  OWNER TO milan_pay_fn_owner;

ALTER FUNCTION public.process_cashfree_payment_event(
  text, text, text, timestamptz, text, text, text, text,
  numeric, text, numeric, text, text, text
) OWNER TO milan_pay_fn_owner;

ALTER FUNCTION public.reserve_cashfree_refund(
  text, uuid, text, uuid, numeric, text, text
) OWNER TO milan_pay_fn_owner;

ALTER FUNCTION public.update_cashfree_refund_status(text, text, text)
  OWNER TO milan_pay_fn_owner;

REVOKE CREATE ON SCHEMA public FROM milan_pay_fn_owner;

-- Application reads order/provider state but cannot directly update it.
GRANT USAGE ON SCHEMA public TO milan_app;
GRANT SELECT ON TABLE
  public.cashfree_payment_attempts,
  public.cashfree_webhook_events,
  public.cashfree_refunds
TO milan_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.cashfree_payment_attempts,
  public.cashfree_webhook_events,
  public.cashfree_refunds
FROM PUBLIC, milan_app;

-- Existing UPI insert grants remain. Add only the two Cashfree order fields
-- required at creation; provider IDs/session are attached through the RPC.
GRANT INSERT (
  user_id, order_id, plan, amount_inr, gateway,
  provider_idempotency_key, customer_phone
) ON TABLE public.payment_orders TO milan_app;

-- Allow the backend to read provider state without granting table-wide access.
GRANT SELECT (
  cf_order_id,
  provider_payment_session_id,
  provider_idempotency_key,
  provider_payment_id,
  customer_phone
) ON TABLE public.payment_orders TO milan_app;

REVOKE ALL ON FUNCTION
  public.attach_cashfree_order(text, uuid, text, text)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.process_cashfree_payment_event(
    text, text, text, timestamptz, text, text, text, text,
    numeric, text, numeric, text, text, text
  )
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.reserve_cashfree_refund(text, uuid, text, uuid, numeric, text, text)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.update_cashfree_refund_status(text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.attach_cashfree_order(text, uuid, text, text)
TO milan_app;

GRANT EXECUTE ON FUNCTION
  public.process_cashfree_payment_event(
    text, text, text, timestamptz, text, text, text, text,
    numeric, text, numeric, text, text, text
  )
TO milan_app;

GRANT EXECUTE ON FUNCTION
  public.reserve_cashfree_refund(text, uuid, text, uuid, numeric, text, text)
TO milan_app;

GRANT EXECUTE ON FUNCTION
  public.update_cashfree_refund_status(text, text, text)
TO milan_app;

COMMIT;
