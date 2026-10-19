BEGIN;

-- Run this prerequisite with an administrative database role.
-- milan_app is created without a password: configure one securely before cutover.
DO $roles$
DECLARE
  v_role record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'milan_app'
  ) THEN
    EXECUTE 'CREATE ROLE milan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  ELSE
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls, rolinherit
      INTO v_role
      FROM pg_catalog.pg_roles
     WHERE rolname = 'milan_app';

    IF NOT v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb
       OR v_role.rolcreaterole OR v_role.rolreplication
       OR v_role.rolbypassrls OR v_role.rolinherit THEN
      RAISE EXCEPTION
        'Existing milan_app role has unsafe attributes; remediate it explicitly.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'milan_pay_fn_owner'
  ) THEN
    EXECUTE 'CREATE ROLE milan_pay_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  ELSE
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls, rolinherit
      INTO v_role
      FROM pg_catalog.pg_roles
     WHERE rolname = 'milan_pay_fn_owner';

    IF v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb
       OR v_role.rolcreaterole OR v_role.rolreplication
       OR v_role.rolbypassrls OR v_role.rolinherit THEN
      RAISE EXCEPTION
        'Existing milan_pay_fn_owner role has unsafe attributes; remediate it explicitly.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'milan_rate_limit_fn_owner'
  ) THEN
    EXECUTE 'CREATE ROLE milan_rate_limit_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  ELSE
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolreplication, rolbypassrls, rolinherit
      INTO v_role
      FROM pg_catalog.pg_roles
     WHERE rolname = 'milan_rate_limit_fn_owner';

    IF v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb
       OR v_role.rolcreaterole OR v_role.rolreplication
       OR v_role.rolbypassrls OR v_role.rolinherit THEN
      RAISE EXCEPTION
        'Existing milan_rate_limit_fn_owner role has unsafe attributes; remediate it explicitly.';
    END IF;
  END IF;

  -- These roles must not inherit other roles or be granted to other roles.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members m
     WHERE m.roleid IN (
       SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('milan_app', 'milan_pay_fn_owner', 'milan_rate_limit_fn_owner')
     )
        OR m.member IN (
       SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('milan_app', 'milan_pay_fn_owner', 'milan_rate_limit_fn_owner')
     )
  ) THEN
    RAISE EXCEPTION
      'Voroa runtime/function-owner roles must not have role memberships.';
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA public
  TO milan_app, milan_pay_fn_owner, milan_rate_limit_fn_owner;

COMMIT;
