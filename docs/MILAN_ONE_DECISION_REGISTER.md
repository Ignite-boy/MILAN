# MILAN-ONE Decision Register

**Baseline reviewed:** 23 October 2026  
**Evidence baseline:** repository audit dated 22 October 2026, supplemented by the current `main` roadmap/workflow files and the open PR states checked on 23 October 2026.

This register separates **the intended contract**, **what evidence currently supports**, and **decisions that require an owner**. The presence of code or a green integrity build is not proof that a feature is production-ready.

## 1. Adopted working contract

These are the safe operating defaults for implementation and automation. A material change requires an explicit, independently reviewed decision record.

| Area | Working contract | Current evidence / gap | Automation rule |
|---|---|---|---|
| MILAN vs MILAN-ONE | MILAN is the user-facing product; MILAN-ONE is the canonical codebase, service-boundary and release operating model. | The Social OS document includes aspirational primitives that are not all verified as live product features. | Do not treat a prototype or roadmap concept as live. Label `Live / Beta / Prototype / Planned / Not started`. |
| Canonical web UI | `frontend/` is the production source. `Live-UI-Update/` holds automation/tooling, not a second authoritative frontend. | The audit found 100 overlapping relative paths and duplicate workflow copies. | Route generated UI changes to `frontend/` only. Duplicate source files are a drift blocker. |
| Production database | Cloud SQL for PostgreSQL via `MILAN_DATABASE_URL` is the intended authoritative production store. | Some docs still describe a legacy store as authoritative; some social-state write paths use local JSON and asynchronous snapshot sync. | Do not implement new durable state against a competing provider or mark a write durable unless its acknowledgement semantics are tested. |
| Local files and cache | Local files are disposable processing/cache artifacts, not a second durable source of truth. | Existing cache and snapshot paths may preserve or resurrect stale state. | Never use local cache as proof of production data recovery. Add failure/restart tests to persistence work. |
| DWN capability | Until a real signed protocol engine passes end-to-end tests, describe the product as DID-linked/logically scoped data on managed storage; report `realDwnProtocol: false` honestly. | Audit says the main API explicitly reported protocol readiness false; the C++ tree is a separate experiment. | Never set protocol readiness true from SDK presence, DID creation or a health response alone. |
| Health/readiness | Liveness means the process responds; readiness must prove required DB/schema access; feature readiness is separate. | Audit found health fields with overlapping meanings and a code path that may overstate storage readiness. | No single HTTP 200 may certify data recovery or production readiness. |
| Media limits | One shared end-to-end byte-limit contract must align frontend, request, durable writer and per-user quota. | The audit saw 5,000 MiB in one layer versus 768 MiB at the Google Cloud writer/docs, plus separate user quotas. | Reject unsupported sizes before upload commit; never silently skip the Range test. |
| Auth/session | Revocation and token-version semantics must use a consistent authoritative source and be tested across instances. | Audit found JWT issuance and middleware token-version handling did not line up. | Do not weaken auth to make a task pass; do not mark the task complete without stale-token and cross-user tests. |
| Payments | Current production behavior is manual UPI/QR with manual bank verification until an approved decision changes the provider. | Cashfree checkout remains an alternative in draft PR #65. A syntactically valid VPA is not proof of merchant onboarding or settlement. | No client redirect or payment intent alone grants quota. Only verified/idempotent state transitions can. |
| AI and privacy | Hosted provider calls must be disclosed and consent/opt-out enforced; do not describe hosted processing as on-device. | Optional OpenAI/Gemini integrations can send prompts to hosted providers; vision language suggests stronger on-device privacy. | Keep feature/provider status explicit; never invent local-only guarantees. |
| Release governance | Automation opens a focused branch and PR; tests must run on the exact PR SHA; a separate approving reviewer merges. | Active `Protect main branch` ruleset requires one approving review and has no bypass actor. | Never auto-merge a generated PR, bypass review, or close a passing PR because approval is pending. |
| Release state | Weighted tasks track engineering progress, not production readiness. Any open non-weighted release gate blocks a production-ready claim. | Audit dated 22 October recorded a critical database TRUNCATE incident; recovery status was not evidenced in that audit. | P0 release gates are operator-owned. Autopilot must pause and must never access or mutate production data. |

## 2. Open decisions and required owner actions

| Priority | Decision / open thread | What is ambiguous | Required evidence before closing |
|---|---|---|---|
| P0 | Production database incident (R01) | The 22 Oct audit recorded 10 application tables at zero rows after TRUNCATE; it did not establish whether a provider backup/PITR restore was available or completed afterward. | Authorized DB/provider owner records current state, recovery point, data-loss window and representative checks for users/login, records/media, payments and WebAuthn in a safe target; if restore is unavailable, approve a deliberate incident/recreation plan. No autopilot DB access. |
| P1 | Persistence durability | Does API success mean local file write, queued background sync, or a durable PostgreSQL commit? | Entity-by-entity source-of-truth map plus PostgreSQL failure, process restart and multi-instance concurrency tests. |
| P1 | Signed DWN integration | Is MILAN promising DID-scoped records or a real, interoperable signed DWN protocol? | Select the protocol engine; prove signed write/query, authorization, restart persistence, cross-tenant denial and key lifecycle. Until then keep protocol readiness false. |
| P1 | Media writer and Range tests (PR #79) | Video fix is not merged on this baseline and root `package.json` does not define `test:video-range`. | Review PR #79 and wire byte-exact 206/416 tests into root CI. Test authenticated playback/seek against a controlled staging asset. |
| P1 | Private chat and public feed (PR #43) | One privacy boundary must apply to feed, search, notifications, media and other access surfaces. | Two-user negative tests across list/get/feed/search/media and revoked-access paths; review and merge only with evidence. |
| P1 | Payment provider (PR #65) | Manual bank verification and hosted Cashfree checkout have different settlement, webhook, refund and support contracts. | Owner selects one default provider and documents idempotency, verification, refunds and reconciliation before enabling checkout. |
| P1 | Media delivery/CDN (PR #66) | Draft suggests hosted signed media URLs while current architecture points to Google Cloud-backed PostgreSQL media. | Decide provider architecture, update docs/config/data path consistently, test authorization-aware caching and exact range bytes. |
| P1 | CI and release claims | Current `npm run build` is primarily an integrity check; Sentinel matrix count does not equal executed coverage. | Per-SHA report of executed/passed/failed/skipped critical flows; upload, Range, pagination, tenant isolation and durable-write tests run as appropriate. |
| P2 | Provider retirement (PR #49) | legacy deployment/storage references may be active paths, historical docs, or leftovers. | Deployment inventory plus code/config references; remove dependencies only after the target provider and rollback path are verified. |
| P2 | AI data handling | Which endpoint sends which inputs to hosted providers, under what consent, retention and deletion behavior? | Route-level data-flow/consent table, provider-failure tests and user-facing disclosure matching actual calls. |
| P2 | Companion maturity | DWN C++, wallet, Travel Agent and Android WebView exist at different levels of integration. | Component register with maturity, deployed state, owner, runtime, data/auth contract, CI and end-to-end proof. |

## 3. Open PR snapshot (checked 23 October 2026)

- [PR #43 — keep private chats out of home feed](https://github.com/Ignite-boy/MILAN/pull/43): open, not merged.
- [PR #79 — video byte-range suffix handling](https://github.com/Ignite-boy/MILAN/pull/79): open, not merged; root test script is still absent from `main`.
- [PR #65 — Cashfree storage checkout](https://github.com/Ignite-boy/MILAN/pull/65): open draft, not merged.
- [PR #66 — video CDN/cache optimization](https://github.com/Ignite-boy/MILAN/pull/66): open draft, not merged.

These are competing or unresolved decision threads, not proof of delivered production behavior.

## 4. Autopilot contract

1. Read this register, the architecture contract and roadmap before selecting work.
2. If any unchecked `R##` production release gate exists, stop before invoking the coding agent. Emit a workflow summary naming the open gate(s).
3. Otherwise select only the first unchecked `A##` item. Preserve task IDs, titles, ordering, weights and every other checkbox.
4. Never access production databases, credentials, secret values or provider consoles; do not run migrations or destructive operations.
5. Keep protected decisions and automation files operator-owned. If a task exposes a missing product/provider decision, report the blocker instead of choosing silently.
6. Run relevant unit/integration/security tests. Missing critical tests must block the task; they must not be treated as optional success.
7. Verify the exact PR head SHA and required check conclusions. Keep a successful candidate PR open until an independent approval/merge.
8. Do not create a duplicate PR while a candidate for the same roadmap task remains open.
9. Keep the operator-owned `R##` section byte-for-byte unchanged in autonomous task branches.
10. Report weighted engineering progress and release-gate status separately. No weighted percentage alone is a production-ready claim.

## 5. Definition of done

MILAN-ONE is not production-ready until:
- Every A01–A10 implementation task is accepted and merged.
- Every R## release gate is closed through its own evidence and independent review.
- The current architecture, provider and privacy contracts match the implementation.
- Critical user flows pass verified per-SHA integration/security/deployment checks, with skipped paths disclosed.
- The 22 October database incident has an owner-approved recovery outcome and validated data/recreation plan.
- All generated code remains behind the repository's independent review rule.
