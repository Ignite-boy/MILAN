# MILAN — the MILAN-ONE ecosystem

**Public product:** [milanlife.in](https://milanlife.in/)  
**Repository:** `Ignite-boy/MILAN`  
**Internal system name:** **MILAN-ONE** — one consolidated codebase and operating model for the MILAN application and its companion components. The public product remains named MILAN; MILAN-ONE is not a claim of affiliation with Google One, Meta, or any other company.

MILAN is a privacy-oriented social application built around DID-based identity concepts and user-scoped data. This repository consolidates the web application, API, quality tooling, a C++ DWN experiment, a travel-agent prototype, and supporting tools in one place.

## Current architecture — source of truth

| Layer | Current implementation |
|---|---|
| Web frontend | Static HTML, CSS, JavaScript and assets in `frontend/`, served by the Express application. |
| HTTP/API | Long-lived Express application in `backend/server.js`; the same service handles the frontend and `/api/*` routes. |
| Authoritative persistence | Voroa PostgreSQL for user snapshots, records, resumable uploads and media bytes. `MILAN_DATABASE_URL` connects the service to PostgreSQL. |
| Identity and user spaces | DID and per-user space identifiers are associated with authoritative user records. A logical per-user namespace is not by itself proof of a live standards-compliant DWN node. |
| C++ DWN component | Standalone experimental implementation in `DWN/`; its canonical CMake target uses LevelDB. It is **not currently verified as the protocol engine used by the main production API**. |
| Quality/testing | `Milan-Sentinel/` defines a 10,000,000-combination Cartesian test space. Only cases with implemented adapters can produce PASS; unimplemented combinations must be SKIP. |
| Other components | `Travel-Agent/`, `DWN-Wallet/`, `Inventory/` and `Live-UI-Update/` are consolidated components with different maturity levels; do not infer production readiness from their presence in this repository. |

## Important architecture boundary

The main API reports `realDwnProtocol: false` in its current persistence metadata. Voroa PostgreSQL persistence and DID-scoped application records are part of the current implementation, but signed DWN protocol execution by a dedicated per-user DWN engine is **not verified in the main production path**. The former documentation describing `backend/services/realDwnEngine.js` did not match the current source tree and has been corrected.

Similarly, the C++ DWN subproject and the wallet/travel components are standalone or experimental until their own integration, persistence, authorization, deployment and end-to-end tests pass. The repository's directory layout is not proof that these services are deployed from this monorepo.

## Local verification

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run build
npm run test:chat
npm --prefix Milan-Sentinel ci
npm --prefix Milan-Sentinel run validate
npm --prefix Milan-Sentinel run smoke
```

- `npm run build` is a repository/configuration integrity check, not a frontend bundler.
- `Milan-Sentinel run validate` verifies the test-space definition; it does not execute 10 million tests.
- `Milan-Sentinel run smoke` executes a small, representative set of supported adapters and reports unsupported cases as SKIP.
- Production smoke tests are limited to endpoints explicitly listed in the workflow; a green check does not prove every product flow or external provider works.

## Environment and deployment

Use `backend/.env.example` as a template only. Required production secrets must be created in the hosting provider's secret manager and must never be committed. See [the environment contract](docs/ENVIRONMENT_CONTRACT.md) and [MILAN-ONE architecture/status](docs/MILAN_ONE_ARCHITECTURE.md).

Deploy the repository root as a Node.js web service on Voroa. Use `npm ci && npm run build` as the build command and `npm start` as the start command. Configure `MILAN_DATABASE_URL` (or `DATABASE_URL`) for Voroa PostgreSQL plus the required authentication secrets. Set the custom domain to the Voroa service only after the service and database checks pass; a repository commit alone does not prove the live domain has moved.

## Operating principles

1. **Evidence over labels:** a feature is PASS only when its adapter verifies a meaningful outcome.
2. **No silent fallback claims:** report cloud persistence, logical namespacing and actual DWN protocol execution as distinct capabilities.
3. **Fail closed on identity and authorization:** client-supplied user/session identifiers must not be treated as authenticated identity.
4. **One canonical web source:** `frontend/` is the production static frontend. `Live-UI-Update/` contains tools/automation and must not become a second source of truth for deployed UI files.
5. **Bounded automation:** AI-generated updates must run as a single bounded cycle with explicit gates, not recursively trigger themselves forever.
6. **Production readiness is proven per component:** code presence, a successful build, or an HTTP 200 health check alone is insufficient.

## Repository map

- `frontend/` — production static web surface
- `backend/` — Express API, authorization, records and persistence integrations
- `Milan-Sentinel/` — matrix definition and executable checks
- `DWN/` — standalone C++/LevelDB DWN experiment
- `Travel-Agent/` — FastAPI/LangGraph travel prototype
- `DWN-Wallet/` — wallet prototype
- `Inventory/`, `Live-UI-Update/`, `Milan-Sentinel/` — companion utilities and tooling

---

**MILAN — Your Space. Your People.**  
**MILAN-ONE — one codebase, explicit boundaries, evidence-backed behavior.**
