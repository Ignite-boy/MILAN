# MILAN-ONE architecture and Google Cloud deployment target

This document describes the intended production architecture for the provider-removal branch. It is not proof that Google Cloud hosting, the database, or the custom domain has been provisioned.

## Target runtime

| Layer | Source of truth | Responsibility |
|---|---|---|
| Public web UI | `frontend/` | Static HTML, CSS, JavaScript, and assets |
| HTTP/API | `backend/server.js` | One long-lived Express service serves the frontend and all `/api/*` routes |
| Database | Google Cloud managed PostgreSQL via `MILAN_DATABASE_URL` | User snapshots, identity mappings, records, resumable-upload sessions/chunks, and media bytes |
| Temporary files | Node service local filesystem | Upload assembly, media transcoding, and cache only; not the durable source of truth |
| Optional Travel Agent | `Travel-Agent/` | Separate FastAPI service if enabled; requires its own Google Cloud deployment and explicit auth URL |

## Persistence and identity boundaries

- PostgreSQL persistence is the main app's authoritative backend. A successful HTTP health response means the process is alive; it does not prove every database write, auth path, upload, payment, or media-playback flow works.
- Per-user DID/space identifiers provide application-level scoping; the identifier alone is not proof of a standards-compliant, signed Decentralized Web Node protocol engine.
- The main API currently reports `realDwnProtocol: false`. Do not describe the experimental C++ DWN folder or the wallet prototype as the production protocol engine without end-to-end evidence.
- The media path writes file bytes into `public.dwn_storage`. A shared limit governs chunk initialization, direct upload, DWN ingestion and PostgreSQL persistence; the default is 768 MiB and the canonical setting is `MILAN_MAX_MEDIA_BYTES`.
- Local files are temporary processing/cache copies. Durable user records and media must be committed to PostgreSQL, and that data must survive a service restart.

## Google Cloud deployment settings

Use the GitHub repository `Ignite-boy/MILAN`, the intended production branch, repository root as the service root, Node.js 24, build command `npm ci && npm run build`, and start command `npm start`.

Configure these as encrypted environment values in Google Cloud, never in Git:
- `MILAN_DATABASE_URL` pointing to the Cloud SQL for PostgreSQL database (the app also accepts `DATABASE_URL`)
- `JWT_SECRET` and `DID_KEY_ENCRYPTION_SECRET`
- `NODE_ENV=production`
- `PUBLIC_BASE_URL=https://milanlife.in` and an exact `CORS_ORIGIN` allowlist after the domain is attached
- Optional SMTP/API keys required by email and AI features

Apply the schema/migrations required by the application's routes before considering the database ready. The read-only preflight requires at least `public.users` and `public.dwn_storage`; optional payment, WebAuthn, and rate-limit features can need their corresponding migrations.

## Domain cutover and validation gates

The observed public domain response in this migration effort was HTTP 404 with a deployment-not-found signal. That identifies a missing deployment target, not a successful Google Cloud deployment.

Do not declare the migration complete until:
1. `npm ci`, `npm run build`, and the chat, security, payment, and upload tests pass.
2. Google Cloud reports a successful production deploy and `/health` responds.
3. `/api/health` confirms the expected Google Cloud persistence configuration; a separate read/write check proves the database is reachable.
4. Registration/login, snapshot sync/hydration, private record permissions, chunk retry/resume, media upload/range playback, and restart persistence pass smoke tests.
5. The custom domain is connected to the working Cloud Run service and HTTPS succeeds for both apex and `www` as configured.
6. Only after those gates pass should any legacy provider bindings be considered fully retired.

A green build, a single HTTP 200, code presence, or this document alone is not evidence of 100% production readiness.
