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

The current source accepts caller-provided `user_id` and `session_id` for memory namespacing, and the route source reviewed during consolidation did not contain a verified authentication dependency. Do not expose that route as a secure multi-user memory service until server-verified identity is enforced and tested. The Render service discovered during review still points to the old pre-consolidation repository; a commit to this monorepo does not deploy that external service until its binding is corrected.

### C++ DWN component

`DWN/CMakeLists.txt` builds the LevelDB implementation and excludes `src/postgres_storage.cpp`. The old PostgreSQL connection settings were removed from `DWN/config/example.env` to avoid implying unsupported storage selection.

## Validation rule

Environment variables are configuration inputs, not proof of successful integrations. A deployment should expose only sanitized readiness flags (configured / unavailable) and use service-specific tests to verify actual writes, reads, authentication, authorization, retention and restart persistence.
