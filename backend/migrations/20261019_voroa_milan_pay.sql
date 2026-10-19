BEGIN;

-- Voroa PostgreSQL migration for MILAN Pay.
-- Create locally and review before any database deployment.
-- Legacy payment records must never be assigned to a user without verified identity mapping.

-- If the quota column is new, preserve the legacy 1 GiB effective quota for
-- existing rows. The default for future registrations is changed to 100 MiB below.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dwn_quota_bytes bigint NOT NULL DEFAULT 1073741824;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS storage_plan text NOT NULL DEFAULT 'free';

-- Preserve existing accounts' quota values. New accounts created after this
-- migration use the advertised 100 MiB Free plan unless explicitly upgraded.
ALTER TABLE public.users
  ALTER COLUMN dwn_quota_bytes SET DEFAULT 104857600;

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  order_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('500mb', '1gb')),
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed')),
  gateway text NOT NULL,
  gateway_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx
  ON public.payment_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_orders_user_pending_idx
  ON public.payment_orders (user_id)
  WHERE gateway = 'milanpay' AND status = 'pending';

CREATE TABLE IF NOT EXISTS public.storage_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  plan text NOT NULL CHECK (plan IN ('500mb', '1gb')),
  quota_bytes bigint NOT NULL CHECK (quota_bytes > 0),
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  payment_method text NOT NULL,
  utr text,
  payment_screenshot_path text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer_note text,
  order_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_order_id_uidx
  ON public.storage_upgrade_requests (order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS storage_upgrade_requests_utr_normalized_uidx
  ON public.storage_upgrade_requests (lower(btrim(utr)))
  WHERE utr IS NOT NULL AND btrim(utr) <> '';

CREATE INDEX IF NOT EXISTS storage_upgrade_requests_user_created_idx
  ON public.storage_upgrade_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS storage_upgrade_requests_pending_idx
  ON public.storage_upgrade_requests (created_at ASC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_pending_milanpay_per_user_uidx
  ON public.payment_orders (user_id)
  WHERE gateway = 'milanpay' AND status = 'pending';

-- Historical payments with unmatched legacy user IDs are archive-only.
-- These tables deliberately have no foreign key to public.users and do not confer
-- payment status, identity ownership, or storage entitlements.
CREATE TABLE IF NOT EXISTS public.milan_legacy_payment_orders (
  source_row_id text PRIMARY KEY,
  source_user_id text NOT NULL,
  order_id text,
  status text,
  source_created_at timestamptz,
  row_data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.milan_legacy_storage_upgrade_requests (
  source_row_id text PRIMARY KEY,
  source_user_id text NOT NULL,
  order_id text,
  status text,
  source_created_at timestamptz,
  row_data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.milan_legacy_payment_orders FROM PUBLIC;
REVOKE ALL ON TABLE public.milan_legacy_storage_upgrade_requests FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_approve_milan_pay_storage_request(
  p_request_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_request public.storage_upgrade_requests%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_expected_amount integer;
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

  IF NULLIF(btrim(v_request.order_id), '') IS NULL
     OR NULLIF(btrim(v_request.utr), '') IS NULL THEN
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
     OR v_request.quota_bytes IS DISTINCT FROM v_target_quota
     OR v_request.utr !~ '^[A-Za-z0-9._-]{6,80}$' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Request amount, quota, or transaction reference is invalid.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.storage_upgrade_requests r
     WHERE lower(btrim(r.utr)) = lower(btrim(v_request.utr))
       AND r.id <> v_request.id
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

  SELECT COALESCE(dwn_quota_bytes, 104857600), storage_plan
    INTO v_current_quota, v_current_plan
    FROM public.users
   WHERE user_id = v_request.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 404,
      'error', 'User account not found.'
    );
  END IF;

  IF v_current_quota >= v_target_quota THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Current storage quota already meets or exceeds this plan.'
    );
  END IF;

  UPDATE public.users
     SET dwn_quota_bytes = GREATEST(v_current_quota, v_target_quota),
         storage_plan = CASE
           WHEN v_current_quota >= v_target_quota
             THEN COALESCE(v_current_plan, v_request.plan)
           ELSE v_request.plan
         END,
         updated_at = v_now
   WHERE user_id = v_request.user_id;

  UPDATE public.payment_orders
     SET status = 'paid',
         gateway_reference = v_request.utr,
         paid_at = v_now
   WHERE order_id = v_request.order_id
     AND user_id = v_request.user_id
     AND gateway = 'milanpay'
     AND status = 'pending'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order could not be finalized; transaction rolled back.';
  END IF;

  UPDATE public.storage_upgrade_requests
     SET status = 'approved',
         reviewed_at = v_now,
         reviewer_note = COALESCE(
           NULLIF(left(btrim(p_note), 500), ''),
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
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_request public.storage_upgrade_requests%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_expected_amount integer;
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

  IF NULLIF(btrim(v_request.order_id), '') IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'This legacy request must be rejected through the legacy flow.'
    );
  END IF;

  CASE v_request.plan
    WHEN '500mb' THEN v_expected_amount := 250;
    WHEN '1gb' THEN v_expected_amount := 500;
    ELSE
      RETURN jsonb_build_object(
        'ok', false, 'httpStatus', 409,
        'error', 'Invalid storage plan.'
      );
  END CASE;

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
     OR v_order.plan IS DISTINCT FROM v_request.plan
     OR v_order.amount_inr IS DISTINCT FROM v_expected_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Payment order, plan, or amount does not match.'
    );
  END IF;

  IF v_order.status = 'pending' THEN
    UPDATE public.payment_orders
       SET status = 'failed'
     WHERE order_id = v_order.order_id
       AND user_id = v_request.user_id
       AND gateway = 'milanpay'
       AND status = 'pending'
    RETURNING * INTO v_order;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment order could not be marked failed; transaction rolled back.';
    END IF;
  ELSIF v_order.status IS DISTINCT FROM 'failed' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Only pending or failed payment orders may be rejected.'
    );
  END IF;

  UPDATE public.storage_upgrade_requests
     SET status = 'rejected',
         reviewed_at = v_now,
         reviewer_note = COALESCE(
           NULLIF(left(btrim(p_note), 500), ''),
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
    'paymentStatus', v_order.status,
    'requestId', v_request.id::text,
    'requestStatus', v_request.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reject_legacy_milan_storage_request(
  p_request_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_request public.storage_upgrade_requests%ROWTYPE;
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
      'error', 'Storage request not found.'
    );
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Storage request is no longer pending.'
    );
  END IF;

  IF NULLIF(btrim(v_request.order_id), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'This operation only rejects legacy requests without a linked order.'
    );
  END IF;

  UPDATE public.storage_upgrade_requests
     SET status = 'rejected',
         reviewed_at = v_now,
         reviewer_note = COALESCE(
           NULLIF(left(btrim(p_note), 500), ''),
           'Legacy UPI request rejected after review.'
         )
   WHERE id = v_request.id
     AND status = 'pending'
     AND NULLIF(btrim(order_id), '') IS NULL
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'httpStatus', 409,
      'error', 'Storage request is no longer pending.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'plan', v_request.plan,
      'amount_inr', v_request.amount_inr,
      'utr', v_request.utr,
      'reviewed_at', v_request.reviewed_at,
      'reviewer_note', v_request.reviewer_note
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_legacy_milan_storage_request(text, text)
  FROM PUBLIC;

-- Dedicated non-login owner for the SECURITY DEFINER payment RPCs.
-- CREATE is temporary and removed after function ownership is transferred.
GRANT USAGE, CREATE ON SCHEMA public TO milan_pay_fn_owner;
GRANT SELECT, UPDATE ON TABLE
  public.users, public.payment_orders, public.storage_upgrade_requests
  TO milan_pay_fn_owner;

ALTER FUNCTION public.admin_approve_milan_pay_storage_request(text, text)
  OWNER TO milan_pay_fn_owner;
ALTER FUNCTION public.admin_reject_milan_pay_storage_request(text, text)
  OWNER TO milan_pay_fn_owner;
ALTER FUNCTION public.admin_reject_legacy_milan_storage_request(text, text)
  OWNER TO milan_pay_fn_owner;
REVOKE CREATE ON SCHEMA public FROM milan_pay_fn_owner;

-- Runtime permissions required by current Voroa-backed application paths.
GRANT USAGE ON SCHEMA public TO milan_app;

-- Users: only registration and authentication columns are writable by runtime.
-- Quota and plan remain writable only by the payment function owner.
REVOKE INSERT, UPDATE ON TABLE public.users FROM milan_app;
GRANT SELECT ON TABLE public.users TO milan_app;
GRANT INSERT (
  user_id, name, email, password_hash, did, space_id, portable_did,
  email_verified, email_verification_token_hash,
  email_verification_code_hash, email_verification_expires_at
) ON TABLE public.users TO milan_app;
GRANT UPDATE (
  email_verified, email_verified_at,
  email_verification_token_hash, email_verification_code_hash,
  email_verification_expires_at,
  password_reset_token_hash, password_reset_code_hash,
  password_reset_expires_at, password_hash, updated_at
) ON TABLE public.users TO milan_app;

-- The application may create pending orders, but cannot choose their status.
REVOKE INSERT, UPDATE ON TABLE public.payment_orders FROM milan_app;
GRANT SELECT ON TABLE public.payment_orders TO milan_app;
GRANT INSERT (user_id, order_id, plan, amount_inr, gateway, gateway_reference)
  ON TABLE public.payment_orders TO milan_app;

-- Only the legacy rejection path needs direct updates to request review fields.
REVOKE INSERT, UPDATE ON TABLE public.storage_upgrade_requests FROM milan_app;
GRANT SELECT ON TABLE public.storage_upgrade_requests TO milan_app;
GRANT INSERT (
  user_id, order_id, plan, quota_bytes, amount_inr, payment_method, utr
) ON TABLE public.storage_upgrade_requests TO milan_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dwn_storage TO milan_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.milan_database_snapshots TO milan_app;
REVOKE INSERT, UPDATE ON TABLE public.webauthn_challenges FROM milan_app;
GRANT SELECT ON TABLE public.webauthn_challenges TO milan_app;
GRANT INSERT (user_id, challenge, purpose, expires_at)
  ON TABLE public.webauthn_challenges TO milan_app;
GRANT UPDATE (used_at)
  ON TABLE public.webauthn_challenges TO milan_app;

REVOKE INSERT, UPDATE ON TABLE public.webauthn_credentials FROM milan_app;
GRANT SELECT ON TABLE public.webauthn_credentials TO milan_app;
GRANT INSERT (
  user_id, did, credential_id, webauthn_user_id, public_key,
  counter, transports, device_type, backed_up
) ON TABLE public.webauthn_credentials TO milan_app;
GRANT UPDATE (counter, updated_at)
  ON TABLE public.webauthn_credentials TO milan_app;

-- Historical unmatched payment archives are not runtime application tables.
REVOKE ALL ON TABLE public.milan_legacy_payment_orders FROM PUBLIC, milan_app;
REVOKE ALL ON TABLE public.milan_legacy_storage_upgrade_requests FROM PUBLIC, milan_app;

GRANT EXECUTE ON FUNCTION public.admin_approve_milan_pay_storage_request(text, text)
  TO milan_app;
GRANT EXECUTE ON FUNCTION public.admin_reject_milan_pay_storage_request(text, text)
  TO milan_app;
GRANT EXECUTE ON FUNCTION public.admin_reject_legacy_milan_storage_request(text, text)
  TO milan_app;

COMMIT;
