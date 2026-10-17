BEGIN;

-- Stop safely if a pre-existing Cashfree transaction reference is duplicated.
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.payment_orders
     WHERE gateway = 'cashfree'
       AND gateway_reference IS NOT NULL
     GROUP BY gateway_reference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Cashfree payment references exist; reconcile before applying this migration.';
  END IF;
END;
$check$;

-- UPI/MILAN Pay references are unaffected; uniqueness applies only to Cashfree.
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_cashfree_reference_uidx
  ON public.payment_orders (gateway_reference)
  WHERE gateway = 'cashfree' AND gateway_reference IS NOT NULL;


-- Serialize order reservation per user to avoid duplicate pending Cashfree orders
-- when the user clicks twice or checks out in multiple tabs.
CREATE OR REPLACE FUNCTION public.reserve_cashfree_storage_order(
  p_user_id text,
  p_order_id text,
  p_plan text,
  p_amount_inr numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id public.users.id%TYPE;
  v_current_quota bigint;
  v_expected_amount numeric;
  v_target_quota bigint;
BEGIN
  IF NULLIF(BTRIM(p_user_id), '') IS NULL
     OR NULLIF(BTRIM(p_order_id), '') IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400,
      'error', 'User and order ID are required.',
      'code', 'cashfree_invalid_order_reservation'
    );
  END IF;

  CASE p_plan
    WHEN '500mb' THEN
      v_expected_amount := 250;
      v_target_quota := 524288000;
    WHEN '1gb' THEN
      v_expected_amount := 500;
      v_target_quota := 1073741824;
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 400,
        'error', 'Invalid storage plan.',
        'code', 'cashfree_invalid_order_reservation'
      );
  END CASE;

  IF p_amount_inr IS DISTINCT FROM v_expected_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment amount does not match the requested plan.',
      'code', 'cashfree_plan_amount_mismatch'
    );
  END IF;

  -- Every reservation for one user locks this row before checking/inserting.
  SELECT id, COALESCE(dwn_quota_bytes, 104857600)::bigint
    INTO v_user_id, v_current_quota
    FROM public.users
   WHERE id::text = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'User account not found.',
      'code', 'cashfree_user_not_found'
    );
  END IF;

  IF v_current_quota >= v_target_quota THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Your account already has this storage capacity or more. No new payment order was created.',
      'code', 'cashfree_storage_already_available'
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.payment_orders
     WHERE user_id = v_user_id
       AND gateway = 'cashfree'
       AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'A pending Cashfree order now exists. Refresh the checkout to safely resume or reconcile it.',
      'code', 'cashfree_pending_order_created_concurrently'
    );
  END IF;

  INSERT INTO public.payment_orders (
    user_id, order_id, plan, amount_inr, status, gateway
  ) VALUES (
    v_user_id, p_order_id, p_plan, v_expected_amount, 'pending', 'cashfree'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_cashfree_storage_order(text, text, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cashfree_storage_order(text, text, text, numeric)
  TO service_role;

-- Atomically confirm provider-verified payment and upgrade quota.
-- This function must only be callable by the trusted backend service role.
CREATE OR REPLACE FUNCTION public.confirm_cashfree_storage_payment(
  p_order_id text,
  p_payment_id text,
  p_amount_inr numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_current_quota bigint;
  v_current_plan text;
  v_target_quota bigint;
  v_expected_amount numeric;
  v_target_plan text;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF NULLIF(BTRIM(p_order_id), '') IS NULL
     OR NULLIF(BTRIM(p_payment_id), '') IS NULL
     OR p_amount_inr IS NULL
     OR p_amount_inr <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 400,
      'error', 'Invalid Cashfree payment details.'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'Payment order not found.'
    );
  END IF;

  IF v_order.gateway IS DISTINCT FROM 'cashfree' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment gateway does not match.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.payment_orders
     WHERE gateway = 'cashfree'
       AND gateway_reference = p_payment_id
       AND order_id <> p_order_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Cashfree payment reference is already linked to another order.'
    );
  END IF;

  IF v_order.status = 'paid' THEN
    IF v_order.gateway_reference IS NOT DISTINCT FROM p_payment_id
       AND v_order.amount_inr IS NOT DISTINCT FROM p_amount_inr THEN
      RETURN jsonb_build_object(
        'ok', true, 'alreadyPaid', true,
        'orderId', p_order_id
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Paid order does not match this payment reference and amount.'
    );
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment order is not pending.'
    );
  END IF;

  CASE v_order.plan
    WHEN '500mb' THEN
      v_expected_amount := 250;
      v_target_quota := 524288000;
      v_target_plan := '500mb';
    WHEN '1gb' THEN
      v_expected_amount := 500;
      v_target_quota := 1073741824;
      v_target_plan := '1gb';
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'error', 'Invalid stored storage plan.'
      );
  END CASE;

  IF v_order.amount_inr IS DISTINCT FROM v_expected_amount
     OR p_amount_inr IS DISTINCT FROM v_expected_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment amount does not match the stored order.'
    );
  END IF;

  SELECT COALESCE(dwn_quota_bytes, 104857600)::bigint, storage_plan
    INTO v_current_quota, v_current_plan
    FROM public.users
   WHERE id = v_order.user_id
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
             AND v_current_plan IN ('500mb', '1gb')
             AND CASE v_current_plan
                   WHEN '1gb' THEN 2
                   WHEN '500mb' THEN 1
                   ELSE 0
                 END > CASE v_target_plan
                         WHEN '1gb' THEN 2
                         ELSE 1
                       END
             THEN v_current_plan
           ELSE v_target_plan
         END
   WHERE id = v_order.user_id;

  UPDATE public.payment_orders
     SET status = 'paid',
         gateway_reference = p_payment_id,
         paid_at = v_now
   WHERE order_id = p_order_id
     AND gateway = 'cashfree'
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree order finalization failed; transaction rolled back.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'paymentStatus', 'paid',
    'quotaBytes', GREATEST(v_current_quota, v_target_quota)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_cashfree_storage_payment(text, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_cashfree_storage_payment(text, text, numeric)
  TO service_role;

COMMIT;
