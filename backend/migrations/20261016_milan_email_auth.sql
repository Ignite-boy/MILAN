BEGIN;

-- Preserve access for existing accounts while requiring newly created
-- accounts to verify their email.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified boolean,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash text,
  ADD COLUMN IF NOT EXISTS email_verification_code_hash text,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash text,
  ADD COLUMN IF NOT EXISTS password_reset_code_hash text,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;

-- Existing users retain access; don't fabricate historical verification dates.
UPDATE public.users
   SET email_verified = true
 WHERE email_verified IS NULL;

-- Future account inserts are unverified unless explicitly verified.
ALTER TABLE public.users
  ALTER COLUMN email_verified SET DEFAULT false,
  ALTER COLUMN email_verified SET NOT NULL;

COMMENT ON COLUMN public.users.email_verified IS
  'Email verification status. Existing accounts are preserved; new accounts default to unverified.';

COMMIT;
