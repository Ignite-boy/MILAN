BEGIN;

-- MILAN base PostgreSQL schema.
-- This prerequisite must run before the dated incremental migrations.

CREATE TABLE public.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  did text NOT NULL,
  space_id text NOT NULL,
  portable_did text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_did_nonempty CHECK (btrim(did) <> ''),
  CONSTRAINT users_space_nonempty CHECK (btrim(space_id) <> ''),
  CONSTRAINT users_did_unique UNIQUE (did),
  CONSTRAINT users_space_id_unique UNIQUE (space_id)
);

CREATE UNIQUE INDEX users_email_lower_uidx
  ON public.users (lower(email));

CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  did text NOT NULL,
  credential_id text NOT NULL UNIQUE,
  webauthn_user_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_credentials_user_idx
  ON public.webauthn_credentials (user_id);

CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(user_id) ON DELETE CASCADE,
  challenge text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_challenges_registration_idx
  ON public.webauthn_challenges
     (user_id, purpose, challenge, created_at DESC)
  WHERE user_id IS NOT NULL AND used_at IS NULL;

CREATE INDEX webauthn_challenges_authentication_idx
  ON public.webauthn_challenges (purpose, challenge, created_at DESC)
  WHERE user_id IS NULL AND used_at IS NULL;

CREATE TABLE public.dwn_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_type text NOT NULL,
  did text NOT NULL,
  space_id text NOT NULL,
  item_key text NOT NULL,
  parent_key text,
  schema_uri text,
  data_format text,
  protocol text,
  protocol_path text,
  recipient text,
  published boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_bytes bytea,
  data_cid text,
  data_size bigint NOT NULL DEFAULT 0 CHECK (data_size >= 0),
  payload jsonb,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_modified timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dwn_storage_scope_item_unique
    UNIQUE (did, space_id, component_type, item_key)
);

CREATE INDEX dwn_storage_records_idx
  ON public.dwn_storage
     (did, space_id, component_type, deleted, date_modified DESC, item_key DESC);

CREATE INDEX dwn_storage_component_item_idx
  ON public.dwn_storage (component_type, item_key);

CREATE INDEX dwn_storage_event_parent_idx
  ON public.dwn_storage (did, space_id, parent_key, item_key)
  WHERE component_type = 'event' AND parent_key IS NOT NULL;

CREATE INDEX dwn_storage_quota_idx
  ON public.dwn_storage (did, space_id, component_type, deleted)
  INCLUDE (data_size)
  WHERE component_type IN ('record', 'record_data');

CREATE TABLE public.milan_database_snapshots (
  name text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  pushed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
