BEGIN;

-- PostgreSQL shared rate limiter. Review before deployment.
CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_updated_idx
  ON public.api_rate_limit_buckets (updated_at);

ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz;
  v_window_start timestamptz;
  v_count integer;
  v_retry_after integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
     OR p_window_seconds IS NULL
     OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid rate-limit arguments.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.api_rate_limit_buckets
    (key_hash, window_start, request_count, updated_at)
  VALUES
    (p_key_hash, clock_timestamp(), 0, clock_timestamp())
  ON CONFLICT (key_hash) DO NOTHING;

  -- Lock first and sample the time after acquiring the lock.
  SELECT window_start, request_count
    INTO v_window_start, v_count
    FROM public.api_rate_limit_buckets
   WHERE key_hash = p_key_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rate-limit bucket could not be locked.';
  END IF;

  v_now := clock_timestamp();

  IF v_window_start + make_interval(secs => p_window_seconds) <= v_now THEN
    v_window_start := v_now;
    v_count := 1;
  ELSE
    v_count := LEAST(v_count + 1, p_limit + 1);
  END IF;

  UPDATE public.api_rate_limit_buckets
     SET window_start = v_window_start,
         request_count = v_count,
         updated_at = v_now
   WHERE key_hash = p_key_hash;

  v_retry_after := GREATEST(
    1,
    CEIL(EXTRACT(EPOCH FROM (
      v_window_start + make_interval(secs => p_window_seconds) - v_now
    )))::integer
  );

  -- Best-effort bounded cleanup, sampled across hash space.
  IF get_byte(decode(substr(p_key_hash, 1, 2), 'hex'), 0) % 16 = 0 THEN
    DELETE FROM public.api_rate_limit_buckets
     WHERE key_hash IN (
       SELECT key_hash
         FROM public.api_rate_limit_buckets
        WHERE updated_at < v_now - interval '2 days'
        ORDER BY updated_at
        LIMIT 200
        FOR UPDATE SKIP LOCKED
     );
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'limit', p_limit,
    'remaining', GREATEST(0, p_limit - v_count),
    'retryAfterSeconds', v_retry_after
  );
END;
$function$;

-- The non-login function owner owns the bucket table; the app can only call the RPC.
GRANT USAGE, CREATE ON SCHEMA public TO milan_rate_limit_fn_owner;
ALTER TABLE public.api_rate_limit_buckets OWNER TO milan_rate_limit_fn_owner;
ALTER FUNCTION public.consume_api_rate_limit(text, integer, integer)
  OWNER TO milan_rate_limit_fn_owner;
REVOKE CREATE ON SCHEMA public FROM milan_rate_limit_fn_owner;

REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC, milan_app;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
  TO milan_app;

COMMIT;
