BEGIN;

-- Apply with an authorized database owner before deploying app code that
-- requires auth_token_version. CI never executes this migration on production.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_token_version integer NOT NULL DEFAULT 0;

-- The runtime role may update this revocation counter while other protected
-- user columns remain governed by the existing column-level grants.
GRANT UPDATE (auth_token_version) ON TABLE public.users TO milan_app;

COMMENT ON COLUMN public.users.auth_token_version IS
  'Monotonic session-revocation counter embedded in signed JWTs.';

COMMIT;
