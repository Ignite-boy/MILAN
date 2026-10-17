BEGIN;

-- Shared, atomic rate-limit counters for serverless instances.
-- Store only an HMAC-derived bucket key, never the client's raw IP.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  key_hash text PRIMARY KEY
    CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE public.api_rate_limit_buckets OWNER TO postgres;

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_updated_at_idx
  ON public.api_rate_limit_buckets (updated_at);

ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- No application role receives direct access to the counter table.
REVOKE ALL ON TABLE public.api_rate_limit_buckets
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_cleanup_cutoff timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
  v_rows_inserted integer := 0;
  v_reset_at timestamptz;
BEGIN
  IF p_key_hash IS NULL
     OR p_key_hash !~ '^[a-f0-9]{64}$'
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
     OR p_window_seconds IS NULL
     OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid API rate limit parameters'
      USING ERRCODE = '22023';
  END IF;

  -- Opportunistically clean at most 500 stale buckets without waiting on locked rows.
  IF random() < 0.005 THEN
    DELETE FROM public.api_rate_limit_buckets
     WHERE ctid IN (
       SELECT ctid
         FROM public.api_rate_limit_buckets
        WHERE updated_at < v_cleanup_cutoff - interval '2 days'
        ORDER BY updated_at
        LIMIT 500
        FOR UPDATE SKIP LOCKED
     );
  END IF;

  -- Insert a new bucket if absent. Existing-key requests are serialized below.
  INSERT INTO public.api_rate_limit_buckets (
    key_hash, window_started_at, request_count, updated_at
  )
  VALUES (
    p_key_hash, clock_timestamp(), 1, clock_timestamp()
  )
  ON CONFLICT (key_hash) DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  SELECT bucket.window_started_at, bucket.request_count
    INTO v_window_started_at, v_request_count
    FROM public.api_rate_limit_buckets AS bucket
   WHERE bucket.key_hash = p_key_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rate-limit bucket disappeared during update.';
  END IF;

  -- Capture time after the row lock, so contention cannot reuse a stale timestamp.
  v_now := clock_timestamp();

  IF v_rows_inserted > 0
     OR v_window_started_at
          + make_interval(secs => p_window_seconds::double precision) <= v_now THEN
    v_window_started_at := v_now;
    v_request_count := 1;
  ELSE
    v_request_count := LEAST(v_request_count + 1, p_limit + 1);
  END IF;

  UPDATE public.api_rate_limit_buckets
     SET window_started_at = v_window_started_at,
         request_count = v_request_count,
         updated_at = v_now
   WHERE key_hash = p_key_hash;

  v_reset_at := v_window_started_at
    + make_interval(secs => p_window_seconds::double precision);

  RETURN jsonb_build_object(
    'allowed', v_request_count <= p_limit,
    'limit', p_limit,
    'remaining', GREATEST(0, p_limit - v_request_count),
    'retryAfterSeconds',
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::integer)
  );
END;
$function$;

ALTER FUNCTION public.consume_api_rate_limit(text, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.consume_api_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.consume_api_rate_limit(text, integer, integer)
  TO service_role;

COMMIT;
