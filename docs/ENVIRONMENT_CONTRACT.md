# MILAN-ONE environment contract

This file documents names and minimum intent. It contains no production secrets. Never commit actual keys or tokens.

## Main MILAN API — production required

| Variable | Required | Purpose / rule |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL used by the main data store. |
| `SUPABASE_SERVICE_KEY` | Yes | Server-only service key used by backend persistence. Must never reach browser code or Git. |
| `JWT_SECRET` | Yes | Stable secret shared by every runtime that issues/verifies MILAN JWTs. Use high entropy (at least 32 random bytes); application currently refuses production secrets shorter than 16 characters. Rotating it invalidates active sessions. |
| `CORS_ORIGIN` | Optional | Comma-separated exact allowed origins, e.g. `https://milanlife.in,https://www.milanlife.in`. If omitted, built-in production origins are used. Do not use wildcard origins for authenticated API requests. |
| `SUPABASE_BUCKET` | Optional | Storage bucket used by general DWN helper; defaults to `milan-dwn-storage`. |
| `SUPABASE_MEDIA_BUCKET` | Optional | Media bucket; defaults to `milan-dwn-storage`. Confirm bucket visibility/policies in Supabase before production use. |
| `NODE_ENV` | Production host | Must be `production` on production hosts so auth startup safety applies. |

## Optional providers

- Email: configure a supported mail-provider API key or SMTP credentials; otherwise mail features may skip sending.
- Payments: verify Cashfree/Cashfree environment and price configuration in provider dashboards; an example file with `sandbox` is not proof of live payment readiness.
- AI: API keys enable providers but do not make every AI route available or accurate.
- `MILAN_DATA_ROOT` / `MILAN_CLOUD_DWN_ROOT`: file/cache location settings. On serverless storage, local disk is not a durability guarantee.

## Component-specific services

### Travel Agent

`/chat` now requires an HTTP Bearer token and asks the primary MILAN identity endpoint (`MILAN_AUTH_URL`, default `https://milanlife.in/api/auth/me`) to verify it. The chat handler derives its user ID from the verified response, rejects a conflicting body `user_id`, and namespaces graph thread IDs under that account. Missing/invalid credentials are rejected; identity-service outages return 503 rather than silently trusting the caller. The default Render blueprint includes this URL, and `Travel-Agent/tests/test_auth.py` covers valid/invalid tokens, verifier outages, HTTPS enforcement and cross-account ID rejection.

**Deployment caveat:** the current Render service still points to the old pre-consolidation repository. Rebind it to `Ignite-boy/MILAN` with root directory `Travel-Agent` and redeploy before treating this new source behavior as live.

### C++ DWN component

`DWN/CMakeLists.txt` builds the LevelDB implementation and excludes `src/postgres_storage.cpp`. The old PostgreSQL connection settings were removed from `DWN/config/example.env` to avoid implying unsupported storage selection.

## Validation rule

Environment variables are configuration inputs, not proof of successful integrations. A deployment should expose only sanitized readiness flags (configured / unavailable) and use service-specific tests to verify actual writes, reads, authentication, authorization, retention and restart persistence.
