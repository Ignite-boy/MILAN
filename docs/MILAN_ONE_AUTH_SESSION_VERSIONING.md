# MILAN authoritative session versioning

Password and DID/ID3 login issue JWTs with the `tv` claim read from
`public.users.auth_token_version`. Authenticated HTTP and WebSocket requests
verify signature and expiry, then compare this claim to PostgreSQL. Missing or
malformed version claims fail closed; pre-existing tokens therefore need to be
reissued by signing in again after deployment. The SSE endpoint uses the HTTP
authentication middleware.

Password change atomically updates the authoritative password hash and bumps
the session version, using the old hash as a concurrency guard. Password reset,
logout-all and account deactivation also increment the PostgreSQL version.
Failures to write authoritative session state are returned as errors, not
success responses.

## Deployment order

1. Review `backend/migrations/20261023_postgresql_auth_sessions.sql`.
2. Have the authorized database owner apply it in the intended environment.
3. Verify `milan_app` can update the version column while its other user-column
   permissions remain restricted.
4. Deploy the application only after the migration is confirmed, then verify
   login, expiration, password reset/change, logout-all and revocation across
   HTTP, SSE and WebSocket.
5. Expect existing unversioned tokens to require a new sign-in.

The self-test uses a fake in-memory database client and test JWTs. It does not
prove that the migration is applied or that production sessions were revoked.
