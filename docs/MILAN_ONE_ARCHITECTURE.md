# MILAN-ONE — internal architecture and ambiguity register

**Status:** consolidation baseline, October 2026  
**Public product:** MILAN at https://milanlife.in  
**System name:** MILAN-ONE is the internal name for the single consolidated codebase and its operating contract. It does not imply affiliation with Google, Meta or any unrelated company.

## 1. System boundaries

| Component | Current location | What is verified from source | What must not be inferred |
|---|---|---|---|
| Public web UI | `frontend/` | Static HTML/CSS/JS/assets; Vercel `outputDirectory` is `frontend` | Next.js app/router or compile-time bundle |
| Express API | `backend/server.js`, exported by `api/index.js` | Express routes, API health, auth middleware, Supabase client usage | An always-on host's in-memory rate limit is globally distributed |
| Data layer | `backend/services/cloudDwnRegistry.js`, `backend/utils/dwnStorage.js` | Supabase is declared authoritative; records/snapshots/media use Supabase paths | This alone is a standards-compliant live DWN protocol implementation |
| DWN C++ experiment | `DWN/` | C++20 target, LevelDB linked, PostgreSQL source excluded from canonical build | That main API invokes its protocol/server |
| Sentinel | `Milan-Sentinel/` | 10M theoretical Cartesian product; subset adapters only | 10M end-to-end executed tests |
| RSI | `Milan-RSI-Agent/` | Repair-analysis and patch-generation scripts | Safe autonomous production code mutation without isolation/review |
| Travel agent | `Travel-Agent/` | FastAPI/LangGraph source now verifies MILAN Bearer tokens through the MILAN identity endpoint and scopes graph/memory IDs by verified user | Dedicated deployment is not yet verified; live flight/hotel prices are not guaranteed (the tool contains mock fallbacks) |
| Wallet | `DWN-Wallet/` | Prototype, including in-memory store code | Durable wallet state or connected production transfer routes |
| UI updater | `Live-UI-Update/` | AI/helper scripts, SEO tooling and workflow source | A second canonical copy of the production UI |

## 2. Canonical decisions

- **Frontend source of truth:** `frontend/`. `Live-UI-Update/` is a tooling/automation directory; its overlapping files must not silently override production content.
- **Main persistence:** Supabase-backed application storage is authoritative in the current main API. Local files are compatibility/cache/runtime support and are not automatically durable on serverless platforms.
- **Real DWN capability:** current main API status is `realDwnProtocol: false`. The user-space/DID model is not a claim of an active protocol node. See `REAL_DWN_IMPLEMENTATION.md`.
- **DWN language:** canonical CMake builds LevelDB and excludes the PostgreSQL source overlay. Do not document PostgreSQL as the selected C++ storage driver until that target includes, builds and tests it.
- **Test reporting:** `caseCount=10000000` is theoretical matrix cardinality. Only executed, adapter-backed assertions can PASS; unsupported adapters/dimensions must SKIP.
- **RSI behavior:** push is opt-in; model-produced patches remain proposals until verified. The repair workflow must target this consolidated repo and not deleted pre-consolidation repository names.
- **Automation:** a manually started AI UI workflow performs one bounded cycle and stops; it must not trigger itself recursively.
- **Deployment configuration:** GitHub source is consolidated, but infrastructure repositories can still point to previous deleted repositories. Those provider bindings need dashboard/API updates, not README changes.

## 3. Runtime and deployment dependencies

### Main API
The source expects production values for at least `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and a stable high-entropy `JWT_SECRET`. Optional features (email, payments, external AI) require their own credentials and should be represented as configured/unconfigured rather than assumed active. See `ENVIRONMENT_CONTRACT.md`.

The Node API uses an in-process rate-limit map. It is a per-process guard, not a distributed limiter across serverless instances.

### Vercel
The config serves `frontend/` and forwards `/api/*` to `api/index.js`. Static SEO assets should be served from the static output directory, rather than rewrites to absent `/api/seo/*` modules. Production deployment status should be verified against the actual Vercel project/commit because this audit's provider connection could not read the target project's live configuration.

### External service retirement
The current infrastructure account still contains legacy web services outside the main Vercel project. Repository cleanup alone does not retire those services. Only retire them after their callers have been replaced, the Vercel deployments and Supabase persistence have been tested end to end, and production routing has been verified against a known commit.

## 4. External dependencies / operational status requiring provider access

These are not resolvable by editing this repository alone:

- Vercel project API access returned a scope-level 403 during this session; production project settings and deployment identity are not independently verified here.
- The current service list identifies separate DWN and Travel Agent services with repository bindings outside this consolidated project; the provider connection did not expose a verified safe cutover path for those bindings.
- Production secret values are intentionally not read into this document. Their presence and correctness must be verified in the relevant provider secret store.
- Actual authentication, registration, upload/read-back, cross-user isolation, payments, email delivery and durable-storage recovery require production integration tests; simple homepage/health smoke checks do not prove them.

## 5. Priority acceptance gates

### P0 — security/correctness
- Enforce authenticated identity for any multi-user memory service; never trust request-body user/session IDs as identity.
- Keep query-string bearer tokens scoped to the exact GET Server-Sent Events route that needs browser EventSource compatibility.
- Return a protocol-ready status only when a real DWN protocol engine is present and checked.
- Ensure test results cannot report unsupported scenarios as PASS.
- Restrict browser-origin CORS access to the actual production origin list.

### P1 — truth and deployment
- Keep production versions derived from root `package.json`.
- Make the root build verify files/configuration instead of printing a success slogan.
- Make CI test meaningful smoke cases and report SKIP/FAIL/PASS separately.
- Remove runaway recursive workflow triggering; keep AI deployment runs bounded.
- Align Vercel static SEO routes and API destinations with files that actually exist.
- Deploy companion components to the chosen Vercel/Supabase architecture and retire legacy hosts only after cutover checks pass.
- Choose one build-backed DWN storage implementation (LevelDB currently) and remove misleading unused PostgreSQL environment fields.

### P2 — maintainability/observability
- Keep required and optional environment variables in a single documented contract.
- Ignore generated database/runtime cache files.
- Maintain one canonical UI folder; record duplicate-file cleanup as a controlled migration rather than silently overwriting.
- Add cross-tenant, persistence-after-restart, and provider-specific end-to-end suites before making strong data-ownership/DWN claims.

## 6. Definition of done for “MILAN-ONE”

A consolidation is considered operationally clear only when:
1. one canonical repo and one UI source are declared;
2. each feature is labelled production / experimental / unavailable based on evidence;
3. every test has meaningful PASS, FAIL or SKIP semantics;
4. secrets and provider bindings are checked without committing secret values;
5. backend identity/persistence/protocol readiness are separate concepts;
6. a deployment is tied to a known commit and checked on the actual production host;
7. AI automation is bounded, reviewable and not self-triggering;
8. unsupported behaviors are described as gaps, not renamed as working features.
