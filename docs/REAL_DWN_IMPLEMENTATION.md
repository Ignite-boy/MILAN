# DWN protocol status — MILAN

## Verified state

The main MILAN API's current persistence implementation is Supabase-authoritative. The canonical C++ component under `DWN/` is a separate LevelDB-backed C++20 target. The current main API metadata explicitly sets `realDwnProtocol: false`; the source tree does not contain the previously documented `backend/services/realDwnEngine.js`.

Therefore, this repository does **not** currently establish that production web requests execute signed DWN `RecordsWrite` / `RecordsQuery` messages against an isolated protocol node for every user.

## What the production code currently does

- Uses DID and per-user space identifiers to associate application records with a user.
- Stores record metadata/data and database snapshots through Supabase-backed tables; media paths use Supabase Storage configuration.
- Reports Supabase persistence status separately from a real protocol-engine readiness signal.
- Contains a standalone C++ DWN experiment in `DWN/`, whose canonical CMake build links LevelDB and excludes `src/postgres_storage.cpp`.

A Supabase tenant row is evidence of a configured tenant record; it is **not** evidence that a DWN protocol engine is running or that cryptographic protocol messages were verified.

## Production claims that are not yet supported

Until a real engine is integrated and exercised end-to-end, do not describe these as established production guarantees:

- one independent running DWN node per account;
- signed protocol messages executed by that node;
- protocol-level RecordsWrite/RecordsQuery status codes;
- a durable portable DID private key available after deployment restarts;
- protocol-level isolation verified by cross-tenant tests.

## Acceptance gate for a future protocol integration

A future implementation should not set `realDwnProtocol: true` until all of the following exist and pass:

1. A tracked, maintained engine implementation and pinned SDK/dependency versions.
2. Durable key/identity lifecycle with documented backup/recovery and no private key leakage.
3. Authenticated tenant resolution derived from verified identity, not caller-supplied space IDs.
4. Signed RecordsWrite and RecordsQuery integration tests that assert protocol response codes and returned record content.
5. Cross-tenant tests proving one identity cannot read, update or delete another tenant's records.
6. Restart/redeploy persistence tests against the real configured durable store.
7. Runtime health that distinguishes `storageReady`, `tenantConfigured`, and `protocolReady`.
8. Production deployment, secret and backup verification with recorded evidence.

Do not flip the protocol-ready flag based on a database row, a successful HTTP health response, or the presence of the C++ source folder alone.
