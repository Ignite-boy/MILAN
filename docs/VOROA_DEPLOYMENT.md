# Voroa deployment runbook

## Main website and API

Create a Voroa Node.js web service from `Ignite-boy/MILAN` using the migration branch until it is reviewed and ready for production.

- Repository root: `/`
- Runtime: Node.js 24
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Port: the server reads `process.env.PORT` and binds to `0.0.0.0`

The Express service serves both `frontend/` and the `/api/*` endpoints; no Vercel function adapters or rewrite file are required.

## Required environment

Add encrypted environment variables in Voroa, not in Git:

- `MILAN_DATABASE_URL`: Voroa PostgreSQL connection URL (`DATABASE_URL` is an accepted fallback)
- `JWT_SECRET`: stable high-entropy auth signing secret
- `DID_KEY_ENCRYPTION_SECRET`: stable encryption secret for portable DID data
- `NODE_ENV=production`
- `PUBLIC_BASE_URL=https://milanlife.in`
- `CORS_ORIGIN=https://milanlife.in,https://www.milanlife.in`

Add SMTP or an email API key and any optional AI/payment integration values needed by the product. Never copy real secrets into this file or commit them.

## Database readiness

Before using a new Voroa database, verify connectivity and required tables. The preflight workflow checks for `public.users` and `public.dwn_storage`; additional features can require migrations in `backend/migrations/`. Review the SQL against the target database and take a backup before applying schema changes.

The app's authoritative record and media code uses PostgreSQL. The normal server filesystem is only a processing/cache area. The default PostgreSQL media cap is 768 MiB, so configure upload limits consistently and test at the boundary.

## Custom-domain cutover

Attach `milanlife.in` and, if needed, `www.milanlife.in` to the new Voroa service only after the deployment is live. Use the DNS records displayed by Voroa. Do not guess A, CNAME, or TXT records.

## Required production gates

1. CI passes `npm run build`, `npm run test:security`, `npm run test:chat`, and `npm run test:upload`.
2. The Voroa service is running and both `/health` and `/api/health` respond.
3. A read/write check proves Voroa PostgreSQL is available.
4. Authentication, private-record authorization, snapshot sync/hydration, resumable uploads, media range playback, and restart persistence pass end-to-end checks.
5. The public custom domain resolves to the working Voroa service over HTTPS.

The site is not 100% complete merely because a deploy succeeds. Record each gate's observed result before calling the migration complete.
