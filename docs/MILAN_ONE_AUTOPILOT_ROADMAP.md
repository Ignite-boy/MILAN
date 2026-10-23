# MILAN-ONE Autopilot Roadmap

Progress is the sum of verified, merged task weights.
One task per run. The next task starts only after the production pipeline succeeds.

- [x] A01 (5%) Align media byte limits and regression tests.
  - Acceptance: backend, frontend and storage limits agree with the canonical architecture contract; boundary tests pass.
- [x] A02 (5%) Separate liveness, database readiness and real-DWN readiness.
  - Acceptance: health reporting is truthful; no mock or logical namespace is labelled a real protocol engine; regression tests pass.
- [x] A03 (10%) Verify authentication, session invalidation and token-version behavior.
  - Acceptance: login, revocation, token expiry and session boundaries have regression tests; no security test is weakened.
- [x] A04 (10%) Verify authenticated-user and DID/space authorization boundaries.
  - Acceptance: cross-user access to protected resources is rejected and tested.
- [x] A05 (10%) Make authoritative persistence failures observable and social-state persistence consistent.
  - Acceptance: critical PostgreSQL write failures cannot be reported as successful; persistence semantics are documented and tested.
- [x] A06 (10%) Verify private-chat isolation, feed ordering and pagination.
  - Acceptance: private data never leaks into public feeds; deterministic cursors produce no duplicates or gaps in tested cases.
- [x] A07 (10%) Harden uploads, retries, resumable chunks and video range playback.
  - Acceptance: ownership, idempotency, size limits and byte-range behavior have regression coverage.
- [ ] A08 (10%) Harden payment ownership, idempotency and storage quota upgrades.
  - Acceptance: unauthorized and repeated payment transitions cannot grant quota twice; manual verification is represented truthfully.
- [ ] A09 (20%) Verify the real-DWN adapter and signed record read/write integration.
  - Acceptance: use an actual selected protocol engine and verify signatures, authorization and round trips; otherwise report a blocker and never claim protocol readiness.
- [ ] A10 (10%) Complete release readiness, recovery, restore, rollback and operating documentation.
  - Acceptance: supported backup/restore and rollback procedures are verifiable; build, security, integration and deployment checks pass.

## Non-weighted production release gates

These gates do not add to the A01–A10 implementation progress percentage. **100% weighted implementation progress is not a production-readiness claim while any R gate is open.** These gates require an explicit operator/owner decision and may not be ticked by the autonomous coding agent.

- [ ] R01 (P0) Resolve and independently verify the 22 October 2026 production database incident.
  - Audit baseline: the 22 October audit recorded 10 `milan_db` tables at zero rows after a TRUNCATE operation; no completed restore was evidenced in that audit. This is a historical finding, not confirmation of the database's current state.
  - Acceptance: a database owner/provider documents the recovery outcome and recovery point; independently verifies representative user/login, record/media, payment and WebAuthn state in a safe recovery target; records the data-loss window; and confirms production cutover or an approved incident/recreation plan if restore is unavailable.
  - Safety: autopilot must never connect to or mutate production data. It must leave this gate unchecked until an authorized owner records evidence and manually updates the gate through review.

All tasks total 100%. A build passing alone does not mean MILAN-ONE is complete.
Weighted progress measures accepted implementation tasks only. Release gates are independently enforced and must be closed before describing MILAN-ONE as production-ready.
