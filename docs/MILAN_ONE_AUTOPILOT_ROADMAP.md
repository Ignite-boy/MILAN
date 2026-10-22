# MILAN-ONE Autopilot Roadmap

Progress is the sum of verified, merged task weights.
One task per run. The next task starts only after the production pipeline succeeds.

- [ ] A01 (5%) Align media byte limits and regression tests.
  - Acceptance: backend, frontend and storage limits agree with the canonical architecture contract; boundary tests pass.
- [ ] A02 (5%) Separate liveness, database readiness and real-DWN readiness.
  - Acceptance: health reporting is truthful; no mock or logical namespace is labelled a real protocol engine; regression tests pass.
- [ ] A03 (10%) Verify authentication, session invalidation and token-version behavior.
  - Acceptance: login, revocation, token expiry and session boundaries have regression tests; no security test is weakened.
- [ ] A04 (10%) Verify authenticated-user and DID/space authorization boundaries.
  - Acceptance: cross-user access to protected resources is rejected and tested.
- [ ] A05 (10%) Make authoritative persistence failures observable and social-state persistence consistent.
  - Acceptance: critical PostgreSQL write failures cannot be reported as successful; persistence semantics are documented and tested.
- [ ] A06 (10%) Verify private-chat isolation, feed ordering and pagination.
  - Acceptance: private data never leaks into public feeds; deterministic cursors produce no duplicates or gaps in tested cases.
- [ ] A07 (10%) Harden uploads, retries, resumable chunks and video range playback.
  - Acceptance: ownership, idempotency, size limits and byte-range behavior have regression coverage.
- [ ] A08 (10%) Harden payment ownership, idempotency and storage quota upgrades.
  - Acceptance: unauthorized and repeated payment transitions cannot grant quota twice; manual verification is represented truthfully.
- [ ] A09 (20%) Verify the real-DWN adapter and signed record read/write integration.
  - Acceptance: use an actual selected protocol engine and verify signatures, authorization and round trips; otherwise report a blocker and never claim protocol readiness.
- [ ] A10 (10%) Complete release readiness, recovery, restore, rollback and operating documentation.
  - Acceptance: supported backup/restore and rollback procedures are verifiable; build, security, integration and deployment checks pass.

All tasks total 100%. A build passing alone does not mean MILAN-ONE is complete.
