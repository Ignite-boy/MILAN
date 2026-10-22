# MILAN-ONE environment contract — Voroa

This file documents configuration names and minimum intent. It contains no production secrets. Never commit actual keys or tokens.

## Main MILAN web service

| Variable | Required | Purpose / rule |
|---|---|---|
| `MILAN_DATABASE_URL` (or `DATABASE_URL`) | Yes | PostgreSQL connection string for the Voroa managed database. `backend/services/milanDb.js` reads `MILAN_DATABASE_URL` first. |
| `JWT_SECRET` | Yes | High-entropy secret for MILAN JWT issuance and verification; keep stable across deploys. Rotating it invalidates existing sessions. |
| `DID_KEY_ENCRYPTION_SECRET` | Production use | Keep stable; rotating it can make encrypted portable DID material unreadable unless migrated. |
| `NODE_ENV` | Production service | Set to `production` so production auth and cookie/security behavior is used. |
| `CORS_ORIGIN` | Optional | Comma-separated exact browser origins, e.g. `https://milanlife.in,https://www.milanlife.in`. Avoid wildcards for authenticated requests. |
| `PUBLIC_BASE_URL` | Recommended | Canonical HTTPS domain used for links and service URLs; set this to the Voroa-connected custom domain after DNS is switched. |

## Persistence and uploads

- Voroa PostgreSQL is the authoritative store for users, snapshots, records, resumable upload sessions/chunks, and media bytes in `public.dwn_storage`.
- The database must have the schema expected by the application. At minimum, the Voroa preflight checks `public.users` and `public.dwn_storage`; payment, WebAuthn, email-auth, and rate-limit features may require the additional migrations in `backend/migrations/`.
- The local filesystem is scratch/cache storage for media processing, not a durability guarantee. Do not rely on local files as the only copy of user data or media.
- Large media is written into PostgreSQL and is limited by `MILAN_MAX_VOROA_MEDIA_BYTES` (default 768 MiB). Set upload limits consistently; a route-level maximum does not override the PostgreSQL media cap.

## Optional integrations

- Email: configure one supported mail API key or SMTP credentials. Verify the sending domain/mailbox first. Without a provider, mail can be skipped/logged.
- AI features: optional provider keys include `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`.
- Redis-compatible cache: `KV_URL_REDIS_URL` is optional; when absent, Redis-specific login sync is disabled.
- Travel Agent: if this companion API is enabled, deploy it as a separate Voroa service with the repository root directory `Travel-Agent`; configure `MILAN_AUTH_URL` to the main MILAN API and `TRAVEL_AGENT_URL` in the main service.

## Voroa web service

Use the repository root, Node.js 24, build command `npm ci && npm run build`, and start command `npm start`. Configure database/authentication secrets in Voroa’s encrypted environment settings. Verify `/health`, `/api/health`, registration/auth, record CRUD, media uploads/playback, and persistent data across a service restart before changing the custom domain.

A successful build or HTTP liveness response is not proof that authentication, database writes, media retention, and all product flows work end-to-end.
