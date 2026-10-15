BEGIN;

-- MILAN Pay manual UPI verification migration.
-- Review before applying in the Supabase SQL Editor.
-- Do not mark a payment paid until the bank transaction is independently verified.

ALTER TABLE public.storage_upgrade_requests
  ADD COLUMN IF NOT EXISTS order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_order_id_uidx
  ON public.storage_upgrade_requests (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_order_id_uidx
  ON public.payment_orders (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_utr_normalized_uidx
  ON public.storage_upgrade_requests (lower(btrim(utr)))
  WHERE utr IS NOT NULL AND btrim(utr) <> '';

CREATE OR REPLACE FUNCTION public.admin_approve_milan_pay_storage_request(
  p_request_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_request public.storage_upgrade_requests%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_expected_amount numeric;
  v_target_quota bigint;
  v_current_quota bigint;
  v_current_plan text;
  v_now timestamptz := statement_timestamp();
BEGIN
  SELECT *
    INTO v_request
    FROM public.storage_upgrade_requests
   WHERE id::text = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'Storage upgrade request not found.'
    );
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Storage request is no longer pending.'
    );
  END IF;

  IF NULLIF(BTRIM(v_request.order_id), '') IS NULL
     OR NULLIF(BTRIM(v_request.utr), '') IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Order ID and transaction reference are required.'
    );
  END IF;

  CASE v_request.plan
    WHEN '500mb' THEN
      v_expected_amount := 250;
      v_target_quota := 524288000;
    WHEN '1gb' THEN
      v_expected_amount := 500;
      v_target_quota := 1073741824;
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'error', 'Invalid storage plan.'
      );
  END CASE;

  IF v_request.amount_inr IS DISTINCT FROM v_expected_amount
     OR v_request.utr !~ '^[A-Za-z0-9._-]{6,80}$' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Request amount or transaction reference is invalid.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.storage_upgrade_requests r
     WHERE lower(btrim(r.utr)) = lower(btrim(v_request.utr))
       AND r.id::text <> v_request.id::text
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'This transaction reference has already been used.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = v_request.order_id
     AND user_id = v_request.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'Matching payment order not found.'
    );
  END IF;

  IF v_order.gateway IS DISTINCT FROM 'milanpay'
     OR v_order.status IS DISTINCT FROM 'pending'
     OR v_order.plan IS DISTINCT FROM v_request.plan
     OR v_order.amount_inr IS DISTINCT FROM v_expected_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment order, plan, amount, or status does not match.'
    );
  END IF;

  SELECT COALESCE(dwn_quota_bytes, 104857600)::bigint, storage_plan
    INTO v_current_quota, v_current_plan
    FROM public.users
   WHERE id = v_request.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'User account not found.'
    );
  END IF;

  UPDATE public.users
     SET dwn_quota_bytes = GREATEST(v_current_quota, v_target_quota),
         storage_plan = CASE
           WHEN v_current_quota >= v_target_quota
             THEN COALESCE(v_current_plan, v_request.plan)
           ELSE v_request.plan
         END
   WHERE id = v_request.user_id;

  UPDATE public.payment_orders
     SET status = 'paid',
         gateway_reference = v_request.utr,
         paid_at = v_now
   WHERE order_id = v_request.order_id
     AND user_id = v_request.user_id
     AND gateway = 'milanpay'
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order could not be finalized; transaction rolled back.';
  END IF;

  UPDATE public.storage_upgrade_requests
     SET status = 'approved',
         reviewed_at = v_now,
         reviewer_note = COALESCE(
           NULLIF(LEFT(BTRIM(p_note), 500), ''),
           'UPI transaction manually verified against bank records.'
         )
   WHERE id = v_request.id
     AND status = 'pending'
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storage request could not be finalized; transaction rolled back.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Manually verified payment approved and storage upgraded.',
    'orderId', v_order.order_id,
    'paymentStatus', 'paid',
    'requestId', v_request.id::text,
    'requestStatus', v_request.status,
    'quotaBytes', GREATEST(v_current_quota, v_target_quota)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reject_milan_pay_storage_request(
  p_request_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_request public.storage_upgrade_requests%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_expected_amount numeric;
  v_now timestamptz := statement_timestamp();
BEGIN
  SELECT *
    INTO v_request
    FROM public.storage_upgrade_requests
   WHERE id::text = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 404,
      'error', 'Storage upgrade request not found.');
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 409,
      'error', 'Storage request is no longer pending.');
  END IF;

  -- Legacy requests without a linked MILAN Pay order are not handled by this RPC.
  IF NULLIF(BTRIM(v_request.order_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 409,
      'error', 'This legacy request must be rejected through the legacy flow.');
  END IF;

  CASE v_request.plan
    WHEN '500mb' THEN v_expected_amount := 250;
    WHEN '1gb' THEN v_expected_amount := 500;
    ELSE
      RETURN jsonb_build_object('ok', false, 'httpStatus', 409,
        'error', 'Invalid storage plan.');
  END CASE;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = v_request.order_id
     AND user_id = v_request.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 404,
      'error', 'Matching payment order not found.');
  END IF;

  IF v_order.gateway IS DISTINCT FROM 'milanpay'
     OR v_order.plan IS DISTINCT FROM v_request.plan
     OR v_order.amount_inr IS DISTINCT FROM v_expected_amount THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 409,
      'error', 'Payment order, plan, or amount does not match.');
  END IF;

  IF v_order.status = 'pending' THEN
    UPDATE public.payment_orders
       SET status = 'failed'
     WHERE order_id = v_order.order_id
       AND user_id = v_request.user_id
       AND gateway = 'milanpay'
       AND status = 'pending';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Could not mark payment order failed; transaction rolled back.';
    END IF;
  ELSIF v_order.status IS DISTINCT FROM 'failed' THEN
    RETURN jsonb_build_object('ok', false, 'httpStatus', 409,
      'error', 'Only pending or failed payment orders may be rejected.');
  END IF;

  UPDATE public.storage_upgrade_requests
     SET status = 'rejected',
         reviewed_at = v_now,
         reviewer_note = COALESCE(
           NULLIF(LEFT(BTRIM(p_note), 500), ''),
           'UPI transaction was not approved after bank-record review.'
         )
   WHERE id = v_request.id
     AND status = 'pending'
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storage request could not be rejected; transaction rolled back.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'orderId', v_order.order_id,
    'paymentStatus', CASE WHEN v_order.status = 'pending' THEN 'failed' ELSE v_order.status END,
    'requestId', v_request.id::text,
    'requestStatus', v_request.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)
  TO service_role;

COMMIT;
