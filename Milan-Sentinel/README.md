# MILAN Sentinel

Autonomous quality and regression test platform for the MILAN ecosystem.

## 10,000,000 test cases

This repository defines an **exactly 10,000,000-case executable test space** using deterministic Cartesian-product dimensions instead of committing millions of duplicate files.

The case ID is stable: the same inputs always produce the same test case and shard.

The matrix covers browser/UI, favicon/assets, API, DWN, database, SEO, AI/RAG, wallet, deployment and full integration scenarios.

### Matrix

- 10 environments/domains
- 50 scenarios
- 20 actions/checks
- 10 viewport/device profiles
- 10 application states
- 10 locales

`10 × 50 × 20 × 10 × 10 × 10 = 10,000,000`

Every generated case has a deterministic ID from `00000001` through `10000000`.

## Core checks

Favicon and branding, broken assets, redirects, HTTPS/TLS, page rendering, responsive UI, browser console errors, network failures, authentication, logout, publishing, profiles, messages, notifications, settings, Control Center, API contracts, DWN records, permissions, PostgreSQL connectivity, Travel Agent requests, wallet flows, SEO metadata, robots.txt, sitemap, canonical URLs, structured data, crawler access and RAG retrieval/citation consistency.

## Execution model

The complete space is generated at runtime and can be sharded deterministically. CI can run a small fast gate on every change, production smoke checks after deployment, and the full 10M matrix across scheduled parallel workers.

A test only becomes PASS when it has real evidence from the target environment. The system never marks a generated case green merely because it was enumerated.
