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
    IF v_order.gateway_reference IS NOT DISTINCT FROM p_payment_id THEN
      RETURN jsonb_build_object(
        'ok', true, 'alreadyPaid', true,
        'orderId', p_order_id
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Order is already paid with a different payment reference.'
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
           WHEN v_current_quota >= 1073741824 THEN '1gb'
           WHEN v_current_quota >= 524288000 AND v_target_quota <= 524288000 THEN '500mb'
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
